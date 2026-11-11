import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {createServer} from 'vite';
globalThis.indexedDB=indexedDB;
const server=await createServer({server:{middlewareMode:true},appType:'custom'});let count=0;
const test=async(name,fn)=>{await fn();count++;console.log('PASS',name)};
try{
 const {useEditorStore:editor,createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const w=await server.ssrLoadModule('/src/workspace.ts');
 const storage=await server.ssrLoadModule('/src/domain/workspaceStorage.ts');
 editor.setState({doc:createInitialDoc(),messages:[],composerText:'',composerImages:[],past:[],future:[],aiStatus:'idle',aiConfig:{baseURL:'https://example.test',apiKey:'MUST-NOT-PERSIST',model:'mock',useMock:true}});
 await test('progress saving is coalesced without delaying edits, user messages or checkpoints',async()=>{const {progressOnlyChange}=await server.ssrLoadModule('/src/domain/workspaceSavePolicy.ts');const msg={id:'a',text:'task',run:{status:'running',startedAt:1,activity:{turn:1}}};const old={aiStatus:'generating',doc:{},pendingBatch:null,pendingResult:null,past:[],future:[],dirty:false,composerText:'',composerImages:[],messages:[msg],lastRun:{turn:1}};
 assert.equal(progressOnlyChange({...old,lastRun:{turn:2}},old),true);assert.equal(progressOnlyChange({...old,messages:[{...msg,run:{...msg.run,activity:{turn:2}}}]},old),true);
 for(const patch of [{doc:{}},{pendingResult:{}},{composerText:'new instruction'},{messages:[msg,{id:'b',text:'change'}]},{messages:[{...msg,text:'changed'}]},{aiStatus:'previewing'},{messages:[{...msg,run:{...msg.run,status:'stopped'}}]}])assert.equal(progressOnlyChange({...old,...patch},old),false);
 });
 await test('workspace initialization preserves current scene and excludes credentials from durable data',async()=>{await w.initializeWorkspace();await w.flushWorkspace();const saved=await storage.readWorkspace();assert.ok(saved.sessions.length);assert.ok(!JSON.stringify(saved).includes('MUST-NOT-PERSIST'));assert.equal(w.useWorkspaceStore.getState().ready,true)});
 const first=w.useWorkspaceStore.getState().activeId;
 await test('sessions isolate conversation, reference image, composer draft and geometry',async()=>{
  editor.getState().addUserMessage('第一台设备',['data:image/jpeg;base64,YWJj']);editor.getState().setComposerText('继续修改轮子');editor.getState().setComposerImages(['data:image/jpeg;base64,YWJj']);
  editor.getState().applyCommandBatch([{op:'createPrimitive',name:'A',parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_gray'}],'create');
  assert.equal(w.createSession(),true);assert.equal(editor.getState().doc.nodes.length,0);assert.equal(editor.getState().messages.length,0);assert.equal(editor.getState().composerText,'');
  const second=w.useWorkspaceStore.getState().activeId;editor.getState().addUserMessage('第二台设备');assert.equal(w.switchSession(first),true);assert.equal(editor.getState().doc.nodes[0].name,'A');assert.equal(editor.getState().messages[0].text,'第一台设备');assert.equal(editor.getState().composerText,'继续修改轮子');assert.equal(editor.getState().composerImages.length,1);assert.equal(editor.getState().past.length,1);assert.equal(w.switchSession(second),true);assert.equal(editor.getState().messages[0].text,'第二台设备');
 });
 await test('active generation allows new/switch but only locks its own trash action',async()=>{const origin=w.useWorkspaceStore.getState().activeId;for(const status of ['generating','capturing']){w.switchSession(origin);editor.setState({aiStatus:status});assert.equal(w.createSession(),true);assert.equal(w.switchSession(first),true);assert.equal(w.trashSession(origin),false);assert.equal(w.getSessionEditor(origin).getState().aiStatus,status);w.getSessionEditor(origin).setState({aiStatus:'idle'});}w.switchSession(origin)});
 await test('rename remains stable, trash is recoverable and never permanently deletes snapshots',async()=>{w.renameSession(first,'AGV 原型');assert.equal(w.useWorkspaceStore.getState().sessions.find(s=>s.id===first).title,'AGV 原型');assert.equal(w.trashSession(first),true);assert.ok(w.useWorkspaceStore.getState().sessions.find(s=>s.id===first).deletedAt);w.restoreSession(first);assert.equal(w.useWorkspaceStore.getState().sessions.find(s=>s.id===first).deletedAt,null);w.switchSession(first);assert.equal(editor.getState().doc.nodes[0].name,'A');await w.flushWorkspace();const stored=await storage.readWorkspace();assert.equal(stored.sessions.find(s=>s.id===first).snapshot.messages[0].images.length,1)});
 await test('durable storage omits undo stacks but keeps geometry, chat and reference images',async()=>{assert.equal(w.switchSession(first),true);assert.ok(editor.getState().past.length);await w.flushWorkspace();const snap=(await storage.readWorkspace()).sessions.find(s=>s.id===first).snapshot;assert.equal(snap.past,undefined);assert.equal(snap.future,undefined);assert.equal(snap.messages[0].images.length,1);assert.ok(editor.getState().past.length);});
 await test('flushWorkspace retries without reference images after quota errors',async()=>{const {IDBObjectStore}=await import('fake-indexeddb');const original=IDBObjectStore.prototype.put;let blockedImagePayloads=1;IDBObjectStore.prototype.put=function(value,key){const payload=JSON.stringify(value);if(blockedImagePayloads>0&&/base64/.test(payload)){blockedImagePayloads--;this.transaction.abort();throw new DOMException('quota','QuotaExceededError');}return original.call(this,value,key);};try{editor.getState().setComposerImages(['data:image/jpeg;base64,'+'Q'.repeat(120000)]);await w.flushWorkspace();assert.match(w.useWorkspaceStore.getState().error,/参考图/);assert.equal((await storage.readWorkspace()).sessions.find(s=>s.id===first).snapshot.composerImages.length,0);}finally{IDBObjectStore.prototype.put=original;}});
 await test('pinned sessions survive storage and reject changes while generating',async()=>{assert.equal(w.toggleSessionPinned(first),true);await w.flushWorkspace();assert.equal((await storage.readWorkspace()).sessions.find(s=>s.id===first).pinned,true);editor.setState({aiStatus:'generating'});assert.equal(w.toggleSessionPinned(first),false);editor.setState({aiStatus:'idle'});assert.equal(w.useWorkspaceStore.getState().sessions.find(s=>s.id===first).pinned,true)});
 await test('running checkpoint is saved separately from the committed document',async()=>{const base=editor.getState().doc;const ops=[{op:'createPrimitive',name:'preview-only',parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[2,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_gray'}];const result=applyBatch(base,{operations:ops});const batch={requestId:'preview-test',projectId:base.projectId,baseRevision:base.revision,selectedIds:[],summary:'未完成阶段草稿',incomplete:true,continuation:'继续原任务',operations:ops};editor.setState({pendingBatch:batch,pendingResult:result,previewDoc:result.doc,aiStatus:'generating'});await w.flushWorkspace();const saved=await storage.readWorkspace();const snap=saved.sessions.find(s=>s.id===first).snapshot;assert.equal(snap.doc.nodes.length,1);assert.equal(snap.pendingResult.doc.nodes.length,2);assert.equal(snap.wasRunning,true);assert.equal(snap.pendingBatch.incomplete,true)});
 await test('pending preview and per-turn execution survive session switching without applying',async()=>{
  editor.setState({aiStatus:'previewing'});const draft=structuredClone(editor.getState().pendingResult.doc);const id=editor.getState().addUserMessage('继续调整');editor.getState().updateMessageRun(id,{status:'preview',startedAt:100,endedAt:200});
  assert.equal(w.createSession(),true);assert.equal(editor.getState().pendingResult,null);assert.equal(w.switchSession(first),true);assert.deepEqual(editor.getState().pendingResult.doc,draft);assert.equal(editor.getState().doc.nodes.length,1);assert.equal(editor.getState().messages.find(m=>m.id===id).run.status,'preview');
  editor.setState(state=>({aiStatus:'generating',messages:[...state.messages,{id:'queued-guide',role:'user',text:'八米高',createdAt:Date.now(),steering:{runId:id,status:'queued'}}]}));editor.getState().updateMessageRun(id,{status:'running'});await w.flushWorkspace();
 });
 await test('stored data can hydrate in a fresh manager without losing references or draft',async()=>{await w.flushWorkspace();const fresh=await server.ssrLoadModule('/src/workspace.ts?reload-test');editor.setState({doc:createInitialDoc(),messages:[],composerText:'',composerImages:[]});await fresh.initializeWorkspace();assert.equal(editor.getState().messages[0].text,'第一台设备');assert.equal(editor.getState().composerText,'继续修改轮子');assert.equal(editor.getState().doc.nodes.length,1);assert.equal(editor.getState().aiStatus,'previewing');assert.equal(editor.getState().previewDoc.nodes.length,2);assert.equal(editor.getState().pendingBatch.incomplete,true);assert.match(editor.getState().messages.at(-1).text,/阶段草稿/);assert.equal(editor.getState().messages.find(m=>m.text==='继续调整').run.status,'stopped');assert.equal(editor.getState().messages.find(m=>m.id==='queued-guide').steering.status,'interrupted');editor.getState().discardPending();await fresh.flushWorkspace()});
 await test('atomic revision guard rejects stale tab writes instead of overwriting newer workspace',async()=>{const current=await storage.readWorkspace();await assert.rejects(()=>storage.writeWorkspace({version:1,activeId:current.activeId,sessions:[]},current.revision-1),/另一个标签页/);assert.equal((await storage.readWorkspace()).sessions.length,current.sessions.length)});
 await test('unchanged multi-session startup does not write and tracks editors only on navigation',async()=>{
  const before=await storage.readWorkspace(),fresh=await server.ssrLoadModule('/src/workspace.ts?idle-startup');
  assert.ok(before.sessions.length>1);
  const {IDBObjectStore}=await import('fake-indexeddb'),put=IDBObjectStore.prototype.put,writes=[];
  IDBObjectStore.prototype.put=function(value,key){writes.push(key);return put.call(this,value,key)};
  try{
   await fresh.initializeWorkspace();await fresh.flushWorkspace();
   assert.deepEqual(writes,[]);assert.equal((await storage.readWorkspace()).revision,before.revision);
   const state=fresh.useWorkspaceStore.getState(),other=state.sessions.find(s=>s.id!==state.activeId&&!s.deletedAt);
   assert.ok(fresh.getSessionEditor(state.activeId));
   for(const session of state.sessions)if(session.id!==state.activeId){assert.equal(fresh.getSessionEditor(session.id),undefined);assert.equal(fresh.sessionIsRunning(session.id),false)}
   assert.equal(fresh.anySessionRunning(),false);
   const backup=JSON.parse(fresh.exportWorkspaceBackup());assert.ok(backup.sessions.some(s=>s.title===other.title));assert.equal(fresh.getSessionEditor(other.id),undefined);
   // A new read resets the IDB identity cache; reload before testing reference reuse.
   const next=await server.ssrLoadModule('/src/workspace.ts?idle-startup-reuse');await next.initializeWorkspace();
   next.getSessionEditor(next.useWorkspaceStore.getState().activeId).getState().setComposerText('after recovery');await next.flushWorkspace();
   for(const key of writes){if(key==='current')continue;const tuple=JSON.parse(key);assert.ok(tuple[2]===null||tuple[2]==='composerText',`unchanged snapshot rewritten: ${key}`)}
   assert.equal(next.switchSession(other.id),true);assert.ok(next.getSessionEditor(other.id));await next.flushWorkspace();
   const saved=await storage.readWorkspace();assert.equal(saved.sessions.find(s=>s.id===other.id).snapshot.doc.projectId,other.snapshot.doc.projectId);
  }finally{IDBObjectStore.prototype.put=put}
 });
 await test('normal persistence reuses durable sessions while dropping history and oversized thumbnails',async()=>{
  const {prepareSessionsForStorage}=await server.ssrLoadModule('/src/domain/workspacePersist.ts');
  const session=w.useWorkspaceStore.getState().sessions[0],{past,future,...snapshot}=session.snapshot;
  const durable={...session,snapshot},sessions=[durable];assert.equal(prepareSessionsForStorage(sessions,'normal'),sessions);
  const withHistory={...durable,snapshot:{...snapshot,past:[snapshot.doc],future:[]}},oversized={...durable,sceneThumbnail:'x'.repeat(160001)};
  const prepared=prepareSessionsForStorage([withHistory,oversized],'normal');
  assert.equal('past' in prepared[0].snapshot,false);assert.equal('future' in prepared[0].snapshot,false);assert.equal(prepared[1].sceneThumbnail,undefined);
  for(const field of Object.keys(snapshot))assert.equal(prepared[0].snapshot[field],snapshot[field]);assert.equal(prepared[1].snapshot,snapshot);
 });
 await test('recovery preserves idle identity and only replaces interrupted snapshot fields',()=>{
  const session=w.useWorkspaceStore.getState().sessions[0],idle={...session,snapshot:{...session.snapshot,wasRunning:false,messages:[{id:'done',role:'assistant',text:'done',createdAt:1}]}};
  assert.equal(w.recoverSession(idle),idle);
  for(const patch of [
   {wasRunning:true},
   {messages:[{...idle.snapshot.messages[0],run:{status:'running',startedAt:1,activity:{lastEventAt:2}}}]},
   {messages:[{...idle.snapshot.messages[0],steering:{status:'queued',runId:'old'}}]},
  ]){
   const source={...idle,snapshot:{...idle.snapshot,...patch}},recovered=w.recoverSession(source);
   assert.notEqual(recovered,source);assert.equal(recovered.snapshot.wasRunning,false);
   for(const field of Object.keys(source.snapshot))if(field!=='messages'&&field!=='wasRunning')assert.equal(recovered.snapshot[field],source.snapshot[field]);
   assert.equal(w.recoverSession(recovered),recovered);
   if(patch.messages?.[0].steering){assert.equal(recovered.snapshot.messages[0].steering.status,'interrupted');assert.equal(recovered.snapshot.messages.length,1)}
   else assert.match(recovered.snapshot.messages.at(-1).text,/不会自动继续调用模型/);
  }
 });
 await test('built-in module registry rejects duplicates and unknown module IDs',async()=>{const {createModuleRegistry}=await server.ssrLoadModule('/src/modules/registry.ts');const registry=createModuleRegistry();const module={id:'modeling',title:'建模',version:1,Viewport:()=>null,Objects:()=>null,Properties:()=>null,documentFormat:'chat3d-project'};registry.register(module);assert.equal(registry.get('modeling'),module);assert.throws(()=>registry.register(module));assert.throws(()=>registry.get('unknown'));assert.equal(registry.list().length,1)});
 await test('failed stale-tab flush blocks navigation but keeps idle workspace backup available',async()=>{
  for(const session of w.useWorkspaceStore.getState().sessions)w.getSessionEditor(session.id)?.setState({aiStatus:'idle',pendingBatch:null,pendingResult:null});
  editor.setState({aiStatus:'idle',pendingBatch:null,pendingResult:null});
  const current=await storage.readWorkspace();await storage.writeWorkspace(current,current.revision);
  w.getSessionEditor(w.useWorkspaceStore.getState().activeId).getState().setComposerText('blocked tab draft');await w.flushWorkspace();
  assert.match(w.useWorkspaceStore.getState().error,/另一个标签页/);
  const active=w.useWorkspaceStore.getState().activeId;
  assert.equal(w.switchSession(first),false);assert.equal(w.createSession(),false);
  assert.equal(w.useWorkspaceStore.getState().activeId,active);
  assert.ok(JSON.parse(w.exportWorkspaceBackup()).sessions.some(item=>item.composerText==='blocked tab draft'));
 });
 console.log(`${count} workspace checks passed using fake IndexedDB`);
}finally{await server.close()}
