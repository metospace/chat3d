import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
const originalPost=globalThis.postMessage,originalMessage=globalThis.onmessage;
try{
 const api=await vite.ssrLoadModule('/src/domain/teamLibrary.ts'),preparation=await vite.ssrLoadModule('/src/domain/teamPreparation.ts'),fingerprints=await vite.ssrLoadModule('/src/domain/teamFingerprint.ts'),assets=await vite.ssrLoadModule('/src/domain/modelAssets.ts'),storage=await vite.ssrLoadModule('/src/domain/modelAssetStorage.ts'),{createInitialDoc}=await vite.ssrLoadModule('/src/store.ts'),{applyBatch}=await vite.ssrLoadModule('/src/domain/commands.ts'),wire=await vite.ssrLoadModule('/src/domain/teamPreparationWire.ts');
 const doc=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',name:'准备测试',parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,0,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_blue'}]}).doc;
 const asset=assets.createModelAsset(doc,doc.nodes.map(node=>node.id),{name:'冻结快照',category:'设备'});asset.materials[0].vertexColors=true;asset.materials[0].specularIntensity=.7;asset.materials[0].specularColor='#ffffff';await storage.saveModelAsset(asset);
 const input={kind:'asset',asset:{id:asset.id,version:1},name:asset.name,description:'已保存内容',category:asset.category,categoryPath:['设备'],key:crypto.randomUUID(),expectedVersion:0},stages=[];
 const prepared=await preparation.prepareTeamPublicationSnapshot(input,stage=>stages.push(stage));
 assert.deepEqual(stages,['sanitizing','validating','fingerprinting','serializing']);assert.equal(prepared.serializedBody,JSON.stringify(prepared.request));assert.equal(prepared.bytes,new TextEncoder().encode(prepared.serializedBody).length);assert.equal(prepared.request.payload.materials[0].vertexColors,true);assert.equal(prepared.request.payload.materials[0].specularIntensity,.7);
 const frozen=prepared.serializedBody;await storage.updateModelAssetMetadata(asset.id,{name:'之后的名字',category:asset.category,description:'之后的说明'},{version:1});assert.equal(prepared.serializedBody,frozen);assert.equal(prepared.request.name,'冻结快照');
 const privateAsset={...asset,token:'private-token',nodes:asset.nodes.map(node=>({...node,password:'private-node'}))};assert.equal(JSON.stringify(api.assetPublication(privateAsset)).includes('private-'),false);
 const dashboard={service:'https://example.test',templateId:'dashboard-template',version:2,name:'已绑定看板',mode:'dashboard',slot:{x:0,y:0,width:100,height:100}};const scene=api.scenePublication({...doc,dashboard:{...dashboard,apiKey:'private-dashboard'}});assert.deepEqual(scene.scene.dashboard,dashboard);assert.equal(JSON.stringify(scene).includes('private-dashboard'),false);
 function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
 for(const payload of [asset,{z:[0,-0,1.25,null,undefined,NaN],a:[{雪:'中文',a:undefined},{x:[1,2,3]}]}]){const value={kind:'asset',payload,name:'中文😀',description:'',category:''},legacy=createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');assert.equal(await fingerprints.fingerprintTeamContent(value),legacy);}
 const client=new api.TeamClient('https://example.test');let sent;const originalFetch=globalThis.fetch;globalThis.fetch=async(_url,init)=>{sent=init.body;return Response.json({id:'frozen-result',version:1});};
 try{const request={...prepared.request};Object.defineProperty(request,'payload',{get(){throw Error('cached publish must not inspect/stringify payload');}});await client.publish(request,undefined,prepared.serializedBody);assert.equal(sent,frozen);}finally{globalThis.fetch=originalFetch;}
 const messages=[];globalThis.postMessage=message=>messages.push(message);await vite.ssrLoadModule('/src/domain/teamPreparationWorker.ts');
 await globalThis.onmessage({data:{type:'prepare',input}});assert.deepEqual(messages.filter(message=>message.type==='progress').map(message=>message.stage),['reading','sanitizing','validating','fingerprinting','serializing']);const result=messages.find(message=>message.type==='result');assert.ok(result);assert.equal('payload' in result.request,false);assert.equal(JSON.parse(result.serializedBody).payload.id,asset.id);
 messages.length=0;await globalThis.onmessage({data:{type:'prepare',input:{...input,asset:{id:'missing-asset',version:1}}}});assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).message,/未找到/);assert.equal(messages.some(message=>message.type==='result'),false);
 const receiver=wire.preparationReceiver();let root;const graph={numbers:Array.from({length:20000},(_,i)=>i/10),long:'字符'.repeat(50000),nested:{name:'快照'}};for(const record of wire.preparationRecords(graph,value=>{root=value;}))receiver.accept([record]);assert.deepEqual(receiver.get(root),graph);
 console.log('PASS preparation stage/error protocol, cached frozen request, original canonical fingerprint, material allowlist and bounded snapshot transport');
}finally{globalThis.postMessage=originalPost;globalThis.onmessage=originalMessage;await vite.close();dom.window.close();}
