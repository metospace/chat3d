import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'}),originalFetch=globalThis.fetch,originalLocalStorage=globalThis.localStorage;
globalThis.localStorage=dom.window.localStorage;
const originalFileReader=globalThis.FileReader;
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}};
try{
 const upload=await vite.ssrLoadModule('/src/domain/teamFileUpload.ts'),api=await vite.ssrLoadModule('/src/domain/teamLibrary.ts'),assets=await vite.ssrLoadModule('/src/domain/modelAssets.ts'),storage=await vite.ssrLoadModule('/src/domain/modelAssetStorage.ts'),project=await vite.ssrLoadModule('/src/domain/project.ts'),{createInitialDoc}=await vite.ssrLoadModule('/src/store.ts'),{applyBatch}=await vite.ssrLoadModule('/src/domain/commands.ts'),{readTeamPublication}=await vite.ssrLoadModule('/src/domain/teamPublish.ts');
 const doc=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',name:'上传测试',parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,0,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_blue'}]}).doc;
 const beforeAssets=await storage.listModelAssets(),beforeLocal=Object.entries(localStorage);
 const {exportGlb}=await vite.ssrLoadModule('/src/scene/export.ts'),glbBytes=await exportGlb(doc),stages=[];
 const parsedGlb=await upload.parseTeamUploadFile(new File([glbBytes],'直接模型.GLB'),'asset',async stage=>{await Promise.resolve();stages.push(stage);});
 assert.deepEqual(stages,['checking','parsing','converting','validating']);assert.equal(parsedGlb.kind,'asset');assert.equal(parsedGlb.name,'直接模型');assert.equal(parsedGlb.description,'');assert.deepEqual(parsedGlb.categoryPath,['其他']);
 for(const size of [501*1024*1024,512*1024*1024]){let reads=0;const boundary=await upload.parseTeamUploadFile({name:'boundary.glb',size,arrayBuffer:async()=>{reads++;return glbBytes;}},'asset');assert.equal(boundary.name,'boundary');assert.equal(reads,1);}
 await assert.rejects(upload.parseTeamUploadFile({name:'overflow.glb',size:512*1024*1024+1,arrayBuffer(){throw Error('must not read');}},'asset'),/GLB文件不能超过512 MiB/);
 for(const kind of ['asset','scene']){
  for(const [bytes,message] of [[new Uint8Array(24).buffer,/仅支持完整的GLB 2.0文件/],[glbBytes.slice(0,12),/GLB文件头不完整/],[glbBytes.slice(0,-4),/仅支持完整的GLB 2.0文件/]]){const failedStages=[];await assert.rejects(upload.parseTeamUploadFile(new File([bytes],'broken.glb'),kind,stage=>failedStages.push(stage)),message);assert.deepEqual(failedStages,['checking']);}
  await assert.rejects(upload.parseTeamUploadFile(new File([JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'external.bin'}]})],'external.gltf'),kind),/^Error: 暂不支持 GLTF 或外置资源，请导出为单个自包含 GLB 后再上传。$/);
 }
 const sceneStages=[],parsedSceneGlb=await upload.parseTeamUploadFile(new File([glbBytes],'现场模型.GLB'),'scene',stage=>sceneStages.push(stage));
 assert.deepEqual(sceneStages,['checking','parsing','converting','validating']);assert.equal(parsedSceneGlb.name,'现场模型');assert.equal(parsedSceneGlb.description,'');assert.deepEqual(parsedSceneGlb.categoryPath,[]);
 const asset=assets.createModelAsset(doc,doc.nodes.map(node=>node.id),{name:'文件资产',category:'设备'});asset.description='文件说明';
 const assetFile=new File([JSON.stringify({...asset,teamCategoryPath:['工厂','设备']})],'asset.json'),sceneFile=new File([project.serializeProject(doc,undefined,project.MAX_TEAM_SCENE_BYTES,['工厂','场景'])],'现场.json');
 const parsedAsset=await upload.parseTeamUploadFile(assetFile,'asset'),parsedScene=await upload.parseTeamUploadFile(sceneFile,'scene');
 assert.equal(parsedAsset.name,'文件资产');assert.equal(parsedAsset.description,'文件说明');assert.deepEqual(parsedAsset.categoryPath,['工厂','设备']);assert.equal(parsedScene.name,'现场');assert.deepEqual(parsedScene.categoryPath,['工厂','场景']);
 const exportedScene=await upload.parseTeamUploadFile(new File([project.serializeProject(doc)],'scenivo-team-scene-demo-v1.chat3d.json'),'scene');
 assert.equal(exportedScene.name,'scenivo-team-scene-demo-v1');
 const client=new api.TeamClient('https://example.test');client.acceptSession('token',{id:'owner',name:'发布者',role:'member'});
 const target={id:'original',owner:'owner',kind:'asset',version:7,name:'旧名字',description:'旧说明',created:'now'},key=crypto.randomUUID();
 const requests=[];
 let uploadTotal=0,interrupt=true;globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);requests.push({url,body});if(url.endsWith('/complete')){if(interrupt){interrupt=false;throw Error('connection lost after upload');}return Response.json({id:target.id,version:8});}if(url.endsWith('/start'))uploadTotal=body.total;return Response.json({uploadId:'test-upload',offset:url.endsWith('/start')?0:body.offset+Buffer.from(body.data,'base64').length,total:uploadTotal,encoding:'gzip'});};
 const prepared=await upload.prepareTeamFileUpload(parsedAsset,{client,name:'追加文件',description:'新说明',categoryPath:['工厂','新设备'],target,key});
 assert.equal(prepared.request.itemId,target.id);assert.equal(prepared.request.expectedVersion,7);assert.equal(prepared.request.key,key);assert.equal(prepared.request.payload.name,'追加文件');assert.equal(prepared.request.payload.description,'新说明');assert.deepEqual(prepared.request.categoryPath,['工厂','新设备']);
 const frozen=Buffer.from(prepared.publication.data),digest=prepared.publication.digest;
 await assert.rejects(client.publish(prepared.request,undefined,prepared.publication));await client.publish(prepared.request,undefined,prepared.publication);
 assert.deepEqual(Buffer.from(prepared.publication.data),frozen);assert.equal(prepared.publication.digest,digest);assert.equal(readTeamPublication(prepared.publication).key,key);
 const starts=requests.filter(request=>request.url.endsWith('/start'));assert.equal(starts.length,2);assert.deepEqual(starts[0].body,starts[1].body);
 const glbPrepared=await upload.prepareTeamFileUpload(parsedGlb,{client,name:'直接模型发布',description:'GLB 文件说明',categoryPath:['模型'],key:crypto.randomUUID()});
 assert.equal(glbPrepared.request.kind,'asset');assert.equal(glbPrepared.request.payload.format,'chat3d-model-asset');assert.equal(glbPrepared.request.payload.name,'直接模型发布');assert.equal(glbPrepared.request.payload.description,'GLB 文件说明');assert.deepEqual(glbPrepared.request.categoryPath,['模型']);assert.ok(glbPrepared.request.payload.nodes.length);assert.ok(glbPrepared.request.payload.nodes.every(node=>node.geometry.type==='mesh'&&node.geometry.params.positions.length>0&&node.geometry.params.indices.length>0));
 const glbFrozen=Buffer.from(glbPrepared.publication.data),glbDigest=glbPrepared.publication.digest;interrupt=true;
 await assert.rejects(client.publish(glbPrepared.request,undefined,glbPrepared.publication));await client.publish(glbPrepared.request,undefined,glbPrepared.publication);
 assert.deepEqual(Buffer.from(glbPrepared.publication.data),glbFrozen);assert.equal(glbPrepared.publication.digest,glbDigest);assert.deepEqual(readTeamPublication(glbPrepared.publication).payload,glbPrepared.request.payload);const glbStarts=requests.filter(request=>request.url.endsWith('/start')).slice(-2);assert.equal(glbStarts.length,2);assert.deepEqual(glbStarts[0].body,glbStarts[1].body);
 const scene=await upload.prepareTeamFileUpload(parsedScene,{client,name:'文件场景',description:'场景说明',categoryPath:parsedScene.categoryPath,key:crypto.randomUUID()});assert.equal(scene.request.expectedVersion,0);assert.equal(scene.request.itemId,undefined);assert.equal(scene.request.payload.format,'chat3d-project');await client.publish(scene.request,undefined,scene.publication);
 const glbScene=await upload.prepareTeamFileUpload(parsedSceneGlb,{client,name:parsedSceneGlb.name,description:'',categoryPath:[],key:crypto.randomUUID()});
 assert.equal(glbScene.request.kind,'scene');assert.equal(glbScene.request.expectedVersion,0);assert.equal(glbScene.request.itemId,undefined);assert.equal(glbScene.request.payload.format,'chat3d-project');assert.ok(glbScene.request.payload.scene.nodes.length);assert.ok(glbScene.request.payload.scene.nodes.every(node=>node.geometry.type==='mesh'&&node.geometry.params.positions.length>0));
 interrupt=true;await assert.rejects(client.publish(glbScene.request,undefined,glbScene.publication));await client.publish(glbScene.request,undefined,glbScene.publication);assert.deepEqual(readTeamPublication(glbScene.publication).payload,glbScene.request.payload);
 const sceneAppend=await upload.prepareTeamFileUpload(parsedSceneGlb,{client,name:parsedSceneGlb.name,description:'',categoryPath:[],target:{...target,kind:'scene'},key:crypto.randomUUID()});assert.equal(sceneAppend.request.itemId,target.id);assert.equal(sceneAppend.request.expectedVersion,7);await client.publish(sceneAppend.request,undefined,sceneAppend.publication);
 assert.deepEqual(await storage.listModelAssets(),beforeAssets);assert.deepEqual(Object.entries(localStorage),beforeLocal);
 const count=requests.length;
 for(const [file,kind,message] of [[assetFile,'scene',/所选文件是资产.*资产库/],[sceneFile,'asset',/所选文件是场景.*场景库/],[new File(['garbage'],'broken.json'),'asset',/不是有效 JSON/],[new File(['{}'],'unknown.json'),'scene',/不支持的项目文件格式/],[new File([],'empty.json'),'scene',/文件为空/],[{name:'huge.json',size:501*1024*1024,text(){throw Error('must not read');}},'asset',/资产超过500 MiB/],[{name:'huge.json',size:501*1024*1024,text(){throw Error('must not read');}},'scene',/项目文件超过 500 MiB/]])await assert.rejects(upload.parseTeamUploadFile(file,kind),message);
 for(const format of ['chat3d-asset-library','chat3d-workspace-backup'])for(const kind of ['asset','scene'])await assert.rejects(upload.parseTeamUploadFile(new File([JSON.stringify({format})],'backup.json'),kind),/不能上传资产库或工作区备份.*导出单个/);
 await assert.rejects(upload.prepareTeamFileUpload(parsedAsset,{client,name:'追加',description:'',categoryPath:[],target:{...target,owner:'other'},key}),/只有发布者或管理员/);
 await assert.rejects(upload.prepareTeamFileUpload(parsedAsset,{client,name:'追加',description:'',categoryPath:[],target:{...target,kind:'scene'},key}),/同类型/);
 assert.equal(upload.canUpdateTeamUpload(client,{...target,owner:'other'}),false);client.user.role='viewer';assert.equal(upload.canUpdateTeamUpload(client,target),false);await assert.rejects(upload.prepareTeamFileUpload(parsedAsset,{client,name:'拒绝',description:'',categoryPath:[],key}));client.user.role='admin';assert.equal(upload.canUpdateTeamUpload(client,{...target,owner:'other'}),true);
 assert.equal(requests.length,count);
 console.log('PASS direct file validation, asset/scene preparation and cached publish, append metadata, permissions, zero local saves and stable retries');
}finally{globalThis.fetch=originalFetch;if(originalFileReader===undefined)delete globalThis.FileReader;else globalThis.FileReader=originalFileReader;if(originalLocalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalLocalStorage;await vite.close();dom.window.close();}
