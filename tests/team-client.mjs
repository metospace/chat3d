import {installBrowserGlobals} from './jsdom-env.mjs';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';import {createServer as viteServer} from 'vite';import {JSDOM} from 'jsdom';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:http';
import {openTeam,teamMiddleware} from '../server/team/service.mjs';import {validateTeamPayload} from '../dist-team/validator.mjs';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});installBrowserGlobals(dom);Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
const vite=await viteServer({server:{middlewareMode:true},appType:'custom'}),dir=await mkdtemp(join(tmpdir(),'chat3d-team-client-'));const team=openTeam(join(dir,'test.sqlite'));let server;
try{
 const api=await vite.ssrLoadModule('/src/domain/teamLibrary.ts'),w=await vite.ssrLoadModule('/src/workspace.ts'),{createInitialDoc}=await vite.ssrLoadModule('/src/store.ts'),{applyBatch}=await vite.ssrLoadModule('/src/domain/commands.ts'),assets=await vite.ssrLoadModule('/src/domain/modelAssets.ts'),storage=await vite.ssrLoadModule('/src/domain/modelAssetStorage.ts');
 const {createTeamTransport}=await vite.ssrLoadModule('/src/domain/teamTransport.ts');let nativeOptions;
 const native=createTeamTransport(()=>true,async()=>({fetch:async(_input,options)=>{nativeOptions=options;return Response.json({ok:true});}}));
 const signal=new AbortController().signal;await native('https://team.example/api/team/me',{headers:{Authorization:'Bearer isolated'},signal,redirect:'error'});assert.equal(nativeOptions.maxRedirections,0);assert.equal(nativeOptions.connectTimeout,15000);assert.equal(nativeOptions.signal,signal);assert.equal(nativeOptions.headers.Authorization,'Bearer isolated');assert.equal(nativeOptions.danger,undefined);
 let browserCalls=0;const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{browserCalls++;throw Error('browser must not run');};
 try{await assert.rejects(createTeamTransport(()=>true,async()=>{throw Error('native unavailable');})('https://team.example'),/原生网络插件/);await assert.rejects(createTeamTransport(()=>true,async()=>({fetch:async()=>{throw Error('native denied');}}))('https://team.example'),/native denied/);assert.equal(browserCalls,0);}finally{globalThis.fetch=previousFetch;}console.log('PASS desktop uses scoped native HTTP with no redirects, no TLS bypass and no browser fallback');
 await w.initializeWorkspace();
 const doc=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',name:'测试托盘',parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,0,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_blue'}]}).doc;
 const asset=assets.createModelAsset(doc,doc.nodes.map(n=>n.id),{name:'测试托盘',category:'设备'});await storage.saveModelAsset(asset);
 team.provision('alice','isolated-test-password-a');team.provision('bob','isolated-test-password-b');
 const middleware=teamMiddleware(team,validateTeamPayload);server=createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const a=new api.TeamClient(base),b=new api.TeamClient(base);await a.login('alice','isolated-test-password-a');await b.login('bob','isolated-test-password-b');
 assert.throws(()=>new api.TeamClient('http://company.invalid'));assert.throws(()=>new api.TeamClient('https://user:pass@example.com'));assert.throws(()=>new api.TeamClient('https://company.invalid/path'));console.log('PASS client rejects insecure remote endpoints and embedded credentials');
 assert.equal((await b.list('asset')).length,0);const localBefore=await storage.exportAssetLibrary();assert.equal(localBefore.versions.length,1);
 // Remote versions contain the publication allowlist, while local originals must remain intact.
 const payload=api.assetPublication({...asset,apiKey:'must-not-upload',messages:['private']});assert.equal(payload.apiKey,undefined);assert.equal(payload.messages,undefined);
 const request={kind:'asset',name:asset.name,description:'共享模型',payload,key:crypto.randomUUID(),expectedVersion:0};const first=await a.publish(request);assert.deepEqual(await a.publish(request),first);
 const rows=await b.list('asset','托盘');assert.equal(rows.length,1);const published=await b.read(rows[0]);assert.deepEqual(published.payload,payload);
 const id=await api.copyTeamVersion(published),id2=await api.copyTeamVersion(published);assert.notEqual(id,id2);assert.notEqual(id,asset.id);assert.deepEqual(await storage.readModelAsset(asset.id,1),asset);console.log('PASS two members asset visibility/search/copy; repeated copy never overwrites originals');
 const scene=applyBatch(createInitialDoc(),{operations:[assets.instantiateAsset(asset,[2,0,0])]}).doc;
 const sceneRequest={kind:'scene',name:'测试场景',description:'',payload:api.scenePublication(scene),key:crypto.randomUUID(),expectedVersion:0};await a.publish(sceneRequest);const saved=await b.read((await b.list('scene'))[0]);
 await a.publish({...request,name:'新版托盘',key:crypto.randomUUID(),itemId:first.id,expectedVersion:1});assert.deepEqual((await b.read(rows[0])).payload,payload);
 const copied=await api.copyTeamVersion(saved);const local=w.useWorkspaceStore.getState().sessions.find(s=>s.snapshot.doc.projectId===copied);assert.ok(local);assert.equal(local.snapshot.doc.nodes[0].modelAsset.version,1);assert.equal(local.snapshot.doc.nodes[0].modelAsset.id,asset.id);assert.deepEqual(local.snapshot.doc.nodes,scene.nodes);assert.notEqual(copied,scene.projectId);console.log('PASS scene reuse embeds geometry and pins prior asset version after team update');
 const backup=w.exportWorkspaceBackup(),before=w.useWorkspaceStore.getState().sessions.length;w.importWorkspaceBackup(backup);await w.flushWorkspace();assert.ok(w.useWorkspaceStore.getState().sessions.length>before);const library=await storage.exportAssetLibrary();await storage.importAssetLibrary(JSON.stringify(library));assert.deepEqual(await storage.readModelAsset(asset.id,1),asset);console.log('PASS existing local workspace and asset backups remain compatible');
 const originalFetch=globalThis.fetch;let lost=true;globalThis.fetch=async(...args)=>{const response=await originalFetch(...args);if(lost&&String(args[0]).endsWith('/complete')){lost=false;throw Error('simulated response loss');}return response;};
 try{const retry={...request,key:crypto.randomUUID(),name:'重试测试'};await assert.rejects(a.publish(retry),/尚未确认服务器是否保存/);await a.publish(retry);assert.equal((await b.list('asset','重试测试')).length,1);}finally{globalThis.fetch=originalFetch;}console.log('PASS lost response retry creates exactly one publication');
 const preview=api.teamResponseBodyPreview(' <html>\nError 502 Bad Gateway Bearer secret-token-value </html> ');
 assert.match(preview,/502 Bad Gateway/);assert.match(preview,/Bearer \[已隐藏\]/);assert.doesNotMatch(preview,/secret-token-value/);
 assert.equal(api.teamResponseBodyPreview(''),'空响应');assert.equal(api.teamResponseBodyPreview('x'.repeat(250)).length,201);
 const originalPublishFetch=globalThis.fetch;
 globalThis.fetch=async(input,...rest)=>{
  if(String(input).includes('/api/team/publish'))return new Response('<html><title>cf</title><body>error code: 502</body></html>',{status:502,headers:{'Content-Type':'text/html'}});
  return originalPublishFetch(input,...rest);
 };
 try{
  await a.login('alice','isolated-test-password-a');
  await assert.rejects(a.publish({...request,key:crypto.randomUUID(),name:'断流诊断'}),error=>{
   assert.match(error.message,/HTTP 502/);assert.match(error.message,/error code: 502|cf/);assert.match(error.message,/可重试同一项/);
   return true;
  });
 }finally{globalThis.fetch=originalPublishFetch;}
 globalThis.fetch=async(input,...rest)=>{
  if(String(input).includes('/api/team/publish'))return new Response('',{status:200,headers:{'Content-Type':'application/json'}});
  return originalPublishFetch(input,...rest);
 };
 try{await assert.rejects(a.publish({...request,key:crypto.randomUUID(),name:'空包诊断'}),/HTTP 200.*空响应/);}
 finally{globalThis.fetch=originalPublishFetch;}
 console.log('PASS incomplete team responses include HTTP status and redacted body preview');
 await a.logout();await assert.rejects(a.list('asset'),/登录/);
}finally{if(server)await new Promise(resolve=>server.close(resolve));team.close();await vite.close();dom.window.close();await rm(dir,{recursive:true,force:true});}
