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
const maxGlbBytes = 20 * 1024 * 1024;
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
      throw failure(422,'Blender Python execution or GLB export failed');
    }
    const file = await open(join(dir,'result.glb'),constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)).catch(()=>{throw failure(422,'Blender Python did not produce a GLB');});
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 20 || info.size > maxGlbBytes) throw failure(422,'Invalid generated GLB size');
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const {bytesRead} = await file.read(bytes,offset,bytes.length-offset,offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== bytes.length || bytes.toString('ascii',0,4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw failure(422,'Invalid generated GLB');
      return bytes;
    } finally {await file.close();}
  } finally {
    try {if(dir) await rm(dir,{recursive:true,force:true});}
    finally {blenderWorker.active = false;}
  }
}
