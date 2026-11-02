import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});let count=0;
const test=async(name,fn)=>{await fn();console.log('PASS',name);count++;};
class Transfer{data=new Map();types=[];setData(type,value){this.data.set(type,value);this.types.push(type);}getData(type){return this.data.get(type)??'';}}
try{
 const w=await server.ssrLoadModule('/src/workspace.ts'),{useEditorStore:s,createInitialDoc}=await server.ssrLoadModule('/src/store.ts'),{applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts'),{createModelAsset}=await server.ssrLoadModule('/src/domain/modelAssets.ts'),storage=await server.ssrLoadModule('/src/domain/modelAssetStorage.ts'),m=await server.ssrLoadModule('/src/ui/libraryAssetDrag.tsx'),{assemblyBounds}=await server.ssrLoadModule('/src/domain/assemblyEditing.ts');
 await w.initializeWorkspace();w.createSession(undefined,{moduleKind:'scene'});s.setState({viewportStatus:'ready'});
 const base=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',name:'part',parentId:null,materialId:'mat_blue',geometry:{type:'box',params:{width:2,height:1,depth:1}},transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]}}]}).doc;
 const asset=createModelAsset(base,base.nodes.map(node=>node.id),{name:'拖入资产',category:'设备'});await storage.saveModelAsset(asset,0);const original=await storage.readModelAsset(asset.id,1);
 const start=()=>{const transfer=new Transfer();m.beginLibraryAssetDrag(asset,transfer);return transfer;};
 await test('outside drop cancellation leaves the scene and source asset untouched',async()=>{const transfer=start();m.finishLibraryAssetDrag();assert.equal(await m.commitLibraryAssetDrop(transfer,[3,0,5]),false);assert.equal(s.getState().doc.nodes.length,0);assert.deepEqual(await storage.readModelAsset(asset.id,1),original);});
 await test('drop commits a ground-centered fixed-version instance once and supports undo/redo',async()=>{
  const transfer=start(),pending=m.commitLibraryAssetDrop(transfer,[3,0,5]);m.finishLibraryAssetDrag();assert.equal(await pending,true);assert.equal(s.getState().doc.nodes.length,1);assert.equal(s.getState().selection.length,1);const bounds=assemblyBounds(s.getState().doc.nodes);assert.equal(bounds.min.y,0);assert.equal((bounds.min.x+bounds.max.x)/2,3);assert.equal((bounds.min.z+bounds.max.z)/2,5);assert.equal(s.getState().doc.nodes[0].modelAsset.version,1);assert.equal(await m.commitLibraryAssetDrop(transfer,[9,0,9]),false);s.getState().undo();assert.equal(s.getState().doc.nodes.length,0);s.getState().redo();assert.equal(s.getState().doc.nodes.length,1);assert.deepEqual(await storage.readModelAsset(asset.id,1),original);
 });
 await test('same-document navigation during the async read cannot insert into either conversation',async()=>{
  const origin=w.useWorkspaceStore.getState().activeId,doc=s.getState().doc,transfer=start(),pending=m.commitLibraryAssetDrop(transfer,[6,0,7]);w.createSession(doc,{moduleKind:'scene'});assert.equal(await pending,false);assert.equal(s.getState().doc,doc);assert.equal(w.getSessionEditor(origin).getState().doc,doc);
 });
 await test('editing the scene invalidates an outstanding drag',async()=>{const transfer=start();s.getState().applyCommandBatch([{op:'rename',targetId:s.getState().doc.nodes[0].id,name:'新名称'}],'rename');const doc=s.getState().doc;assert.equal(await m.commitLibraryAssetDrop(transfer,[1,0,2]),false);assert.equal(s.getState().doc,doc);});
 await test('generation locks reject both an ongoing drop and new drags',async()=>{const transfer=start(),doc=s.getState().doc;s.setState({aiStatus:'generating'});assert.equal(await m.commitLibraryAssetDrop(transfer,[1,0,2]),false);assert.throws(start,/结束生成/);assert.equal(s.getState().doc,doc);s.setState({aiStatus:'idle'});});
 await test('an unrelated drag token cannot consume or commit the active asset',async()=>{start();const foreign=new Transfer();foreign.setData(m.LIBRARY_ASSET_DRAG_TYPE,'foreign');assert.equal(await m.commitLibraryAssetDrop(foreign,[0,0,0]),false);assert.ok(m.useLibraryAssetDrag.getState().drag);m.cancelLibraryAssetDrag();});
 await test('Escape cancellation and a changed viewport prevent delayed insertion',async()=>{const doc=s.getState().doc;let transfer=start(),pending=m.commitLibraryAssetDrop(transfer,[2,0,3]);m.cancelLibraryAssetDrag();assert.equal(await pending,false);transfer=start();assert.equal(await m.commitLibraryAssetDrop(transfer,[2,0,3],()=>false),false);assert.equal(s.getState().doc,doc);});
 m.cancelLibraryAssetDrag();await w.flushWorkspace();console.log(count+' asset drag checks passed; no model requests');
}finally{await server.close();}
