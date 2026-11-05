import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';

const origin=process.env.SCENIVO_TEST_ORIGIN ?? 'http://127.0.0.1:1430';
const endpoint=origin+'/api/blender/python';
const untrusted=await fetch(endpoint+'/status',{headers:{'x-chat3d-python':'1',origin:'https://example.invalid'}});
assert.ok(!(await untrusted.json()).token,'cross-origin status must not disclose a token');
const status=await fetch(endpoint+'/status',{headers:{'x-chat3d-python':'1'}});
assert.ok(status.ok);
const {available,token}=await status.json();
assert.equal(available,true);
assert.match(token,/^[0-9a-f]{64}$/);
const fixture=await readFile(new URL('./blender-agv-fixture.py',import.meta.url),'utf8');
const script=fixture+`
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and not obj.name.startswith('Wheel'):
        bevel = obj.modifiers.new('Live regression bevel', 'BEVEL')
        bevel.width = 0.01
        bevel.segments = 3
image = bpy.data.images.new('Packed fixture texture', width=2, height=2)
image.generated_color = (0.4, 0.5, 0.6, 1.0)
image.use_fake_user = True
`;
const build=(source,headers={})=>fetch(endpoint,{method:'POST',headers:{origin,'content-type':'application/json','x-chat3d-python':token,...headers},body:JSON.stringify({script:source})});
assert.equal((await build(script,{'x-chat3d-python':'invalid'})).status,403);
assert.equal((await build(script,{origin:'https://example.invalid'})).status,403);

async function artifacts(response) {
  assert.equal(response.status,200,response.ok?undefined:await response.text());
  assert.match(response.headers.get('content-type'),/^multipart\/form-data; boundary=/);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const form=await response.formData();
  assert.deepEqual([...form.keys()].sort(),['blend','glb','render']);
  const result={};
  for(const [field,name,type,maxBytes] of [
    ['blend','result.blend','application/octet-stream',32*1024*1024],
    ['glb','result.glb','model/gltf-binary',20*1024*1024],
    ['render','render.png','image/png',8*1024*1024],
  ]) {
    const file=form.get(field);
    assert.equal(file?.name,name);
    assert.equal(file.type,type);
    assert.ok(file.size>0 && file.size<=maxBytes,field+' size');
    result[field]=Buffer.from(await file.arrayBuffer());
  }
  assert.equal(result.blend.toString('ascii',0,7),'BLENDER');
  assert.equal(result.glb.toString('ascii',0,4),'glTF');
  assert.equal(result.glb.readUInt32LE(4),2);
  assert.equal(result.glb.readUInt32LE(8),result.glb.length);
  assert.deepEqual(result.render.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(result.render.toString('ascii',12,16),'IHDR');
  for(const offset of [16,20]) assert.ok(result.render.readUInt32BE(offset)>0 && result.render.readUInt32BE(offset)<=768);
  assert.equal(result.render.toString('ascii',result.render.length-8,result.render.length-4),'IEND');
  assert.equal(result.glb.readUInt32LE(16),0x4e4f534a);
  result.gltf=JSON.parse(result.glb.toString('utf8',20,20+result.glb.readUInt32LE(12)).trim());
  return result;
}

const result=await artifacts(await build(script));
const parts=result.gltf.nodes.filter(object=>object.mesh!==undefined);
assert.equal(parts.length,10);
for(const [name,count] of [['Chassis',1],['Wheel',4],['Mast',2],['Fork',2]]) assert.equal(parts.filter(part=>part.name.startsWith(name)).length,count);
for(const part of parts.filter(part=>!part.name.startsWith('Wheel'))) {
  const primitives=result.gltf.meshes[part.mesh].primitives;
  const vertices=primitives.reduce((count,primitive)=>count+result.gltf.accessors[primitive.attributes.POSITION].count,0);
  const triangles=primitives.reduce((count,primitive)=>count+result.gltf.accessors[primitive.indices].count/3,0);
  assert.ok(vertices>24 && triangles>12,part.name+' must export its evaluated bevel, not the original cube');
}
const nativeDir=await mkdtemp(join(tmpdir(),'scenivo-blender-native-'));
try {
  const blendPath=join(nativeDir,'result.blend');
  const inspectPath=join(nativeDir,'inspect.py');
  await writeFile(blendPath,result.blend);
  await writeFile(inspectPath,`
import bpy
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
assert len(meshes) == 10, 'native project must retain all AGV meshes'
for obj in meshes:
    if not obj.name.startswith('Wheel'):
        bevel = obj.modifiers.get('Live regression bevel')
        assert bevel is not None and bevel.type == 'BEVEL', 'native project must retain unapplied bevels'
        assert len(obj.data.vertices) == 8, 'native cube mesh must remain unapplied'
image = bpy.data.images.get('Packed fixture texture')
assert image is not None, 'native project must retain its generated image'
assert len(image.packed_files) > 0, 'native project must embed actual image data'
assert all(item.packed_file.size > 0 for item in image.packed_files), 'packed image must not be empty'
assert tuple(image.size) == (2, 2), 'packed image dimensions must survive reopening'
pixels = list(image.pixels)
assert len(pixels) == 16, 'packed image pixels must load after reopening'
expected = (0.4, 0.5, 0.6, 1.0)
assert all(abs(value - expected[index % 4]) < 0.01 for index, value in enumerate(pixels)), 'packed pixel colors must survive reopening'
assert not any(obj.type in {'CAMERA', 'LIGHT'} for obj in bpy.context.scene.objects), 'render fallback must not alter native project'
print('PASS native Blender project retains unapplied bevels and packed image pixels')
`);
  const executable=process.env.BLENDER_EXECUTABLE ?? 'blender';
  const {stdout,stderr}=await promisify(execFile)(/[\\/]/.test(executable)?resolve(executable):executable,
    ['--background','--factory-startup','--disable-autoexec','--threads','2',blendPath,'--python-exit-code','1','--python',inspectPath],
    {cwd:nativeDir,timeout:30000,maxBuffer:1024*1024,windowsHide:true});
  assert.match(stdout,/PASS native Blender project/,stderr);
} finally {await rm(nativeDir,{recursive:true,force:true});}
for(const name of ['Preview camera','Preview studio']) {
  assert.equal(result.blend.includes(Buffer.from(name)),false,'fallback rig must not alter native project');
  assert.equal(result.gltf.nodes.some(node=>node.name?.startsWith(name)),false,'fallback rig must not alter original GLB');
}

const authored=await artifacts(await build(`
import bpy
bpy.ops.mesh.primitive_cube_add()
bpy.context.object.name = 'Authored cube'
bpy.ops.object.camera_add(location=(4, -6, 4))
camera = bpy.context.object
camera.name = 'Authored camera'
camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(2, -3, 5))
bpy.context.object.name = 'Authored light'
bpy.context.object.data.energy = 700
bpy.context.object.data.size = 5
bpy.context.scene.render.resolution_x = 320
bpy.context.scene.render.resolution_y = 240
`));
assert.equal(authored.render.readUInt32BE(16),320);
assert.equal(authored.render.readUInt32BE(20),240);
assert.ok(authored.blend.includes(Buffer.from('Authored camera')));
assert.ok(authored.blend.includes(Buffer.from('Authored light')));
assert.ok(authored.gltf.nodes.some(node=>node.name==='Authored camera' && node.camera!==undefined));
const failed=await build('raise RuntimeError("deliberate test failure")');
assert.equal(failed.status,422);
assert.match((await failed.json()).error,/RuntimeError: deliberate test failure/);
console.log('PASS Blender Python MCP: authorization, original blend/GLB/PNG multipart, evaluated AGV bevels, isolated studio fallback, authored camera/lights, and script errors');
