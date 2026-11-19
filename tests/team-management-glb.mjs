import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {installBrowserGlobals} from './jsdom-env.mjs';

const dom=new JSDOM('<html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);
const originalFetch=globalThis.fetch,originalLocalStorage=globalThis.localStorage,originalFileReader=globalThis.FileReader;
globalThis.localStorage=dom.window.localStorage;
globalThis.FileReader=class{
 readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onload?.();this.onloadend?.();});}
 readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onload?.();this.onloadend?.();});}
};
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const api=await vite.ssrLoadModule('/src/domain/teamLibrary.ts'),upload=await vite.ssrLoadModule('/src/domain/teamFileUpload.ts'),links=await vite.ssrLoadModule('/src/domain/teamResourceLinks.ts'),storage=await vite.ssrLoadModule('/src/domain/modelAssetStorage.ts'),assets=await vite.ssrLoadModule('/src/domain/modelAssets.ts'),workspace=await vite.ssrLoadModule('/src/workspace.ts'),{createInitialDoc}=await vite.ssrLoadModule('/src/store.ts'),{applyBatch}=await vite.ssrLoadModule('/src/domain/commands.ts'),{exportGlb}=await vite.ssrLoadModule('/src/scene/export.ts'),{createTeamPreviewLoader}=await vite.ssrLoadModule('/src/scene/teamPreview.ts'),{parseProject}=await vite.ssrLoadModule('/src/domain/project.ts'),{MAX_GLB_BYTES}=await vite.ssrLoadModule('/src/scene/glbLimit.ts');
 await workspace.initializeWorkspace();
 const doc=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',name:'管理库实体',parentId:null,geometry:{type:'box',params:{width:1,height:2,depth:3}},transform:{position:[0,0,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_blue'}]}).doc;
 const glb=await exportGlb(doc);assert.ok(glb.byteLength>20);
 const asset=assets.createModelAsset(doc,doc.nodes.map(node=>node.id),{name:'官方原件',category:'设备'});
 asset.thumbnail='data:image/png;base64,AAAA';
 const item=(kind,id)=>({id,kind,sourceKind:'glb',version:1,owner:'owner',name:`管理库${kind}`,description:'来自管理库',categoryPath:['工厂','设备'],created:'2026-01-01T00:00:00Z'});
 const nativeAsset=item('asset','management-asset'),nativeScene=item('scene','management-scene');
 const official={...item('asset','official-asset'),sourceKind:'chat3d',payload:asset},legacy={...item('asset','legacy-asset'),payload:asset};delete legacy.sourceKind;
 const rows=[nativeAsset,nativeScene,official,legacy],requests=[];
 let mode='normal',bodyReads=0;
 const binaryResponse=(bytes,length=bytes.byteLength)=>{
  const response=new Response(bytes,{headers:{'Content-Type':'model/gltf-binary',...(length===undefined?{}:{'Content-Length':String(length)})}});
  const read=response.arrayBuffer.bind(response);response.arrayBuffer=()=>{bodyReads++;return read();};
  response.json=()=>{assert.fail('GLB bytes must never be parsed as JSON');};response.text=()=>{assert.fail('GLB bytes must never be read as text');};return response;
 };
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(String(url)).pathname,search=new URL(String(url)).searchParams;requests.push({path,init});
  if(path==='/api/team/login')return Response.json({token:'management-test-token',user:{id:'owner',name:'发布者',role:'member'}});
  assert.equal(init.headers.Authorization,'Bearer management-test-token');
  if(path==='/api/team/items')return Response.json(rows.filter(row=>row.kind===search.get('kind')).map(({payload,...row})=>row));
  if(path.endsWith('/thumbnail'))return path.includes('missing-thumbnail')?Response.json({error:'没有缩略图'},{status:404}):new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
  const row=rows.find(row=>path===`/api/team/items/${row.id}/${row.version}`);assert.ok(row,'Unexpected request '+path);
  if(row.sourceKind!=='glb')return Response.json(row);
  if(mode==='oversize')return binaryResponse(new ArrayBuffer(0),MAX_GLB_BYTES+1);
  if(mode==='mismatch')return binaryResponse(glb,glb.byteLength+4);
  if(mode==='invalid')return binaryResponse(new Uint8Array(24).buffer);
  if(mode==='forbidden')return Response.json({error:'没有读取权限'},{status:403});
  if(mode==='unauthorized')return Response.json({error:'登录过期'},{status:401});
  return binaryResponse(glb);
 };
 const client=new api.TeamClient('https://management.example');client.acceptSession('management-test-token',{id:'owner',name:'发布者',role:'member'});
 const read=client.read.bind(client),download=client.downloadGlb.bind(client);let jsonReads=0,downloads=0;
 client.read=async row=>{jsonReads++;return read(row);};client.downloadGlb=async row=>{downloads++;return download(row);};
 assert.deepEqual((await client.list('asset')).filter(row=>row.sourceKind==='glb'),[nativeAsset]);assert.deepEqual(await client.list('scene'),[nativeScene]);
 console.log('PASS management GLB asset and scene rows retain sourceKind in TeamClient.list');

 const originalTimeout=AbortSignal.timeout,timeouts=[];let loadedAsset;
 AbortSignal.timeout=ms=>{timeouts.push(ms);return originalTimeout(ms);};
 try{loadedAsset=await api.loadTeamVersion(client,nativeAsset);}finally{AbortSignal.timeout=originalTimeout;}
 assert.ok(timeouts.includes(15*60*1000),'GLB download must allow the 15 minute model transfer timeout');
 assert.equal(loadedAsset.kind,'asset');assert.equal(loadedAsset.name,nativeAsset.name);assert.equal(loadedAsset.payload.format,'chat3d-model-asset');assert.equal(loadedAsset.payload.description,nativeAsset.description);
 const loadedScene=await api.loadTeamVersion(client,nativeScene),importedScene=parseProject(JSON.stringify(loadedScene.payload));
 const meshNodes=nodes=>{assert.ok(nodes.length);assert.ok(nodes.every(node=>node.geometry.type==='mesh'&&node.geometry.params.positions.length>0&&node.geometry.params.indices.length>0));};
 meshNodes(loadedAsset.payload.nodes);meshNodes(importedScene.nodes);assert.equal(downloads,2);assert.equal(bodyReads,2);assert.equal(jsonReads,0);
 console.log('PASS real exported primitive GLB imports into mesh-bearing asset and scene payloads without JSON reads');

 const activeBefore=workspace.useWorkspaceStore.getState().activeId;
 const acquiredAsset=await api.acquireLinkedTeamVersion(client,loadedAsset),acquiredScene=await api.acquireLinkedTeamVersion(client,loadedScene);
 const localAsset=await storage.readModelAsset(acquiredAsset.link.localId,1),sceneSession=workspace.useWorkspaceStore.getState().sessions.find(session=>session.id===acquiredScene.link.localId);
 assert.ok(localAsset);assert.notEqual(localAsset.id,nativeAsset.id);assert.notEqual(localAsset.id,loadedAsset.payload.id);meshNodes(localAsset.nodes);
 assert.ok(sceneSession?.librarySavedAt);assert.notEqual(sceneSession.id,nativeScene.id);assert.notEqual(sceneSession.snapshot.doc.projectId,importedScene.projectId);meshNodes(sceneSession.snapshot.doc.nodes);assert.equal(workspace.useWorkspaceStore.getState().activeId,activeBefore);
 for(const [row,copy] of [[nativeAsset,acquiredAsset],[nativeScene,acquiredScene]]){
  assert.equal(copy.reused,false);assert.equal(copy.link.serviceOrigin,client.base);assert.equal(copy.link.teamItemId,row.id);assert.equal(copy.link.teamVersion,1);assert.equal(copy.link.kind,row.kind);assert.equal(copy.link.direction,'acquire');assert.equal(copy.link.status,'ready');assert.equal(copy.link.active,true);assert.match(copy.link.baselineFingerprint,/^[a-f0-9]{64}$/);
  const same=await api.acquireLinkedTeamVersion(client,row.kind==='asset'?loadedAsset:loadedScene);assert.equal(same.reused,true);assert.equal(same.link.localId,copy.link.localId);
 }
 await storage.updateModelAssetMetadata(localAsset.id,{name:'保留本地资产名',category:localAsset.category,description:'保留本地资产说明'},{version:1});
 workspace.updateLibrarySession(sceneSession.id,{title:'保留本地场景名',libraryDescription:'保留本地场景说明'});
 const oldAssetHead=structuredClone((await storage.listModelAssets()).find(head=>head.id===localAsset.id)),oldAsset=structuredClone(await storage.readModelAsset(localAsset.id,1)),oldScene=structuredClone(workspace.useWorkspaceStore.getState().sessions.find(session=>session.id===sceneSession.id));
 nativeAsset.version=2;nativeScene.version=2;
 const nextAsset=await api.acquireLinkedTeamVersion(client,await api.loadTeamVersion(client,nativeAsset)),nextScene=await api.acquireLinkedTeamVersion(client,await api.loadTeamVersion(client,nativeScene));
 assert.notEqual(nextAsset.link.localId,localAsset.id);assert.notEqual(nextScene.link.localId,sceneSession.id);
 assert.deepEqual(await storage.readModelAsset(localAsset.id,1),oldAsset);assert.deepEqual((await storage.listModelAssets()).find(head=>head.id===localAsset.id),oldAssetHead);assert.deepEqual(workspace.useWorkspaceStore.getState().sessions.find(session=>session.id===sceneSession.id),oldScene);
 const savedLinks=await links.listTeamResourceLinks();for(const copy of [acquiredAsset,acquiredScene])assert.equal(savedLinks.find(link=>link.id===copy.link.id).active,false);for(const copy of [nextAsset,nextScene])assert.equal(savedLinks.find(link=>link.id===copy.link.id).active,true);
 console.log('PASS asset and scene acquisition saves new identities and team links, reuses exact versions and preserves edited old copies');

 const beforeJsonDownloads=downloads;
 for(const row of [official,legacy]){
  const loaded=await api.loadTeamVersion(client,row);assert.deepEqual(loaded,row);assert.equal(loaded.payload.nodes[0].geometry.type,'box');
  const copy=await api.acquireLinkedTeamVersion(client,loaded);assert.ok(await storage.readModelAsset(copy.link.localId,1));
 }
 assert.equal(jsonReads,2);assert.equal(downloads,beforeJsonDownloads);
 console.log('PASS official and missing-sourceKind versions still call client.read and preserve the original JSON payload');

 mode='oversize';const beforeOversize=bodyReads;await assert.rejects(api.loadTeamVersion(client,nativeAsset),/GLB文件不能超过512 MiB/);assert.equal(bodyReads,beforeOversize,'reject declared oversize before reading the file body');
 mode='mismatch';await assert.rejects(api.loadTeamVersion(client,nativeAsset),/长度|完整|大小|字节/);assert.equal(bodyReads,beforeOversize+1);
 mode='invalid';await assert.rejects(api.loadTeamVersion(client,nativeAsset),/GLB/);
 mode='forbidden';await assert.rejects(client.downloadGlb(nativeAsset),error=>error.status===403&&error.message==='没有读取权限');mode='normal';
 console.log('PASS oversize rejects before body reads, length mismatch and corrupt GLBs fail, and binary status errors propagate');

 const preview=createTeamPreviewLoader(client),signal=new AbortController().signal,beforePreviewRequests=requests.length,beforePreviewReads=jsonReads,beforePreviewDownloads=downloads,beforePreviewLinks=await links.listTeamResourceLinks();
 const thumbnail=await preview(nativeAsset,signal);assert.equal(thumbnail.image,'data:image/png;base64,iVBORw==');
 const cached=await preview(nativeAsset,signal);assert.deepEqual(cached,thumbnail);assert.equal(requests.length,beforePreviewRequests+1);
 const missing=await preview({...nativeScene,id:'missing-thumbnail'},signal);assert.equal(missing.image,'');assert.ok(missing.notice);
 const refreshed=await preview(nativeAsset,signal,true);assert.equal(refreshed.image,thumbnail.image);
 assert.deepEqual(requests.slice(beforePreviewRequests).map(request=>request.path),[`/api/team/items/${nativeAsset.id}/${nativeAsset.version}/thumbnail`,`/api/team/items/missing-thumbnail/${nativeScene.version}/thumbnail`,`/api/team/items/${nativeAsset.id}/${nativeAsset.version}/thumbnail`]);
 assert.equal(jsonReads,beforePreviewReads);assert.equal(downloads,beforePreviewDownloads);assert.deepEqual(await links.listTeamResourceLinks(),beforePreviewLinks);
 const officialPreview=await preview({...official,payload:undefined},signal);assert.equal(officialPreview.image,asset.thumbnail);
 console.log('PASS GLB previews fetch only authenticated thumbnails, cache images, refresh only thumbnails and treat 404 as a soft placeholder');

 assert.equal(upload.canUpdateTeamUpload(client,nativeAsset),false);assert.equal(upload.canUpdateTeamUpload(client,nativeScene),false);assert.equal(upload.canUpdateTeamUpload(client,legacy),true);assert.equal(upload.canUpdateTeamUpload(client,official),true);assert.equal(upload.canUpdateTeamUpload(client,{...legacy,owner:'other'}),false);
 client.user.role='admin';assert.equal(upload.canUpdateTeamUpload(client,{...nativeAsset,owner:'other'}),false);assert.equal(upload.canUpdateTeamUpload(client,{...legacy,owner:'other'}),true);
 client.user.role='viewer';assert.equal(upload.canUpdateTeamUpload(client,legacy),false);
 console.log('PASS GLB append eligibility is denied for owners and admins while existing JSON ownership rules remain unchanged');
 const shared=await api.loginTeamSession(client.base,'owner','test-password');assert.equal(api.getTeamSession(),shared);mode='unauthorized';
 await assert.rejects(shared.downloadGlb(nativeAsset),error=>error.status===401&&/登录已失效/.test(error.message));assert.equal(api.getTeamSession(),undefined);assert.equal(shared.user,undefined);assert.equal(api.getTeamSessionStatus(),'expired');
 console.log('PASS binary 401 expires the shared team session just like existing authenticated calls');
}finally{
 globalThis.fetch=originalFetch;if(originalLocalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalLocalStorage;if(originalFileReader===undefined)delete globalThis.FileReader;else globalThis.FileReader=originalFileReader;await vite.close();dom.window.close();
}
