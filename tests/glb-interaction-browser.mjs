import assert from 'node:assert/strict';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const output=resolve('artifacts/product-redesign');await mkdir(output,{recursive:true});
const fixture=`<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{margin:0;font:14px system-ui}#view{width:800px;height:600px;position:relative;margin:40px}#overlay{position:absolute;inset:40px auto auto 40px;width:800px;height:600px;background:#fffd;z-index:10;display:none}</style><div id="view"></div><div id="overlay" role="dialog">Modal overlay</div><script type="module">
import {Viewport} from '/src/scene/Viewport.ts';
import {createInitialDoc,createEditorStore} from '/src/store.ts';
import {selectionPropertyCommands} from '/src/domain/selectionProperties.ts';
import {exportGlb} from '/src/scene/export.ts';
import {importGlb} from '/src/scene/importGlb.ts';
import {Vector3,Box3} from '/node_modules/three/build/three.module.js';
const generated=createInitialDoc();generated.nodes=[{id:'shape',name:'Representative box',parentId:null,kind:'primitive',visible:true,materialId:'mat_blue',geometry:{type:'box',params:{width:2,height:2,depth:2}},transform:{position:[0,1,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}];
const imported=(await importGlb(await exportGlb(generated),'fixture.glb')).doc;
let store,selected=[],mode='orbit',commits=0;
const vp=new Viewport(document.querySelector('#view'),id=>{selected=id?[id]:[];configure()});vp.setRenderQuality('fast');vp.setBackdrop('light');vp.start();
function configure(){const state=store.getState();vp.setSelection(new Set(selected));vp.setComposition({mode,nodes:state.doc.nodes.filter(n=>selected.includes(n.id)),placement:null,snapStep:0,onPlace(){},onCancel(){},onTransform(change){const result=store.getState().applyCommandBatch(selectionPropertyCommands(store.getState().doc,selected,change),'pointer transform');if(!result.ok)throw Error(result.error);commits++;vp.sync(store.getState().doc);configure();}})}
function load(kind){vp.setComposition(null);store=createEditorStore({doc:structuredClone(kind==='glb'?imported:generated)});selected=[];mode='orbit';commits=0;vp.sync(store.getState().doc);vp.fitToScene();configure()}
function project(v){const p=v.clone().project(vp.camera),r=vp.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}}
function point(which){vp.scene.updateMatrixWorld(true);if(which==='handle'){const group=vp.scene.getObjectByName('__manualTransformHandle');let p=group.position.clone();if(mode==='rotate')p.x+=group.children[0].geometry.parameters.radius;return project(p)}const mesh=vp.nodeMap.values().next().value.mesh;return project(new Box3().setFromObject(mesh).getCenter(new Vector3()))}
function state(){return {mode,selected:[...selected],commits,past:store.getState().past.length,doc:JSON.stringify(store.getState().doc),camera:vp.camera.position.toArray(),meshes:[...vp.nodeMap.values()].map(({mesh})=>({position:mesh.position.toArray(),rotation:mesh.quaternion.toArray(),scale:mesh.scale.toArray()}))}}
window.qa={ready:true,load,state,point,renderer:()=>vp.getRenderStats(),select(){selected=store.getState().doc.nodes.map(n=>n.id);configure()},mode(value){mode=value;configure()},overlay(show){document.querySelector('#overlay').style.display=show?'block':'none'}};load('glb');
</script>`;
const cacheDir=await mkdtemp(join(tmpdir(),'scenivo-glb-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'glb-interaction-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/__glb_interaction')return next();res.setHeader('Content-Type','text/html');res.end(fixture)})}}]});
const report={passed:false,checks:[],errors:[],note:'Dedicated real WebGL Viewport + store harness; synthetic exported/imported GLB and generated geometry. Does not substitute for full app UI acceptance or user-original GLB.'};let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHAT3D_BROWSER_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1100,height:780}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__glb_interaction');await page.waitForFunction(()=>window.qa?.ready,null,{timeout:120000});
 const state=()=>page.evaluate(()=>window.qa.state()),point=which=>page.evaluate(which=>window.qa.point(which),which),reset=kind=>page.evaluate(kind=>window.qa.load(kind),kind);
 const drag=async(p,dx=80,dy=0)=>{await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+dx,p.y+dy,{steps:6});await page.mouse.up()};
 const check=(name)=>{report.checks.push(name);console.log('PASS',name)};
 for(const kind of ['glb','generated']){
  for(const selected of [false,true]){await reset(kind);if(selected)await page.evaluate(()=>window.qa.select());const before=await state();await drag(await point('surface'));const after=await state();assert.notDeepEqual(after.camera,before.camera);assert.equal(after.doc,before.doc);assert.equal(after.past,0);check(kind+': '+(selected?'selected':'unselected')+' surface left-drag orbits without editing')}
  await reset(kind);const surface=await point('surface');await page.mouse.click(surface.x,surface.y);assert.equal((await state()).selected.length,1);assert.equal((await state()).mode,'orbit');check(kind+': click selects without changing browse mode');
  for(const mode of ['move','rotate','scale']){
   await reset(kind);await page.evaluate(mode=>{window.qa.select();window.qa.mode(mode)},mode);let before=await state();await drag(await point('surface'),45);let after=await state();assert.notDeepEqual(after.camera,before.camera);assert.equal(after.doc,before.doc);check(kind+': '+mode+' mode surfaces remain orbitable');
   await reset(kind);await page.evaluate(mode=>{window.qa.select();window.qa.mode(mode)},mode);before=await state();await drag(await point('handle'),60);after=await state();assert.notEqual(after.doc,before.doc);assert.equal(after.commits,1);assert.equal(after.past,1);assert.deepEqual(after.camera,before.camera);check(kind+': '+mode+' handle commits one undo entry and preserves camera');
   await reset(kind);await page.evaluate(mode=>{window.qa.select();window.qa.mode(mode)},mode);before=await state();const p=await point('handle');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+60,p.y,{steps:5});assert.notDeepEqual((await state()).meshes,before.meshes);await page.keyboard.press('Escape');await page.mouse.up();after=await state();assert.equal(after.doc,before.doc);assert.equal(after.commits,0);assert.deepEqual(after.meshes,before.meshes);check(kind+': '+mode+' Escape restores preview and creates no history');
  }
  await reset(kind);await page.evaluate(()=>{window.qa.select();window.qa.mode('move')});await page.mouse.move(...Object.values(await point('handle')));await page.mouse.down();await page.mouse.move(950,350,{steps:8});await page.mouse.up();assert.equal((await state()).commits,1);assert.equal((await state()).past,1);check(kind+': pointer release beyond canvas commits exactly once');
  await reset(kind);await page.evaluate(()=>{window.qa.select();window.qa.mode('move')});const p=await point('handle');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+60,p.y);await reset(kind==='glb'?'generated':'glb');const replacement=await state();await page.mouse.up();assert.deepEqual(await state(),replacement);check(kind+': session replacement during drag cancels stale edit');
  await reset(kind);await page.evaluate(()=>window.qa.overlay(true));const before=await state();await drag(await point('surface'));assert.deepEqual((await state()).camera,before.camera);assert.equal((await state()).doc,before.doc);await page.evaluate(()=>window.qa.overlay(false));check(kind+': modal overlay blocks canvas gestures');
 }
 await reset('glb');await page.evaluate(()=>{window.qa.select();window.qa.mode('rotate')});await page.screenshot({path:join(output,'glb-interaction-handle.png')});report.renderer=await page.evaluate(()=>window.qa.renderer());assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=e.stack;throw e}finally{await writeFile(join(output,'glb-interaction-report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close();await rm(cacheDir,{recursive:true,force:true})}
