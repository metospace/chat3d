import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {Matrix4,Quaternion,Vector3} from 'three';
globalThis.indexedDB=indexedDB;
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
try {
 const load=path=>server.ssrLoadModule('/src/'+path);
 const {createInitialDoc,useEditorStore:editor,createEditorStore}=await load('store.ts');
 const {applyBatch}=await load('domain/commands.ts');
 const {createAnimationEvaluator}=await load('domain/animation.ts');
 const assets=await load('domain/modelAssets.ts'),storage=await load('domain/modelAssetStorage.ts');
 const w=await load('workspace.ts'),ws=await load('domain/workspaceStorage.ts');
 const box=(x=0)=>({op:'createPrimitive',parentId:null,name:'box',geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_gray',transform:{position:[x,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}});
 const base=applyBatch(createInitialDoc(),{operations:[box()]}).doc,id=base.nodes[0].id;
 const animated={...base,animation:{version:1,name:'spin',duration:2,loop:false,tracks:[{id:'spin',name:'spin',targetIds:[id],channel:'rotation',axis:[0,1,0],pivot:[0,0,0],keyframes:[{time:0,value:0},{time:2,value:180}]}]}};
 const close=(actual,expected)=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-7,`${actual} != ${expected}`));
 await test('manual and assembly copies retain poses, pivot placement and undo/redo',()=>{
  for(const command of [{op:'duplicateSelection',targetIds:[id],count:3,axis:'x',gap:1},{op:'duplicateAssembly',targetId:id,offset:[5,0,0]}]){
   const result=applyBatch(animated,{operations:[command]});assert.deepEqual(result.errors,[]);
   const poses=createAnimationEvaluator(result.doc)(1);
   for(const copy of result.doc.nodes.slice(1)){close(poses.get(copy.id).transform.position,copy.transform.position);assert.notDeepEqual(poses.get(copy.id).transform.rotationQuaternion,copy.transform.rotationQuaternion);}
   assert.equal(new Set(result.doc.animation.tracks.map(t=>t.id)).size,result.doc.animation.tracks.length);
   const store=createEditorStore({doc:animated});store.getState().applyCommandBatch([command],'copy');store.getState().undo();assert.deepEqual(store.getState().doc.animation,animated.animation);store.getState().redo();assert.equal(createAnimationEvaluator(store.getState().doc)(1).has(store.getState().doc.nodes[1].id),true);
  }
 });
 await test('translation rebases self rotation instead of orbiting the old origin',()=>{
  for(const command of [{op:'editSelection',targetIds:[id],change:{kind:'position',value:[10,0,0]}},{op:'translate',targetId:id,mode:'delta',space:'world',value:[10,0,0]}]){
   const result=applyBatch(animated,{operations:[command]});assert.deepEqual(result.errors,[]);close(result.doc.animation.tracks[0].pivot,[10,0,0]);close(createAnimationEvaluator(result.doc)(1).get(id).transform.position,[10,0,0]);
  }
 });
 await test('rotation and scaling transform displacement keyframes and expression space',()=>{
  for(const expression of [false,true]){
   const track={id:'move',name:'move',targetIds:[id],channel:'position',...(expression?{expression:['t',0,0]}:{keyframes:[{time:0,value:[0,0,0]},{time:2,value:[2,0,0]}]})};
   let doc={...base,animation:{...animated.animation,tracks:[track]}};
   const original=createAnimationEvaluator(doc)(1).get(id).transform.position;
   const result=applyBatch(doc,{operations:[{op:'editSelection',targetIds:[id],change:{kind:'rotation',value:[0,0,90]}},{op:'editSelection',targetIds:[id],change:{kind:'size',value:2}}]});assert.deepEqual(result.errors,[]);
   const delta=new Matrix4().compose(new Vector3(...result.doc.nodes[0].transform.position),new Quaternion(...result.doc.nodes[0].transform.rotationQuaternion),new Vector3(...result.doc.nodes[0].transform.scale)).multiply(new Matrix4().compose(new Vector3(...base.nodes[0].transform.position),new Quaternion(),new Vector3(1,1,1)).invert());
   close(createAnimationEvaluator(result.doc)(1).get(id).transform.position,new Vector3(...original).applyMatrix4(delta).toArray());
  }
 });
 await test('internal follow sources remap while external follow and partial shared transforms reject atomically',()=>{
  const two=applyBatch(base,{operations:[box(3)]}).doc,other=two.nodes[1].id;
  const doc={...two,animation:{...animated.animation,tracks:[animated.animation.tracks[0],{id:'follow',name:'follow',targetIds:[other],channel:'follow',sourceId:id,start:0,end:2}]}};
  const copied=applyBatch(doc,{operations:[{op:'duplicateSelection',targetIds:[id,other],count:2,axis:'x',gap:1}]});assert.deepEqual(copied.errors,[]);assert.equal(copied.doc.animation.tracks.at(-1).sourceId,copied.doc.nodes[2].id);assert.equal(createAnimationEvaluator(copied.doc)(1).has(copied.doc.nodes[3].id),true);
  for(const command of [{op:'duplicateSelection',targetIds:[other],count:2,axis:'x',gap:1},{op:'editSelection',targetIds:[other],change:{kind:'position',value:[10,0,0]}}]){const r=applyBatch(doc,{operations:[command]});assert.match(r.errors[0].message,/跟随/);assert.equal(r.doc,doc);}
  const shared={...two,animation:{...animated.animation,tracks:[{...animated.animation.tracks[0],targetIds:[id,other]}]}};const r=applyBatch(shared,{operations:[{op:'editSelection',targetIds:[id],change:{kind:'position',value:[1,0,0]}}]});assert.match(r.errors[0].message,/共享动画/);assert.equal(r.doc,shared);
 });
 await w.initializeWorkspace();
 await test('asset editing refuses oversized project before changing workspace',async()=>{
  const asset=assets.createModelAsset(base,[id],{name:'budget',category:'其他'});await storage.saveModelAsset(asset);
  const before=w.useWorkspaceStore.getState().activeId,Encoder=globalThis.TextEncoder;
  globalThis.TextEncoder=class extends Encoder{encode(text){return text.startsWith('{"format":"chat3d-project"')?{length:401*1024*1024}:super.encode(text);}};
  try{const {openLibraryAsset}=await load('domain/libraryNavigation.ts');await assert.rejects(()=>openLibraryAsset(assets.summarizeAsset(asset)),/400 MiB/);assert.equal(w.useWorkspaceStore.getState().activeId,before);}finally{globalThis.TextEncoder=Encoder;}
 });
 await test('rename-only version save preserves mapped contract and immutable v1',async()=>{
  const asset=assets.createModelAsset(base,[id],{name:'contract',category:'其他'});asset.contract={purpose:'搬运',features:['机身'],anchors:[{id:'mount',name:'mount',kind:'mount',nodeId:id,point:[0,.5,0],normal:[0,1,0]}],clearance:{min:[-1,0,-1],max:[1,2,1]}};await storage.saveModelAsset(asset);
  const {openLibraryAsset}=await load('domain/libraryNavigation.ts'),{saveLibraryProject}=await load('domain/workspaceLibrary.ts');await openLibraryAsset(assets.summarizeAsset(asset));editor.getState().applyCommandBatch([{op:'rename',targetId:id,name:'renamed'}],'rename');await saveLibraryProject();
  assert.deepEqual((await storage.readModelAsset(asset.id,2)).contract,asset.contract);assert.deepEqual((await storage.readModelAsset(asset.id,1)),asset);
  const doc=assets.assetDocument(asset);doc.nodes[0].geometry.params.width=2;assert.throws(()=>assets.createModelAsset(doc,[id],{name:'bad',category:'其他',previous:asset}),/连接点/);
 });
 await test('quota degradation combines image stripping with trash omission without losing core text',async()=>{
  const trash=w.useWorkspaceStore.getState().activeId;w.createSession();w.getSessionEditor(trash).getState().setComposerText('TRASH_QUOTA');w.trashSession(trash);const active=w.useWorkspaceStore.getState().activeId;editor.getState().setComposerText('核心文字');editor.getState().setComposerImages(['IMAGE_QUOTA']);
  const put=IDBObjectStore.prototype.put;let failures=0;IDBObjectStore.prototype.put=function(value,key){if(/TRASH_QUOTA|IMAGE_QUOTA/.test(JSON.stringify(value))){failures++;throw new DOMException('quota','QuotaExceededError');}return put.call(this,value,key);};
  try{await w.flushWorkspace();const durable=await ws.readWorkspace();assert.equal(failures,2);assert.equal(durable.sessions.some(s=>s.id===trash),false);assert.equal(durable.sessions.find(s=>s.id===active).snapshot.composerText,'核心文字');assert.deepEqual(durable.sessions.find(s=>s.id===active).snapshot.composerImages,[]);assert.match(w.useWorkspaceStore.getState().error,/参考图及回收站/);}finally{IDBObjectStore.prototype.put=put;}
 });
 await test('restart waits for pending composer persistence and refuses failed saves',async()=>{
  // Exercise the real restart client boundary without exiting a native process.
  const {relaunchInstalledUpdate,useAppUpdate}=await load('domain/appUpdateClient.ts');let restarts=0;globalThis.window={__TAURI_INTERNALS__:{invoke:async(command)=>{assert.equal(command,'plugin:process|restart');const saved=await ws.readWorkspace();assert.equal(saved.sessions.find(s=>s.id===w.useWorkspaceStore.getState().activeId).snapshot.composerText,'restart draft');restarts++;}}};
  editor.getState().setComposerImages([]);editor.getState().setComposerText('restart draft');useAppUpdate.setState({busy:false});await relaunchInstalledUpdate();assert.equal(restarts,1);
  w.useWorkspaceStore.setState({error:'保存失败'});await relaunchInstalledUpdate();assert.equal(restarts,1);assert.match(useAppUpdate.getState().error,/尚未保存成功/);w.useWorkspaceStore.setState({error:null});delete globalThis.window;
 });
 await test('legal 500 MiB team session budget does not regress to portable 400 MiB on recovery',async()=>{
  const {MAX_TEAM_SCENE_BYTES}=await load('domain/project.ts'),Encoder=globalThis.TextEncoder;
  globalThis.TextEncoder=class extends Encoder{encode(text){return text.startsWith('{"format":"chat3d-project"')?{length:450*1024*1024}:super.encode(text);}};
  try{assert.equal(w.createSession(base,{title:'team-large',moduleKind:'scene'},MAX_TEAM_SCENE_BYTES),true);await w.flushWorkspace();const fresh=await server.ssrLoadModule('/src/workspace.ts?team-budget');await fresh.initializeWorkspace();assert.equal(fresh.useWorkspaceStore.getState().error,null);assert.equal(fresh.useWorkspaceStore.getState().sessions.find(s=>s.title==='team-large').snapshot.doc.projectId,base.projectId);}finally{globalThis.TextEncoder=Encoder;}
 });
 await test('bad session is isolated durably, good sessions stay navigable and rescue keeps original',async()=>{
  const current=await ws.readWorkspace(),good=current.sessions[0],bad={...structuredClone(good),id:'broken',snapshot:{...good.snapshot,doc:{schemaVersion:99}}};await ws.writeWorkspace({version:1,activeId:'broken',sessions:[bad,...current.sessions]},current.revision);
  const fresh=await server.ssrLoadModule('/src/workspace.ts?integrity-recovery');await fresh.initializeWorkspace();assert.equal(fresh.useWorkspaceStore.getState().error,null);assert.equal(fresh.useWorkspaceStore.getState().sessions.some(s=>s.id===good.id),true);assert.equal(fresh.switchSession(good.id),true);assert.deepEqual(JSON.parse(fresh.exportRecoverySession(0)).data,JSON.parse(JSON.stringify(bad)));await fresh.flushWorkspace();assert.deepEqual((await ws.readWorkspace()).recoverySessions[0].data,bad);
 });
 await test('startup persists chunk isolation once and retains healthy untracked sessions',async()=>{
  const current=await ws.readWorkspace(),good=current.sessions[0],broken={...structuredClone(good),id:'broken-chunks'};
  const seededRevision=await ws.writeWorkspace({...current,sessions:[broken,...current.sessions]},current.revision);
  const {promise,resolve,reject}=Promise.withResolvers();const request=indexedDB.open('chat3d.workspace.v1',2);
  request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').delete(JSON.stringify(['session',broken.id,'doc','chunk',0]));tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)}};await promise;
  const fresh=await server.ssrLoadModule('/src/workspace.ts?chunk-isolation');await fresh.initializeWorkspace();
  assert.equal(fresh.useWorkspaceStore.getState().error,null);const saved=await ws.readWorkspace();assert.equal(saved.revision,seededRevision+1);
  assert.deepEqual(saved.sessions,current.sessions);assert.equal(saved.recoverySessions.at(-1).data.session.id,broken.id);
  const next=await server.ssrLoadModule('/src/workspace.ts?chunk-isolation-reload');await next.initializeWorkspace();await next.flushWorkspace();assert.equal((await ws.readWorkspace()).revision,saved.revision);
 });
 await test('untracked recovered previews still reject metadata edits',async()=>{
  const current=await ws.readWorkspace(),good=current.sessions[0],doc=good.snapshot.doc;
  const preview={...structuredClone(good),id:'idle-preview',snapshot:{...good.snapshot,wasRunning:false,pendingBatch:{projectId:doc.projectId,baseRevision:doc.revision,operations:[]},pendingResult:{doc,errors:[]}}};
  await ws.writeWorkspace({...current,sessions:[...current.sessions,preview]},current.revision);
  const fresh=await server.ssrLoadModule('/src/workspace.ts?untracked-preview');await fresh.initializeWorkspace();assert.equal(fresh.getSessionEditor(preview.id),undefined);
  await assert.rejects(()=>fresh.editLibrarySessionMetadata(preview.id,{name:'must not change'},preview.libraryMetadataRevision??0),/预览/);
  assert.equal(fresh.useWorkspaceStore.getState().sessions.find(s=>s.id===preview.id).title,preview.title);
 });
 console.log(`${count} data integrity checks passed`);
} finally {await server.close();}
