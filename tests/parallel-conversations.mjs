import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {createServer} from 'vite';
globalThis.indexedDB=indexedDB;
let requests=[],deferResponses=false;
globalThis.fetch=async(url,init)=>{
 let stream;
 const response=new Response(new ReadableStream({start(controller){stream=controller;}}),{headers:{'content-type':'text/event-stream','x-chat3d-proxy':'1'}});
 const item={url,init,stream};requests.push(item);if(deferResponses)return new Promise(resolve=>item.release=()=>resolve(response));return response;
};
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let count=0;
const test=async(name,fn)=>{await fn();console.log('PASS',name);count++;};
const tick=()=>new Promise(r=>setTimeout(r,20));
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.ok(predicate(),'condition timed out');};
const reply=(request,content)=>{
 const encoder=new TextEncoder();request.stream.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));request.stream.close();
};
const output=name=>JSON.stringify({summary:name,operations:[{op:'createPrimitive',name,geometry:{type:'box',params:{width:1,height:1,depth:1}}}]});
const config={baseURL:'https://example.test/v1',apiKey:'SECRET-A-NOT-IN-SNAPSHOTS',model:'model-a',useMock:false,agentMode:'single',stream:true,taskBudget:{maxMinutes:10,maxRounds:12,maxReportedTokens:12345}};
try{
 const {useEditorStore:ui,createInitialDoc,createEditorStore}=await server.ssrLoadModule('/src/store.ts');
 const w=await server.ssrLoadModule('/src/workspace.ts');
 const storage=await server.ssrLoadModule('/src/domain/workspaceStorage.ts');
 const runtime=await server.ssrLoadModule('/src/runtime/conversationController.ts');
 ui.setState({aiConfig:config});await w.initializeWorkspace();
 const a=w.useWorkspaceStore.getState().activeId, A=w.getSessionEditor(a), ca=runtime.conversationController(A);
 let b,B,cb,c,C,cc,pa,pb;
 await test('two mocked streaming runs keep independent inputs and configuration across navigation',async()=>{
  ui.getState().setComposerText('创建 A');pa=ca.send();await wait(()=>requests.length===1);
  assert.equal(w.createSession(),true);b=w.useWorkspaceStore.getState().activeId;B=w.getSessionEditor(b);cb=runtime.conversationController(B);
  ui.setState({aiConfig:{...config,apiKey:'SECRET-B-NOT-IN-SNAPSHOTS',model:'model-b',taskBudget:{...config.taskBudget,maxReportedTokens:54321}}});
  ui.getState().setComposerText('创建 B');pb=cb.send();await wait(()=>requests.length===2);
  assert.equal(runtime.useConversationRuns.getState().activeCount,2);assert.equal(requests[0].init.signal.aborted,false);
  assert.match(requests[0].init.body,/创建 A/);assert.doesNotMatch(requests[0].init.body,/创建 B/);
  assert.match(requests[1].init.body,/创建 B/);assert.doesNotMatch(requests[1].init.body,/创建 A/);
  assert.equal(JSON.parse(requests[0].init.body).model,'model-a');assert.equal(JSON.parse(requests[1].init.body).model,'model-b');
  assert.notEqual(requests[0].init.signal,requests[1].init.signal);
  assert.equal(w.switchSession(a),true);assert.equal(ui.getState().aiStatus,'generating');assert.equal(ca.ui.getState().running,true);
 });
 await test('third start refuses without consuming composer text/images or queuing paid work',async()=>{
  assert.equal(w.createSession(),true);c=w.useWorkspaceStore.getState().activeId;C=w.getSessionEditor(c);cc=runtime.conversationController(C);
  ui.setState({composerText:'创建 C',composerImages:['data:image/png;base64,YQ==']});await cc.send();
  assert.equal(requests.length,2);assert.equal(C.getState().composerText,'创建 C');assert.equal(C.getState().composerImages.length,1);assert.equal(C.getState().messages.length,0);assert.match(cc.ui.getState().notice,/2 个会话.*输入已保留/);
 });
 await test('same conversation remains sequential; pending input is preserved for single mode',async()=>{
  A.setState({composerText:'下一条 A'});await ca.send();assert.equal(requests.length,2);assert.equal(A.getState().composerText,'下一条 A');
 });
 await test('per-session stop and late streamed output cannot affect another task or active project',async()=>{
  cb.cancel();assert.equal(requests[1].init.signal.aborted,true);assert.equal(requests[0].init.signal.aborted,false);
  assert.equal(B.getState().aiStatus,'cancelled');assert.equal(A.getState().aiStatus,'generating');assert.equal(runtime.useConversationRuns.getState().activeCount,1);
  assert.throws(()=>reply(requests[1],output('LATE B')),/already closed/);await pb;assert.equal(B.getState().pendingResult,null);assert.equal(C.getState().messages.length,0);assert.equal(C.getState().composerText,'创建 C');
  await tick();assert.equal(requests.length,2,'freed slot must not auto-run refused input');
 });
 await test('background result remains preview-only and apply/undo bind to originating project',async()=>{
  reply(requests[0],output('A BOX'));await pa;
  assert.equal(A.getState().aiStatus,'previewing');assert.equal(A.getState().doc.nodes.length,0);assert.equal(A.getState().pendingResult.doc.nodes[0].name,'A BOX');
  assert.equal(C.getState().pendingResult,null);assert.equal(ui.getState().doc.projectId,C.getState().doc.projectId);assert.equal(runtime.useConversationRuns.getState().activeCount,0);
  ca.commit();assert.equal(A.getState().doc.nodes[0].name,'A BOX');assert.equal(C.getState().doc.nodes.length,0);assert.equal(A.getState().past.length,1);
  A.getState().undo();assert.equal(A.getState().doc.nodes.length,0);assert.equal(C.getState().past.length,0);A.getState().redo();assert.equal(A.getState().doc.nodes.length,1);
 });
 await test('failure stays in its session; stale result cannot commit across project/revision boundary',async()=>{
  B.setState({composerText:'B fails'});const run=cb.send();await wait(()=>requests.length===3);requests[2].stream.error(new Error('provider failed SECRET-B-NOT-IN-SNAPSHOTS'));await run;
  assert.equal(B.getState().aiStatus,'error');assert.match(B.getState().aiError,/本次调整未成功|场景未修改/);assert.doesNotMatch(B.getState().aiError,/SECRET-B/);assert.equal(C.getState().aiError,null);assert.doesNotMatch(JSON.stringify(B.getState().messages),/SECRET-B/);
  assert.ok(B.getState().lastRun.events.some(event=>/provider failed/.test(event)),'failure diagnostics retain the provider reason');
  const old=A.getState().doc;A.setState({composerText:'A stale'});const stale=ca.send();await wait(()=>requests.length===4);A.setState({doc:createInitialDoc()});reply(requests[3],output('STALE'));await stale;
  assert.notEqual(A.getState().doc.projectId,old.projectId);assert.equal(A.getState().doc.nodes.length,0);assert.equal(A.getState().pendingResult,null);
 });
 await test('a cancelled late HTTP response cannot release or overwrite the same conversation replacement run',async()=>{
  const D=createEditorStore(),cd=runtime.conversationController(D);deferResponses=true;
  D.getState().setComposerText('old D');const before=requests.length,old=cd.send('guide',{config});await wait(()=>requests.length===before+1);cd.cancel();D.getState().setComposerText('new D');const next=cd.send('guide',{config});await wait(()=>requests.length===before+2);
  reply(requests[before],output('OLD D'));requests[before].release();await old;assert.equal(runtime.useConversationRuns.getState().activeCount,1);assert.equal(D.getState().aiStatus,'generating');assert.equal(D.getState().pendingResult,null);
  reply(requests[before+1],output('NEW D'));requests[before+1].release();await next;deferResponses=false;assert.equal(D.getState().pendingResult.doc.nodes[0].name,'NEW D');assert.equal(D.getState().messages.some(m=>m.role==='assistant'&&m.text.includes('OLD D')),false);assert.equal(runtime.useConversationRuns.getState().activeCount,0);
 });
 await test('async storage writes/navigation preserve all originating snapshots without credentials',async()=>{
  const flushing=w.flushWorkspace();w.switchSession(b);B.getState().setComposerText('独立 B 草稿');w.switchSession(c);C.getState().setComposerText('独立 C 草稿');await flushing;await w.flushWorkspace();
  const saved=await storage.readWorkspace();assert.equal(saved.activeId,c);assert.equal(saved.sessions.find(s=>s.id===b).snapshot.composerText,'独立 B 草稿');assert.equal(saved.sessions.find(s=>s.id===c).snapshot.composerText,'独立 C 草稿');
  assert.doesNotMatch(JSON.stringify(saved),/SECRET-|apiKey|baseURL/);assert.doesNotMatch(w.exportWorkspaceBackup(),/SECRET-|apiKey/);
 });
 await test('a running conversation cannot globally block saving another project or editing its metadata',async()=>{
  const {saveLibraryProject}=await server.ssrLoadModule('/src/domain/workspaceLibrary.ts');w.switchSession(c);A.setState({aiStatus:'generating'});
  await saveLibraryProject();assert.ok(w.useWorkspaceStore.getState().sessions.find(s=>s.id===c).librarySavedAt);assert.equal(w.useWorkspaceStore.getState().sessions.find(s=>s.id===a).librarySavedAt,undefined);
  const target=w.useWorkspaceStore.getState().sessions.find(s=>s.id===c);await w.editLibrarySessionMetadata(c,{name:'C saved',category:'其他'},target.libraryMetadataRevision??0);await assert.rejects(w.editLibrarySessionMetadata(a,{name:'cannot edit active A'},0),/当前任务/);A.setState({aiStatus:'idle'});
 });
 await test('reload recovery marks every unfinished session interrupted and never resumes',async()=>{
  const saved=await storage.readWorkspace(),before=requests.length;
  for(const entry of saved.sessions.slice(0,2)){
   entry.snapshot.wasRunning=true;entry.snapshot.messages.push({id:'run',role:'user',text:'unfinished',createdAt:1,run:{status:'running',startedAt:1}},{id:'guide',role:'user',text:'queued',createdAt:2,steering:{runId:'run',status:'queued'}});
   const recovered=w.recoverSession(entry);assert.equal(recovered.snapshot.wasRunning,false);assert.equal(recovered.snapshot.messages.find(m=>m.id==='run').run.status,'stopped');assert.equal(recovered.snapshot.messages.find(m=>m.id==='guide').steering.status,'interrupted');assert.match(recovered.snapshot.messages.at(-1).text,/不会自动继续调用模型/);
  }
  await tick();assert.equal(requests.length,before);
 });
 await test('explicit wrong-project preview application is rejected even at matching revision',async()=>{
  const origin=createEditorStore(),other=createInitialDoc();origin.setState({aiStatus:'previewing',pendingBatch:{baseRevision:0,projectId:other.projectId,requestId:'wrong',operations:[],summary:'bad',selectedIds:[]},pendingResult:{doc:other,applied:[],errors:[]}});origin.getState().confirmPending();assert.notEqual(origin.getState().doc.projectId,other.projectId);assert.equal(origin.getState().aiStatus,'error');
 });
 await test('isolated capture cannot borrow the live viewport as background evidence',async()=>{
  const capture=await server.ssrLoadModule('/src/scene/capture.ts');let used=0;const unregister=capture.registerSceneCapture(async()=>{used++;return 'data:image/png;base64,V1JPTkc=';});
  await assert.rejects(()=>capture.captureIsolatedSceneEvidence(A.getState().doc,'front'),/不会借用其他会话/);assert.equal(used,0);unregister();
 });
 await test('renderer leases serialize access, skip cancelled waiters and recover after failures',async()=>{
  const {serializeCapture}=await server.ssrLoadModule('/src/scene/isolatedGpuCapture.ts');let active=0,max=0,seen=[],release;
  const capture=serializeCapture(async doc=>{active++;max=Math.max(active,max);seen.push(doc.projectId);if(doc.projectId==='first')await new Promise(r=>release=r);active--;if(doc.projectId==='failure')throw Error('test failure');return doc.projectId;});
  const doc=createInitialDoc(),first=capture({...doc,projectId:'first'},'front');await wait(()=>release);const abort=new AbortController();const cancelled=capture({...doc,projectId:'cancelled'},'front',undefined,undefined,abort.signal);const cancellation=assert.rejects(cancelled,/已停止/);const second=capture({...doc,projectId:'second'},'side');abort.abort();release();assert.equal(await first,'first');await cancellation;assert.equal(await second,'second');assert.equal(max,1);assert.deepEqual(seen,['first','second']);await assert.rejects(capture({...doc,projectId:'failure'},'front'),/test failure/);assert.equal(await capture({...doc,projectId:'recovered'},'front'),'recovered');
 });
 await test('parallel software captures return their own document and backend evidence',async()=>{
  const capture=await server.ssrLoadModule('/src/scene/capture.ts');
  globalThis.CanvasRenderingContext2D=class{};globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
  let images=0;globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({putImageData(){}}),toDataURL:()=>'data:image/png;base64,'+Buffer.from(String(++images)).toString('base64')})};
  const d1=A.getState().doc.nodes.length?A.getState().doc: (await server.ssrLoadModule('/src/domain/commands.ts')).applyBatch(createInitialDoc(),{operations:JSON.parse(output('one')).operations.map(op=>({...op,parentId:null,materialId:'mat_gray',transform:{position:[0,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}))}).doc;
  const d2={...structuredClone(d1),projectId:'different-project',revision:12};
  const [one,two]=await Promise.all([capture.captureIsolatedSceneEvidence(d1,'front'),capture.captureIsolatedSceneEvidence(d2,'side',[d2.nodes[0].id])]);
  assert.equal(one.projectId,d1.projectId);assert.equal(one.revision,d1.revision);assert.equal(one.view,'front');assert.equal(two.projectId,'different-project');assert.equal(two.revision,12);assert.equal(two.view,'side');assert.deepEqual(two.targetIds,[d2.nodes[0].id]);assert.equal(one.targetIds,undefined);assert.equal(one.backend,'software');assert.equal(two.backend,'software');assert.notEqual(one.image,two.image);assert.equal(one.softwareInfo.width,640);
  delete globalThis.document;delete globalThis.CanvasRenderingContext2D;delete globalThis.ImageData;
 });
 console.log(`${count} parallel conversation checks passed (mocked models only)`);
}finally{await server.close();}
