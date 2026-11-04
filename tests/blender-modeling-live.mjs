// Run against a local Scenivo Node service with Blender modeling enabled.
import assert from 'node:assert/strict';
import {Raycaster, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const origin=process.env.SCENIVO_TEST_ORIGIN ?? 'http://127.0.0.1:1420';
const headers={origin,'content-type':'application/json','x-chat3d-build':'1'};
const status=await fetch(origin+'/api/blender/build/status');
assert.equal((await status.json()).modelingAvailable,true);
const build=(holeDiameter,extra={})=>fetch(origin+'/api/blender/build',{method:'POST',headers:{...headers,...extra},body:JSON.stringify({type:'mounting_plate',width:120,depth:80,thickness:8,holeDiameter,holeInset:12,bevel:1})});
assert.equal((await build(8,{origin:'https://example.invalid'})).status,403);
assert.equal((await build(1000)).ok,false);
const intersects=(scene,x,z)=>new Raycaster(new Vector3(x,1,z),new Vector3(0,-1,0)).intersectObject(scene,true).length>0;
for (const diameter of [8,10]) {
  const res=await build(diameter);
  assert.equal(res.status,200,res.ok ? undefined : await res.text());
  const {scene}=await new GLTFLoader().parseAsync(await res.arrayBuffer(),'');
  scene.updateMatrixWorld(true);
  assert.ok(intersects(scene,0,0),'plate center must be solid');
  for(const x of [-0.048,0.048]) for(const z of [-0.028,0.028]) {
    assert.equal(intersects(scene,x,z),false,'each of four holes must pass through');
    assert.equal(intersects(scene,x+0.0045,z),diameter===8,'hole diameter must change');
  }
}
console.log('PASS Blender MCP: same-origin gate, parameter validation, four through-holes, and diameter change');
