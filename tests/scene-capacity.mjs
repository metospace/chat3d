import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import {BufferGeometry,Material,MeshStandardMaterial,Scene} from 'three';
import {IDBObjectStore} from 'fake-indexeddb';
import 'fake-indexeddb/auto';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let count=0;
const test=async(name,fn)=>{const start=performance.now();await fn();console.log('PASS',name,`${Math.round(performance.now()-start)}ms`);count++;};
const load=path=>server.ssrLoadModule('/src/'+path);
try {
 const {createInitialDoc,createEditorStore}=await load('store.ts');
 const {applyBatch}=await load('domain/commands.ts');
 const {validateDocument}=await load('domain/types.ts');
 const {createModelAsset,instantiateAsset}=await load('domain/modelAssets.ts');
 const {saveModelAsset,readModelAsset}=await load('domain/modelAssetStorage.ts');
 const {serializeProject,parseProject,MAX_PROJECT_BYTES,MAX_TEAM_SCENE_BYTES,PROJECT_SIZE_LIMIT,TEAM_SCENE_SIZE_LIMIT}=await load('domain/project.ts');
 const {checkRequirements}=await load('domain/requirements.ts');
 const {findSceneParts}=await load('domain/sceneQuery.ts');
 const {runModelingAgent}=await load('ai/modelingAgent.ts');
 const {writeWorkspace,readWorkspace}=await load('domain/workspaceStorage.ts');
 const {Viewport}=await load('scene/Viewport.ts');
 const {packGlb}=await load('scene/glbTextures.ts');
 const {importGlb}=await load('scene/importGlb.ts');
 const t=(position=[0,0,0])=>({position,rotationQuaternion:[0,0,0,1],scale:[1,1,1]});
 const part=(i)=>({name:`零件${i}`,geometry:{type:'box',params:{width:.1,height:.05,depth:.1}},materialId:'mat_gray',transform:t([(i%4)*.12,.025,Math.floor(i/4)*.12])});
 const source=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'货箱',parts:Array.from({length:28},(_,i)=>part(i))}]}).doc;
 source.nodes[0].connection={targetId:source.nodes[1].id,sourcePoint:[.05,0,0],targetPoint:[-.05,0,0],maxDistance:.03,purpose:'相邻零件'};
 const asset=createModelAsset(source,[source.nodes[0].id],{name:'货箱',category:'物料'});
 const assetBefore=JSON.stringify(asset);
 await saveModelAsset(asset);
 const slot=i=>[i%20,Math.floor(i/100)*.3,Math.floor(i/20)%5];
 const item=i=>({id:asset.id,version:1,name:`货箱 ${i+1}`,position:slot(i),planKey:'货箱'});
 const instance=i=>instantiateAsset({...asset,name:item(i).name},slot(i));
 const quantity={quote:'总共400个货箱',target:'货箱',kind:'count',expected:'400'};
 let seed=createInitialDoc(),large,generated;
 await test('every append-only command leaves a deeply frozen source document and its animation unchanged',()=>{
  const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;};
  const doc=freeze({...structuredClone(source),animation:{version:1,name:'original',duration:1,loop:true,tracks:[{id:'motion',name:'motion',targetIds:[source.nodes[0].id],channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:1,value:[1,0,0]}]}]}});
  const mesh={...structuredClone(source.nodes[0]),connection:undefined,geometry:{type:'mesh',params:{positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]}}};
  const operations=[{op:'createPrimitive',...part(0),parentId:null},{op:'createTemplate',templateId:'smt_mounter',parameters:{}},{op:'createAssembly',name:'new',parts:[part(0)]},{op:'duplicateAssembly',targetId:doc.nodes[0].id,offset:[1,0,0]},instance(0),{op:'importMeshComponent',nodes:[mesh],materials:structuredClone(source.materials)},{op:'setAnimation',animation:{...structuredClone(doc.animation),name:'new'}},{op:'clearAnimation'}];
  const before=JSON.stringify(doc);for(const op of operations){const result=applyBatch(doc,{operations:[op]});assert.deepEqual(result.errors,[],op.op);assert.equal(result.doc.nodes[0],doc.nodes[0],op.op);assert.equal(JSON.stringify(doc),before,op.op);const failed=applyBatch(doc,{operations:[op,{op:'rename',targetId:'missing',name:'no'}]});assert.equal(failed.doc,doc);assert.deepEqual(failed.applied,[]);assert.equal(JSON.stringify(doc),before);}
 });
 await test('28-part assets fill 352 slots without copying prior nodes on append',()=>{
  for(let start=0;start<352;start+=16){const before=seed;const result=applyBatch(seed,{operations:Array.from({length:16},(_,i)=>instance(start+i))});assert.deepEqual(result.errors,[]);if(before.nodes.length)assert.equal(result.doc.nodes[0],before.nodes[0]);seed=result.doc;}
  assert.equal(seed.nodes.length,9856);assert.equal(checkRequirements(seed,[quantity]).items[0].status,'mismatch');
 });
 const fake=steps=>{let calls=0;return async(model,context)=>{const step=steps[calls++];assert.ok(step,'unexpected model request');const actions=typeof step==='function'?step(context):step;
  const content=actions.map((a,i)=>({type:'toolCall',id:`call_${calls}_${i}`,name:a.name,arguments:a.args}));const message={role:'assistant',content,api:'openai-completions',provider:'mock',model:'mock',stopReason:'toolUse',timestamp:Date.now(),usage:{input:20,output:10,cacheRead:0,cacheWrite:0,totalTokens:30,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:'toolUse',message});});return stream;};};
 const add=start=>({name:'add_saved_assets',args:{items:Array.from({length:16},(_,i)=>item(start+i))}});
 await test('agent crosses 10,000 nodes and completes all 400 slots through existing bounded batches',async()=>{
  const checkpoints=[];let libraryReads=0;const original=IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get=function(key){if(this.name==='versions')libraryReads++;return original.call(this,key);};
  try{generated=await runModelingAgent({text:'继续填满所有货架位置，总共400个货箱，保留已完成352个，不要只做顶层。',config:{baseURL:'https://mock.invalid/v1',apiKey:'mock',model:'mock'},document:seed,selection:[],captureAvailable:()=>false,onPreview:doc=>checkpoints.push(doc.nodes.length),streamFn:fake([
   [add(352)],
   [add(368)],[add(384)],
   [{name:'check_requirements',args:{items:[quantity]}},{name:'find_scene_parts',args:{offset:10016,limit:48,fields:'placement'}}],
   context=>{const result=context.messages.findLast(m=>m.role==='toolResult'&&m.toolName==='check_requirements');assert.match(JSON.stringify(result),/pass/);return [{name:'submit_data_preview',args:{summary:'400个货箱全部填入，视觉检查待完成'}}];}
  ])});}finally{IDBObjectStore.prototype.get=original;}
  large=generated.result.doc;assert.equal(large.nodes.length,11200);assert.deepEqual(checkpoints,[10304,10752,11200]);assert.equal(libraryReads,3,'read each fixed version only once per tool batch');
  const instances=new Map();for(const n of large.nodes){const members=instances.get(n.modelAsset.instanceId)??[];members.push(n);instances.set(n.modelAsset.instanceId,members);}assert.equal(instances.size,400);assert.ok([...instances.values()].every(m=>m.length===28&&m.some(n=>n.id===m[0].connection.targetId)));
  const occupied=new Set();for(const members of instances.values()){const i=Number(members[0].assemblyName.split(' ').at(-1))-1;assert.ok(Number.isInteger(i)&&i>=0&&i<400);occupied.add(i);assert.deepEqual(members[0].transform.position,asset.nodes[0].transform.position.map((v,k)=>v+slot(i)[k]));}assert.equal(occupied.size,400,'every requested shelf position must be occupied');
  assert.equal(checkRequirements(large,[quantity]).items[0].status,'pass');assert.equal(generated.batch.incomplete,true,'data-only draft must remain visually unverified');assert.deepEqual(validateDocument(large),[]);assert.equal(JSON.stringify(asset),assetBefore);
 });
 await test('a bounded task retains its complete batch above 10,000 and manual continuation finishes without duplicates',async()=>{
  const options={text:'继续完成总共400个货箱',config:{baseURL:'https://mock.invalid/v1',apiKey:'mock',model:'mock',taskBudget:{maxRounds:1}},document:seed,selection:[],captureAvailable:()=>false};
  const partial=await runModelingAgent({...options,streamFn:fake([[add(352)]])});assert.equal(partial.result.doc.nodes.length,10304);assert.equal(partial.batch.incomplete,true);assert.match(partial.batch.continuation,/保留有效部分，不要重复创建/);
  const restored=parseProject(serializeProject(partial.result.doc));const ids=restored.nodes.map(n=>n.id);
  const resumed=await runModelingAgent({...options,config:{...options.config,taskBudget:{maxRounds:5}},document:restored,streamFn:fake([[add(368)],[add(384)],[{name:'submit_data_preview',args:{summary:'完整400个货箱已填入，待视觉检查'}}]])});
  assert.equal(resumed.result.doc.nodes.length,11200);assert.deepEqual(resumed.result.doc.nodes.slice(0,ids.length).map(n=>n.id),ids);assert.equal(new Set(resumed.result.doc.nodes.map(n=>n.modelAsset.instanceId)).size,400);assert.equal(checkRequirements(resumed.result.doc,[quantity]).items[0].status,'pass');
 });
 await test('pagination reaches every part past 10,000 and retains bounded page/input validation',()=>{
  const tail=findSceneParts(large,{offset:11184,limit:48,fields:'placement'});assert.equal(tail.total,11200);assert.equal(tail.parts.length,16);assert.equal(tail.nextOffset,null);assert.equal(tail.parts.at(-1).id,large.nodes.at(-1).id);
  for(const q of [{offset:-1},{offset:Infinity},{offset:Number.MAX_SAFE_INTEGER+1},{limit:49}])assert.throws(()=>findSceneParts(large,q),/查询/);
 });
 await test('preview application, undo and redo preserve all IDs above the old ceiling',()=>{
  const store=createEditorStore({doc:seed,aiStatus:'previewing',pendingBatch:generated.batch,pendingResult:generated.result,previewDoc:large});store.getState().confirmPending();assert.equal(store.getState().doc,large);assert.equal(store.getState().past.length,1);
  store.getState().undo();assert.equal(store.getState().doc.nodes.length,9856);store.getState().redo();assert.deepEqual(store.getState().doc.nodes.map(n=>n.id),large.nodes.map(n=>n.id));
 });
 await test('asset replacement and composition remain isolated atomic edits in a large scene',async()=>{
  const v2={...structuredClone(asset),version:2};v2.nodes[0].geometry.params.height=.03;await saveModelAsset(v2,1);
  const before=JSON.stringify(large),original=large.nodes[0],unrelated=large.nodes.at(-1);const replaced=applyBatch(large,{operations:[{op:'delete',targetId:original.id,scope:'assembly'},instantiateAsset(v2,slot(0)),{op:'translateAssembly',targetId:unrelated.id,value:[0,0,2]}]});assert.deepEqual(replaced.errors,[]);assert.equal(replaced.doc.nodes.length,11200);assert.equal(replaced.doc.nodes.filter(n=>n.modelAsset.version===2).length,28);assert.equal(large.nodes[0],original);assert.equal(large.nodes.at(-1),unrelated);assert.equal((await readModelAsset(asset.id,1)).nodes[0].geometry.params.height,.05);assert.deepEqual(validateDocument(replaced.doc),[]);assert.equal(JSON.stringify(large),before);
 });
 await test('late invalid operations roll back all scene, material and history changes',()=>{
  const before=JSON.stringify(large);const result=applyBatch(large,{operations:[instance(400),{op:'setTransform',targetId:large.nodes.at(-1).id,transform:{position:[NaN,0,0]}}]});assert.ok(result.errors.length);assert.equal(result.doc,large);assert.deepEqual(result.applied,[]);
  const missing=applyBatch(large,{operations:[instance(400),{op:'delete',targetId:'missing'}]});assert.equal(missing.doc,large);assert.deepEqual(missing.applied,[]);assert.equal(JSON.stringify(large),before);
 });
 await test('full-scene validation still catches tail references duplicates and cycles in linear traversal',()=>{
  for(const mutate of [d=>d.nodes.at(-1).materialId='missing',d=>d.nodes.at(-1).connection.targetId='missing',d=>d.nodes.at(-1).id=d.nodes[0].id,d=>{d.nodes.at(-1).parentId=d.nodes.at(-2).id;d.nodes.at(-2).parentId=d.nodes.at(-1).id;}]){
   const doc={...large,nodes:large.nodes.map(n=>({...n,...(n.connection?{connection:{...n.connection}}:{})}))};doc.nodes.at(-1).connection={...large.nodes[0].connection};mutate(doc);assert.ok(validateDocument(doc).length);
  }
  const chain={...large,nodes:large.nodes.map((n,i)=>({...n,parentId:i?large.nodes[i-1].id:null}))};assert.deepEqual(validateDocument(chain),[]);
 });
 await test('scene capacity does not bypass per-batch command work budgets',()=>{
  let result=applyBatch(large,{operations:Array.from({length:201},()=>({op:'rename',targetId:large.nodes[0].id,name:'same'}))});assert.equal(result.doc,large);assert.match(result.errors[0].message,/命令数/);
  const assembly=count=>({op:'createAssembly',name:'budget',parts:Array.from({length:count},(_,i)=>({...part(i),repeat:{count:100,step:[1,0,0]}}))});result=applyBatch(large,{operations:[assembly(20),assembly(11)]});assert.equal(result.doc,large);assert.deepEqual(result.applied,[]);assert.match(result.errors[0].message,/本批实际新增.*3000.*分批/);
 });
 await test('compact project save and reopen keep all 11,200 nodes without weakening the byte budget',async()=>{
  const json=serializeProject(large);assert.ok(Buffer.byteLength(json)<MAX_PROJECT_BYTES);assert.deepEqual(parseProject(json),JSON.parse(JSON.stringify(large)));console.log('Portable project bytes',Buffer.byteLength(json));
  assert.throws(()=>serializeProject({...large,nodes:[{...large.nodes[0],name:'x'.repeat(400*1024*1024)}]}),/400 MiB/);assert.throws(()=>parseProject(' '.repeat(400*1024*1024+1)),/400 MiB/);
  const {validateTeamPayload}=await server.ssrLoadModule('/server/team/validator.ts');
  const teamExpanded=serializeProject({...large,nodes:[{...large.nodes[0],connection:undefined,name:'x'.repeat(21*1024*1024)}]});assert.ok(Buffer.byteLength(teamExpanded)>20*1024*1024);assert.doesNotThrow(()=>validateTeamPayload('scene',JSON.parse(teamExpanded)));
  const overflow={...large,nodes:[{...large.nodes[0],connection:undefined,name:'x'.repeat(MAX_TEAM_SCENE_BYTES+1)}]};assert.throws(()=>validateTeamPayload('scene',{format:'chat3d-project',version:1,scene:overflow}),e=>e.message.includes(TEAM_SCENE_SIZE_LIMIT));assert.throws(()=>serializeProject(overflow),e=>e.message.includes(PROJECT_SIZE_LIMIT));
  assert.throws(()=>parseProject(' '.repeat(MAX_TEAM_SCENE_BYTES+1),MAX_TEAM_SCENE_BYTES),e=>e.message.includes(TEAM_SCENE_SIZE_LIMIT));
 });
 await test('IndexedDB persists and reopens the full scene and preserves it after a storage abort',async()=>{
  let revision=await writeWorkspace({version:1,activeId:'large',sessions:[{id:'large',snapshot:{doc:large,pendingResult:generated.result}}]},0);const saved=await readWorkspace();assert.equal(saved.sessions[0].snapshot.doc.nodes.length,11200);assert.equal(saved.sessions[0].snapshot.pendingResult.doc.nodes.length,11200);
  const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='current'){this.transaction.abort();throw new DOMException('simulated storage pressure','QuotaExceededError');}return original.call(this,value,key);};
  try{await assert.rejects(()=>writeWorkspace({version:1,activeId:'large',sessions:[{id:'large',snapshot:{doc:seed}}]},revision),/保存失败/);}finally{IDBObjectStore.prototype.put=original;}
  const restored=await readWorkspace();assert.equal(restored.revision,revision);assert.equal(restored.sessions[0].snapshot.doc.nodes.length,11200);
 });
 await test('viewport reuses geometry and equivalent materials across 400 editable asset instances',()=>{
  const v=Object.create(Viewport.prototype);Object.assign(v,{scene:new Scene(),nodeMap:new Map(),sharedGeometryCache:new Map(),materialCache:new Map(),frameMaterialKeys:new Map(),selectionHelpers:[],lastSyncedDoc:null,defaultMaterial:new MeshStandardMaterial(),frameScene(){},markDirty(){}});
  try{v.sync(large);assert.equal(v.nodeMap.size,11200);assert.equal(v.sharedGeometryCache.size,1);assert.equal(v.materialCache.size,1);const first=v.nodeMap.get(large.nodes[0].id),other=v.nodeMap.get(large.nodes[28].id),otherColor=other.material.color.getHexString();assert.notEqual(large.nodes[0].materialId,large.nodes[28].materialId);assert.equal(first.material,other.material);let disposed=0,materialDisposed=0;const sharedMaterial=first.material;sharedMaterial.addEventListener('dispose',()=>materialDisposed++);first.geometry.addEventListener('dispose',()=>disposed++);
   const edited=applyBatch(large,{operations:[{op:'setAppearance',targetId:large.nodes[0].id,baseColor:'#123456'},{op:'translate',targetId:large.nodes[0].id,space:'world',mode:'delta',value:[.01,0,0]}]}).doc;v.sync(edited);assert.equal(v.nodeMap.get(large.nodes[0].id).mesh,first.mesh);assert.notEqual(first.material,other.material);assert.equal(v.sharedGeometryCache.size,1);assert.equal(v.materialCache.size,2);assert.equal(disposed,0);assert.equal(materialDisposed,0);assert.equal(other.material.color.getHexString(),otherColor);v.sync({...large,nodes:[]});assert.equal(disposed,1);assert.equal(materialDisposed,1);assert.equal(v.sharedGeometryCache.size,0);assert.equal(v.materialCache.size,0);
  }finally{v.disposeAllNodes();v.defaultMaterial.dispose();}
 });
 await test('unchanged selection preserves helpers and clean frames until document reconciliation',()=>{
  const v=Object.create(Viewport.prototype);Object.assign(v,{scene:new Scene(),nodeMap:new Map(),sharedGeometryCache:new Map(),materialCache:new Map(),frameMaterialKeys:new Map(),selectionHelpers:[],lastSyncedDoc:null,defaultMaterial:new MeshStandardMaterial(),frameScene(){}});
  const doc={...source,nodes:source.nodes.slice(0,1)},ids=new Set([doc.nodes[0].id]);
  try{
   v.sync(doc);v.setSelection(new Set());v.dirty=false;v.setSelection(new Set());assert.equal(v.dirty,false,'reopening an unselected document stays clean');
   v.setSelection(ids);const helper=v.selectionHelpers[0];v.dirty=false;v.setSelection(new Set(ids));assert.equal(v.dirty,false);assert.equal(v.selectionHelpers[0],helper);let disposed=0;helper.geometry.addEventListener('dispose',()=>disposed++);
   const moved={...doc,nodes:[{...doc.nodes[0],transform:{...doc.nodes[0].transform,position:[4,5,6]}}]};v.sync(moved);assert.equal(disposed,1);v.setSelection(ids);const updated=v.selectionHelpers[0];assert.notEqual(updated,helper);updated.geometry.computeBoundingBox();assert.equal(updated.geometry.boundingBox.min.x>3,true);assert.equal(v.dirty,true);
  }finally{v.disposeAllNodes();v.defaultMaterial.dispose();}
 });
 await test('viewport caches immutable geometry keys and skips unchanged geometry reconciliation',()=>{
  const v=Object.create(Viewport.prototype);Object.assign(v,{scene:new Scene(),nodeMap:new Map(),sharedGeometryCache:new Map(),materialCache:new Map(),frameMaterialKeys:new Map(),selectionHelpers:[],lastSyncedDoc:null,defaultMaterial:new MeshStandardMaterial(),frameScene(){},markDirty(){}});
  const geometry=source.nodes[0].geometry,equivalent=structuredClone(geometry),tracked=new Set([geometry,equivalent]);
  const doc={...source,nodes:source.nodes.slice(0,2).map((node,i)=>({...node,geometry:i?equivalent:geometry}))};
  const stringify=JSON.stringify;let serialized=0,builds=0;const build=v.buildGeometry;
  JSON.stringify=function(value,...args){if(tracked.has(value))serialized++;return stringify.call(this,value,...args);};
  v.buildGeometry=function(value){builds++;return build.call(this,value);};
  try{
   v.sync(doc);assert.equal(serialized,2);assert.equal(builds,2);assert.equal(v.sharedGeometryCache.size,1);const first=v.nodeMap.get(doc.nodes[0].id),shared=first.geometry;assert.equal(shared,v.nodeMap.get(doc.nodes[1].id).geometry);
   assert.equal(v.buildGeometry(geometry),shared);assert.equal(v.buildGeometry(equivalent),shared);assert.equal(serialized,2,'each immutable geometry is serialized only once');
   const keys=[...v.frameMaterialKeys],instances=v.instancedRender;v.sync(doc);assert.deepEqual([...v.frameMaterialKeys],keys,'same-document sync preserves material keys');assert.equal(v.instancedRender,instances);
   const calls=builds,moved={...doc,nodes:doc.nodes.map(node=>({...node,transform:{...node.transform,position:[1,2,3]}}))};v.sync(moved);assert.equal(builds,calls,'transform edits never call buildGeometry');assert.equal(serialized,2);assert.equal(v.nodeMap.get(doc.nodes[0].id).geometry,shared);assert.deepEqual(first.mesh.position.toArray(),[1,2,3]);
   let disposed=0;shared.addEventListener('dispose',()=>disposed++);const switched={...doc,projectId:'other-project',nodes:[{...doc.nodes[0],id:'other-node',geometry:{type:'box',params:{width:2,height:3,depth:4}}}]};v.sync(switched);assert.equal(disposed,1);assert.equal(v.nodeMap.size,1);assert.equal(v.sharedGeometryCache.size,1);assert.notEqual(v.nodeMap.get('other-node').geometry,shared);
   v.sync(doc);assert.equal(serialized,2,'revisiting a document can reuse weak keys but never disposed GPU buffers');assert.notEqual(v.nodeMap.get(doc.nodes[0].id).geometry,shared);assert.equal(v.sharedGeometryCache.size,1);
  }finally{JSON.stringify=stringify;v.disposeAllNodes();v.defaultMaterial.dispose();}
 });
 const renderViewport=()=>{
  const calls={draw:0,size:0,projection:0,info:0},v=Object.create(Viewport.prototype);
  Object.assign(v,{active:true,dirty:true,rafHandle:null,lastFrame:0,previousDraw:false,playbackNotified:0,renderWidth:0,renderHeight:0,host:{clientWidth:640,clientHeight:480},scene:new Scene(),nodeMap:new Map(),quality:{tier:'low',sample:()=>false,resetSamples(){}},animationClock:{state:{playing:true,time:0},tick:()=>false},camera:{updateProjectionMatrix(){calls.projection++;}},renderer:{info:{autoReset:true,reset(){calls.info++;}},setSize(){calls.size++;},render(){calls.draw++;}}});
  return {v,calls};
 };
 await test('hidden viewport rendering submits no GPU work and retains dirty frames',()=>{
  const {v,calls}=renderViewport();
  for(const [width,height] of [[0,480],[640,0],[0,0]]){v.host.clientWidth=width;v.host.clientHeight=height;assert.equal(v.render(),false);assert.equal(v.dirty,true);}
  assert.deepEqual(calls,{draw:0,size:0,projection:0,info:0});v.host.clientWidth=640;v.host.clientHeight=480;v.active=false;assert.equal(v.render(),false);assert.equal(v.dirty,true);assert.equal(calls.draw,0);
  v.capturing=true;assert.equal(v.render(),true,'explicit capture can render an inactive but visible isolated viewport');assert.equal(calls.draw,1);v.capturing=false;v.active=true;v.markDirty();assert.equal(v.render(),true);assert.equal(calls.size,1,'unchanged dimensions never reset the backing canvas');assert.equal(calls.projection,1);
  v.host.clientWidth=800;v.markDirty();assert.equal(v.render(),true);assert.equal(calls.size,2);assert.equal(v.camera.aspect,800/480);
 });
 await test('viewport pause and resume keep one RAF loop and preserve a warm same-size canvas',()=>{
  const oldRequest=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame,queued=new Map(),cancelled=[];let id=0;
  globalThis.requestAnimationFrame=callback=>{queued.set(++id,callback);return id;};globalThis.cancelAnimationFrame=handle=>{cancelled.push(handle);queued.delete(handle);};
  const frame=now=>{assert.equal(queued.size,1);const [handle,callback]=queued.entries().next().value;queued.delete(handle);callback(now);};
  try{
   const {v,calls}=renderViewport(),deltas=[];v.animationClock.tick=delta=>{deltas.push(delta);return false;};v.setActive(true);v.start();v.setActive(true);assert.equal(queued.size,1);frame(1000);assert.equal(calls.draw,1);assert.equal(v.dirty,false);assert.equal(queued.size,1);v.start();assert.equal(queued.size,1);
   const stale=queued.values().next().value;v.setActive(false);v.setActive(false);v.start();assert.equal(cancelled.length,1);assert.equal(queued.size,0);stale(2000);assert.equal(deltas.length,1,'inactive callbacks never advance animation');assert.equal(calls.draw,1);assert.equal(v.dirty,false);
   v.setActive(true);v.setActive(true);v.start();assert.equal(queued.size,1);stale(10500);assert.equal(queued.size,1,'callbacks from a cancelled loop cannot resume after reactivation');assert.equal(deltas.length,1);assert.equal(v.dirty,false,'same-size activation preserves clean backing canvas');frame(11000);assert.equal(deltas.at(-1),0,'hidden time never advances playback');assert.equal(calls.draw,1);assert.equal(calls.size,1);frame(11016);assert.equal(deltas.at(-1),.016);
   v.setActive(false);v.host.clientWidth=800;v.setActive(true);assert.equal(v.dirty,true);frame(12000);assert.equal(calls.draw,2);assert.equal(calls.size,2);assert.equal(deltas.at(-1),0);v.setActive(false);
  }finally{if(oldRequest===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=oldRequest;if(oldCancel===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=oldCancel;}
 });
 const glb=(nodeCount,vertexCount=3)=>{const positions=new Float32Array(vertexCount*3);for(let i=0;i<vertexCount;i++){positions[i*3]=i%3===1?1:0;positions[i*3+1]=i%3===2?1:0;}return packGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:Array.from({length:nodeCount},(_,i)=>i)}],nodes:Array.from({length:nodeCount},(_,i)=>({name:`part${i}`,mesh:0,translation:[i%100,0,Math.floor(i/100)]})),meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:vertexCount,type:'VEC3',min:[0,0,0],max:[1,1,0]}]},new Uint8Array(positions.buffer));};
 await test('actual GLB import accepts over 10,000 small parts and saves/reopens all of them',async()=>{
  const imported=await importGlb(glb(10017),'many-parts.glb');assert.equal(imported.doc.nodes.length,10017);assert.equal(imported.doc.nodes.at(-1).transform.position[0],16);assert.equal(parseProject(serializeProject(imported.doc)).nodes.length,10017);assert.ok(imported.warnings.length);
 });
 await test('dense GLB meshes retain every triangle through editing, viewport geometry and project reopen',async()=>{
  const imported=await importGlb(glb(1,600003),'dense.glb');const node=imported.doc.nodes[0],params=node.geometry.params;
  assert.equal(params.positions.length,1800009);assert.equal(params.indices.length,600003);assert.deepEqual(params.indices.slice(-3),[600000,600001,600002]);assert.deepEqual(params.positions.slice(-9),[0,0,0,1,0,0,0,1,0]);
  const edited=applyBatch(imported.doc,{operations:[{op:'translate',targetId:node.id,space:'world',mode:'delta',value:[2,3,4]},{op:'setAppearance',targetId:node.id,baseColor:'#334455'}]});assert.deepEqual(edited.errors,[]);
  const reopened=parseProject(serializeProject(edited.doc));assert.deepEqual(reopened.nodes[0].geometry,node.geometry);assert.deepEqual(reopened.nodes[0].transform.position,[2,3,4]);assert.equal(reopened.materials.find(m=>m.id===reopened.nodes[0].materialId).baseColor,'#334455');
  const viewport=Object.create(Viewport.prototype);Object.assign(viewport,{scene:new Scene(),nodeMap:new Map(),sharedGeometryCache:new Map(),materialCache:new Map(),frameMaterialKeys:new Map(),selectionHelpers:[],lastSyncedDoc:null,defaultMaterial:new MeshStandardMaterial(),frameScene(){},markDirty(){}});
  try{viewport.sync(reopened);const mesh=viewport.nodeMap.get(node.id).mesh;assert.equal(mesh.geometry.getAttribute('position').count,600003);assert.equal(mesh.geometry.index.count,600003);assert.deepEqual(mesh.position.toArray(),[2,3,4]);}finally{viewport.disposeAllNodes();viewport.defaultMaterial.dispose();}
 });
 await test('GLB validation failure disposes every parsed mesh and material',async()=>{
  let geometryDisposals=0,materialDisposals=0;const gd=BufferGeometry.prototype.dispose,md=Material.prototype.dispose;BufferGeometry.prototype.dispose=function(){geometryDisposals++;return gd.call(this);};Material.prototype.dispose=function(){materialDisposals++;return md.call(this);};
  try{await assert.rejects(()=>importGlb(glb(4,4),'invalid-triangles.glb'),/三角索引/);}finally{BufferGeometry.prototype.dispose=gd;Material.prototype.dispose=md;}
  assert.equal(geometryDisposals,4);assert.equal(materialDisposals,4);
 });
 console.log(`${count} scene capacity checks passed`);
} finally {await server.close();}
