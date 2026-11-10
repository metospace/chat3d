import assert from 'node:assert/strict';
import {createServer} from 'vite';
import 'fake-indexeddb/auto';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts'),{applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const {createModelAsset}=await server.ssrLoadModule('/src/domain/modelAssets.ts'),s=await server.ssrLoadModule('/src/domain/modelAssetStorage.ts');
 const {assetFingerprint}=await server.ssrLoadModule('/src/domain/assetQuality.ts');
 const doc=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',parentId:null,name:'box',materialId:'mat_gray',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}).doc;
 const template=createModelAsset(doc,[doc.nodes[0].id],{name:'backup',category:'其他'});
 const reset=()=>new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('chat3d.model-assets.v1');request.onsuccess=resolve;request.onerror=()=>reject(request.error);});
 for(const kind of ['versions','reviews','metadata']) {
  await reset();
  for(let i=1;i<=200;i++) {
   const asset={...template,id:kind==='metadata'?`asset-${i}`:template.id,version:kind==='metadata'?1:i};
   await s.saveModelAsset(asset,asset.version-1);
   if(kind==='reviews')await s.saveAssetQuality({assetId:asset.id,version:asset.version,createdAt:asset.createdAt,fingerprint:await assetFingerprint(asset),reviewer:'user',checks:['silhouette','structure','connections','materials','details','context'].map(criterion=>({criterion,status:'unknown',evidence:'待验收'})),views:[]});
  }
  const text=await s.exportAssetLibraryText(),backup=JSON.parse(text);assert.equal(backup[kind].length,200);
  await reset();assert.equal(await s.importAssetLibrary(text),kind==='metadata'?200:1);
  const restored=await s.exportAssetLibrary();assert.equal(restored[kind].length,200);
  const overflow={...backup,[kind]:[...backup[kind],backup[kind][0]]};
  await assert.rejects(()=>s.importAssetLibrary(JSON.stringify(overflow)),/超过 200 条/);
  // Seed an otherwise unreachable over-limit collection directly to exercise export's gate independently.
  const db=await s.openModelAssetDatabase();await new Promise((resolve,reject)=>{const stores={versions:'versions',reviews:'reviews',metadata:'items'},tx=db.transaction(stores[kind],'readwrite'),store=tx.objectStore(stores[kind]);
   if(kind==='versions')store.add({...template,id:'overflow'});
   if(kind==='reviews')store.add({...backup.reviews[0],assetId:'overflow'});
   if(kind==='metadata')store.add({id:'overflow',version:1,name:'overflow',category:'其他',createdAt:template.createdAt});
   tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });db.close();
  await assert.rejects(()=>s.exportAssetLibraryText(),/超过 200 条/);await assert.rejects(()=>s.exportAssetLibrary(),/超过 200 条/);
  console.log(`PASS ${kind}: 200 records restore unchanged; 201 rejected by import and both export APIs`);
 }
} finally {await server.close();}
