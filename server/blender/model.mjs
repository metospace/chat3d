import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./model.py', import.meta.url));
const fields = {
  mounting_plate: ['width', 'depth', 'thickness', 'holeDiameter', 'holeInset', 'bevel'],
  box: ['width', 'depth', 'thickness', 'bevel'],
  cylinder: ['diameter', 'thickness', 'holeDiameter', 'bevel'],
};
export const modelSchema = {
  type: 'object',
  oneOf: Object.entries(fields).map(([type, keys]) => ({type: 'object', additionalProperties: false,
    properties: {type: {const: type}, ...Object.fromEntries(keys.map(key => [key, {type: 'number', minimum: (key === 'bevel' || (type === 'cylinder' && key === 'holeDiameter')) ? 0 : 0.1, maximum: 1000}]))},
    required: ['type', ...keys.filter(key => key !== 'bevel' && !(type === 'cylinder' && key === 'holeDiameter'))],
  })),
};
export function validateModel(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(fields,input.type)) throw Error('Unsupported geometry type');
  const spec = {bevel: 0, ...(input.type === 'cylinder' ? {holeDiameter: 0} : {}), ...input};
  const keys = fields[input.type];
  if (Object.keys(input).some(key => key !== 'type' && !keys.includes(key))) throw Error('Unknown geometry parameter');
  for (const key of keys) {
    const min = key === 'bevel' || (key === 'holeDiameter' && spec.type === 'cylinder') ? 0 : 0.1;
    if (!Number.isFinite(spec[key]) || spec[key] < min || spec[key] > 1000) throw Error('Invalid ' + key);
  }
  const {width,depth,diameter,thickness,holeDiameter,holeInset,bevel} = spec;
  let gap = Math.min(thickness, diameter ?? width, diameter ?? depth);
  if (spec.type === 'mounting_plate') {
    gap = Math.min(gap, holeInset - holeDiameter/2, Math.min(width,depth) - 2*holeInset - holeDiameter);
  } else if (spec.type === 'cylinder' && holeDiameter) {
    gap = Math.min(gap, (diameter-holeDiameter)/2);
  }
  if (gap < 0.1 || bevel >= gap/2) throw Error('Holes or bevel leave insufficient material');
  return spec;
}

export const blenderWorker = {active: false};
export async function buildGlb(input, {executable = 'blender', signal} = {}) {
  const spec = validateModel(input);
  if (blenderWorker.active) throw Object.assign(Error('Blender worker busy'), {status:429});
  blenderWorker.active = true;
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), 'chat3d-model-'));
    await writeFile(join(dir, 'spec.json'), JSON.stringify(spec));
    try {
      await run(executable, ['--background','--factory-startup','--disable-autoexec','--threads','2','--python-exit-code','1','--python',script,'--',dir],
        {timeout: 90000, maxBuffer: 1024*1024, signal, windowsHide:true});
    } catch (error) {
      throw Object.assign(Error(error.code === 'ENOENT' ? 'Blender executable not found' : error.killed ? 'Blender build timed out' : 'Blender build failed'), {status: error.code === 'ENOENT' ? 503 : error.killed ? 504 : 500});
    }
    const file = join(dir, 'result.glb');
    const {size} = await stat(file);
    if (size < 20 || size > 20*1024*1024) throw Error('Invalid generated GLB size');
    const bytes = await readFile(file);
    if (bytes.toString('ascii',0,4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Invalid generated GLB');
    return bytes;
  } finally {
    try { if (dir) await rm(dir,{recursive:true,force:true}); }
    finally { blenderWorker.active = false; }
  }
}
