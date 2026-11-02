import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GTAOPass} from 'three/examples/jsm/postprocessing/GTAOPass.js';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
try{
 const {AdaptiveRenderQuality,loadRenderQuality,saveRenderQuality,normalizeRenderQuality}=await server.ssrLoadModule('/src/scene/renderQuality.ts');
 const {ContactPass,excludeFromContactShadows}=await server.ssrLoadModule('/src/scene/contactShading.ts');
 test('auto tiers consider device size and only lower quality after sustained valid rendering intervals',()=>{
  const quality=new AdaptiveRenderQuality('auto');assert.equal(quality.tier,'high');
  for(let i=0;i<60;i++)quality.sample(16.7);assert.equal(quality.tier,'high');
  for(let i=0;i<150;i++)quality.sample(1000);assert.equal(quality.tier,'high');
  for(let i=0;i<120;i++)quality.sample(33);assert.equal(quality.tier,'balanced');
  for(let i=0;i<120;i++)quality.sample(33);assert.equal(quality.tier,'fast');
  for(let i=0;i<300;i++)quality.sample(8);assert.equal(quality.tier,'fast');
  quality.setMode('high');for(let i=0;i<200;i++)quality.sample(60);assert.equal(quality.tier,'high');
  assert.equal(new AdaptiveRenderQuality('auto',true).tier,'balanced');
 });
 test('invalid preferences default to auto and blocked storage retains the session selection',()=>{
  assert.equal(normalizeRenderQuality({}),'auto');globalThis.localStorage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  assert.equal(loadRenderQuality(),'auto');saveRenderQuality('fast');assert.equal(loadRenderQuality(),'fast');delete globalThis.localStorage;
 });
 test('glass, transparency and annotation meshes do not become opaque AO occluders',()=>{
  const geometry=new THREE.BoxGeometry();const plain=new THREE.MeshStandardMaterial(),glass=new THREE.MeshPhysicalMaterial({transmission:.9}),alpha=new THREE.MeshStandardMaterial({opacity:.5});
  assert.equal(excludeFromContactShadows(new THREE.Mesh(geometry,plain)),false);
  assert.equal(excludeFromContactShadows(new THREE.Mesh(geometry,glass)),true);assert.equal(excludeFromContactShadows(new THREE.Mesh(geometry,alpha)),true);
  assert.equal(excludeFromContactShadows(new THREE.Mesh(geometry,[plain,glass])),true);
  const label=new THREE.Mesh(geometry,plain);label.userData.noAO=true;assert.equal(excludeFromContactShadows(label),true);
  geometry.dispose();for(const m of [plain,glass,alpha])m.dispose();
 });
 test('AO restores visibility and scene override material even when its renderer fails',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),glass=new THREE.Mesh(geometry,new THREE.MeshPhysicalMaterial({transmission:1})),hidden=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());hidden.visible=false;scene.add(glass,hidden);
  const override=new THREE.MeshBasicMaterial();scene.overrideMaterial=override;const original=GTAOPass.prototype.render;
  const pass=Object.create(ContactPass.prototype);pass.scene=scene;
  GTAOPass.prototype.render=function(){assert.equal(glass.visible,false);hidden.visible=true;scene.overrideMaterial=null;throw Error('GPU fixture failure');};
  try{assert.throws(()=>pass.render({},null,null),/GPU fixture failure/);}finally{GTAOPass.prototype.render=original;}
  assert.equal(glass.visible,true);assert.equal(hidden.visible,false);assert.equal(scene.overrideMaterial,override);
  geometry.dispose();glass.material.dispose();hidden.material.dispose();override.dispose();
 });
 console.log(`${passed} render quality checks passed`);
}finally{await server.close()}
