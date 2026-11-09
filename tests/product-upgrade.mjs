import assert from 'node:assert/strict';import fs from 'node:fs';import {indexedDB} from 'fake-indexeddb';import {createServer} from 'vite';globalThis.indexedDB=indexedDB;
const server=await createServer({server:{middlewareMode:true},appType:'custom'});let count=0;const test=async(n,f)=>{await f();count++;console.log('PASS',n)};
try{
 const {validateGeometry,validateDocument}=await server.ssrLoadModule('/src/domain/types.ts');const {buildPrimitiveGeometry}=await server.ssrLoadModule('/src/scene/geometry.ts');const {industrialRecipe,RECIPE_NAMES}=await server.ssrLoadModule('/src/domain/industrialRecipes.ts');const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');const {useEditorStore:editor,createInitialDoc}=await server.ssrLoadModule('/src/store.ts');const {serializeProject,parseProject}=await server.ssrLoadModule('/src/domain/project.ts');const {processRoute}=await server.ssrLoadModule('/src/domain/processMotion.ts');const {createAnimationEvaluator}=await server.ssrLoadModule('/src/domain/animation.ts');
 const profile={type:'profile',params:{points:[[-.2,0],[.2,0],[.3,.4],[.2,.5],[-.2,.5],[-.3,.4]],depth:.2}};const lathe={type:'lathe',params:{points:[[0,0],[.2,.1],[.1,.5],[0,.6]],segments:24}};
 await test('new bounded contours build finite geometry and valid normals',()=>{for(const g of [profile,lathe]){assert.deepEqual(validateGeometry(g),[]);const geo=buildPrimitiveGeometry(g);assert.ok([...geo.attributes.position.array].every(Number.isFinite));assert.ok([...geo.attributes.normal.array].every(Number.isFinite));geo.dispose();}});
 await test('invalid profile and lathe data fail closed',()=>{for(const g of [{...lathe,params:{...lathe.params,segments:10000}},{...lathe,params:{...lathe.params,points:[[1,1],[2,0]]}},{...profile,params:{...profile.params,points:[[0,0],[1,1],[0,1],[1,0]]}},{type:'lathe',params:{points:'script',segments:24}}])assert.ok(validateGeometry(g).length)});
 let all=createInitialDoc();
 await test('all industrial recipes validate, exportable and preserve editable components',()=>{for(const [i,kind] of RECIPE_NAMES.entries()){const def=industrialRecipe(kind);def.position=[i*2.5,0,0];const r=applyBatch(all,{operations:[{op:'createAssembly',...def}]});assert.deepEqual(r.errors,[]);all=r.doc;assert.deepEqual(validateDocument(all),[]);for(const p of def.parts)buildPrimitiveGeometry(p.geometry).dispose();}assert.ok(all.nodes.some(n=>n.geometry.type==='profile'));assert.ok(all.nodes.some(n=>n.geometry.type==='lathe'));assert.equal(parseProject(serializeProject(all)).nodes.length,all.nodes.length);});
 const agv=all.nodes.find(n=>n.assemblyName==='搬运AGV');
 await test('business route uses whole assembly with dwell, return and bounded speed',()=>{const a=processRoute(all,{targetId:agv.id,offsets:[[0,0,0],[2,0,0]],speed:1,dwell:1,returnToStart:true});assert.equal(a.duration,6);assert.equal(a.tracks[0].targetIds.length,all.nodes.filter(n=>n.assemblyId===agv.assemblyId).length);assert.deepEqual(a.tracks[0].keyframes.map(k=>k.time),[0,2,3,5,6]);all={...all,animation:a};assert.deepEqual(validateDocument(all),[]);createAnimationEvaluator(all);});
 await test('route rejects teleport, repeated points and invalid carries',()=>{const base={targetId:agv.id,offsets:[[0,0,0],[1,0,0]],speed:1,dwell:0,returnToStart:false};for(const mod of [{offsets:[[1,0,0],[2,0,0]]},{offsets:[[0,0,0],[0,0,0]]},{carryIds:[agv.id]},{speed:0}])assert.throws(()=>processRoute(all,{...base,...mod}));});
 await test('workspace backups omit configuration and import additively',async()=>{const w=await server.ssrLoadModule('/src/workspace.ts');editor.setState({doc:all,messages:[],aiConfig:{apiKey:'SECRET_DO_NOT_EXPORT',baseURL:'https://provider.test',model:'x'},aiStatus:'idle'});await w.initializeWorkspace();const backup=w.exportWorkspaceBackup();assert.ok(!backup.includes('SECRET_DO_NOT_EXPORT'));assert.ok(!backup.includes('provider.test'));const before=w.useWorkspaceStore.getState().sessions.length;assert.equal(w.importWorkspaceBackup(backup),1);assert.equal(w.useWorkspaceStore.getState().sessions.length,before+1);const old=w.useWorkspaceStore.getState().sessions;assert.throws(()=>w.importWorkspaceBackup('{"format":"oops"}'));assert.equal(w.useWorkspaceStore.getState().sessions,old);await w.flushWorkspace();});
 await test('workspace backups roundtrip more than 100 sessions',async()=>{
  const w=await server.ssrLoadModule('/src/workspace.ts'),item={title:'会话',project:JSON.parse(serializeProject(createInitialDoc())),draft:null,messages:[],composerText:''};
  const pack={format:'chat3d-workspace-backup',version:1,sessions:Array.from({length:101},()=>item)};
  assert.equal(w.importWorkspaceBackup(JSON.stringify(pack)),101);
  const backup=w.exportWorkspaceBackup(),expected=JSON.parse(backup).sessions.length,before=w.useWorkspaceStore.getState().sessions.length;
  assert.ok(expected>=101);assert.equal(w.importWorkspaceBackup(backup),expected);assert.equal(w.useWorkspaceStore.getState().sessions.length,before+expected);
 });
 await test('workspace backup preserves long messages composer input and more than 10000 messages',async()=>{
  const w=await server.ssrLoadModule('/src/workspace.ts'),text='长'.repeat(200001),composerText='输入'.repeat(100001),project=JSON.parse(serializeProject(createInitialDoc()));
  const messages=Array.from({length:10001},(_,i)=>({role:i%2?'assistant':'user',text:i===0?text:'消息'+i,createdAt:i}));
  const pack={format:'chat3d-workspace-backup',version:1,sessions:[{title:'无损备份',project,draft:project,messages,composerText}]};
  assert.equal(w.importWorkspaceBackup(JSON.stringify(pack)),2);
  const [restored,draft]=w.useWorkspaceStore.getState().sessions;assert.equal(restored.snapshot.composerText,composerText);assert.equal(restored.snapshot.messages.length,10001);assert.equal(restored.snapshot.messages[0].text,text);assert.equal(restored.snapshot.messages[10000].createdAt,10000);assert.equal(restored.snapshot.pendingResult,null);assert.match(draft.title,/未确认草稿副本/);assert.deepEqual(draft.snapshot.doc,restored.snapshot.doc);
  const exported=JSON.parse(w.exportWorkspaceBackup()).sessions.find(x=>x.title==='无损备份（导入）');assert.equal(exported.composerText,composerText);assert.equal(exported.messages[0].text,text);assert.equal(exported.messages.length,10001);
 });
 await test('workspace backup validates every session and draft before importing any prefix',async()=>{
  const w=await server.ssrLoadModule('/src/workspace.ts'),item={title:'有效前缀',project:JSON.parse(serializeProject(createInitialDoc())),draft:null,messages:[],composerText:''},before=w.useWorkspaceStore.getState();
  for(const invalid of [null,{...item,messages:[{role:'tool',text:'无效角色'}]},{...item,messages:[{role:'user',text:42}]},{...item,composerText:42},{...item,project:{}},{...item,draft:{}}]){
   assert.throws(()=>w.importWorkspaceBackup(JSON.stringify({format:'chat3d-workspace-backup',version:1,sessions:[item,invalid]})),error=>error instanceof Error&&!(error instanceof TypeError)&&/格式|项目/.test(error.message));
   assert.equal(w.useWorkspaceStore.getState().sessions,before.sessions);assert.equal(w.useWorkspaceStore.getState().activeId,before.activeId);
  }
 });
 await test('workspace backup enforces the UTF-8 total budget on import and export',async()=>{
  const w=await server.ssrLoadModule('/src/workspace.ts'),oversized='界'.repeat(Math.ceil(w.MAX_WORKSPACE_BACKUP_BYTES/3)),before=w.useWorkspaceStore.getState().sessions;
  const pack={format:'chat3d-workspace-backup',version:1,sessions:[{title:'超限',project:JSON.parse(serializeProject(createInitialDoc())),draft:null,messages:[],composerText:oversized}]};
  assert.throws(()=>w.importWorkspaceBackup(JSON.stringify(pack)),/MiB/);assert.equal(w.useWorkspaceStore.getState().sessions,before);
  const target=before.find(s=>s.id!==w.useWorkspaceStore.getState().activeId);assert.ok(target);
  w.useWorkspaceStore.setState({sessions:before.map(s=>s===target?{...s,snapshot:{...s.snapshot,composerText:oversized}}:s)});
  try{assert.throws(()=>w.exportWorkspaceBackup(),/MiB/);}finally{w.useWorkspaceStore.setState({sessions:before});}
  await w.flushWorkspace();
 });
 if(process.env.EXPORT_QA==='1'){globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(r=>{this.result=r;this.onloadend?.()})}};const {exportGlb}=await server.ssrLoadModule('/src/scene/export.ts');fs.mkdirSync('/workspace/scratch/25da00f7a020/quality-upgrade',{recursive:true});fs.writeFileSync('/workspace/scratch/25da00f7a020/quality-upgrade/components.glb',Buffer.from(await exportGlb(all)));fs.writeFileSync('/workspace/scratch/25da00f7a020/quality-upgrade/components.chat3d.json',serializeProject(all));}
 console.log(count+' product upgrade checks passed');
}finally{await server.close()}
