import {execFile} from 'node:child_process';
import {mkdtemp, open, rm, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {blenderWorker} from './model.mjs';

const run = promisify(execFile);
const runner = fileURLToPath(new URL('./python-runner.py', import.meta.url));
export const maxScriptBytes = 256 * 1024;
export const pythonArtifacts = [
  {field:'blend',filename:'result.blend',mimeType:'application/octet-stream',maxBytes:32*1024*1024},
  {field:'glb',filename:'result.glb',mimeType:'model/gltf-binary',maxBytes:20*1024*1024},
  {field:'render',filename:'render.png',mimeType:'image/png',maxBytes:8*1024*1024},
];
export const pythonToolName = 'run_blender_python';
export const pythonSchema = {type:'object', additionalProperties:false, required:['script'], properties:{script:{type:'string',minLength:1,maxLength:maxScriptBytes}}};
// Only pass environment needed to locate and start Blender and its runtime.
const runtimeEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|SYSTEMDRIVE|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_[A-Z_]+|DISPLAY|XAUTHORITY)$/i.test(key)));
const failure = (status,message) => Object.assign(Error(message),{status});
export function validatePython(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.script !== 'string' || !input.script.trim()) throw failure(422,'A non-empty script is required');
  if (Buffer.byteLength(input.script,'utf8') > maxScriptBytes) throw failure(413,'Python script exceeds 256 KiB');
  return {script:input.script};
}

export function validatePythonArtifact(field,bytes) {
  const artifact = pythonArtifacts.find(item=>item.field===field);
  if (!artifact || !Buffer.isBuffer(bytes) || bytes.length > artifact.maxBytes) throw failure(422,'Invalid generated '+field+' size');
  const valid = field === 'blend' ? bytes.length >= 12 && bytes.toString('ascii',0,7) === 'BLENDER'
    : field === 'glb' ? bytes.length >= 20 && bytes.toString('ascii',0,4) === 'glTF' && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length
    : bytes.length >= 33 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(16) <= 768 && bytes.readUInt32BE(20) <= 768;
  if (!valid) throw failure(422,'Invalid generated '+field);
  return bytes;
}

async function readArtifact(dir,{field,filename,maxBytes}) {
  const file = await open(join(dir,filename),constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)).catch(()=>{throw failure(422,'Blender Python did not produce '+filename);});
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 12 || info.size > maxBytes) throw failure(422,'Invalid generated '+field+' size');
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await file.read(bytes,offset,bytes.length-offset,offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== bytes.length) throw failure(422,'Incomplete generated '+field);
    return validatePythonArtifact(field,bytes);
  } finally {await file.close();}
}
// This executes trusted code with the Blender process's OS privileges. The temp
// directory, execution timeout and output limits are not an OS sandbox.
export async function runBlenderPython(input,{executable=process.env.BLENDER_EXECUTABLE ?? 'blender',signal}={}) {
  if (process.env.CHAT3D_BLENDER_ALLOW_PYTHON !== '1') throw failure(503,'Blender Python is not enabled');
  const {script} = validatePython(input);
  if (blenderWorker.active) throw failure(429,'Blender worker busy');
  blenderWorker.active = true;
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(),'chat3d-python-'));
    await writeFile(join(dir,'user.py'),script,{mode:0o600});
    try {
      await run(/[\\/]/.test(executable) ? resolve(executable) : executable,['--background','--factory-startup','--disable-autoexec','--threads','2','--python-exit-code','1','--python',runner],
        {cwd:dir,env:{...runtimeEnv(),PYTHONNOUSERSITE:"1"},timeout:60000,maxBuffer:1024*1024,killSignal:'SIGKILL',signal,windowsHide:true});
    } catch (error) {
      if (error.code === 'ENOENT') throw failure(503,'Blender executable not found');
      if (error.code === 'ABORT_ERR') throw failure(499,'Blender Python cancelled');
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw failure(422,'Blender Python log limit exceeded');
      if (error.killed) throw failure(504,'Blender Python timed out');
      const logs=[error.stderr,error.stdout].filter(value=>typeof value==='string'&&value.trim()).join('\n');
      throw failure(422,'Blender Python execution, artifact export or render failed'+(logs?'\n'+logs:': '+error.message));
    }
    const artifacts = {};
    for (const artifact of pythonArtifacts) artifacts[artifact.field] = await readArtifact(dir,artifact);
    return artifacts;
  } finally {
    try {if(dir) await rm(dir,{recursive:true,force:true});}
    finally {blenderWorker.active = false;}
  }
}
