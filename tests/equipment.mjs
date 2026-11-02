import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import * as THREE from 'three';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name)};
try{
 const {buildEquipment}=await server.ssrLoadModule('/src/domain/equipment.ts');
 const {createInitialDoc,useEditorStore:store}=await server.ssrLoadModule('/src/store.ts');
 const {applyBatch,estimateCost}=await server.ssrLoadModule('/src/domain/commands.ts');
 const {parseModelResponse}=await server.ssrLoadModule('/src/ai/provider.ts');
 const {serializeProject,parseProject}=await server.ssrLoadModule('/src/domain/project.ts');
 const {validateDocument,validateGeometry}=await server.ssrLoadModule('/src/domain/types.ts');
 const {buildExportScene,exportGlb}=await server.ssrLoadModule('/src/scene/export.ts');
 const {buildPrimitiveGeometry}=await server.ssrLoadModule('/src/scene/geometry.ts');
 const op={op:'createTemplate',templateId:'smt_mounter',parameters:{},tempId:'machine'};
 const base=createInitialDoc();const result=applyBatch(base,{operations:[op]});
 await test('detailed equipment includes distinct functional parts and fits bounded dimensions',()=>{assert.equal(result.errors.length,0);assert.ok(result.doc.nodes.length>75);assert.ok(result.doc.nodes.length<=estimateCost([op]).newNodes);assert.equal(validateDocument(result.doc).length,0);assert.ok(buildEquipment('smt_mounter',{feeders:24}).length<=estimateCost([op]).newNodes);assert.ok(result.doc.nodes.some(n=>n.name.includes('贴装头')));assert.ok(result.doc.nodes.some(n=>n.name.includes('观察窗')));assert.equal(result.doc.nodes.filter(n=>n.name.includes('料盘 ')&&!n.name.includes('轴')).length,12);const scene=buildExportScene(result.doc);const bounds=new THREE.Box3().setFromObject(scene);assert.ok(bounds.min.y>=-1e-6);assert.ok(bounds.max.y<2);assert.ok(bounds.max.x-bounds.min.x<2);scene.traverse(n=>{n.geometry?.dispose();n.material?.dispose()})});
 await test('component creation parses and unknown/unsafe parameters are refused atomically',()=>{assert.throws(()=>parseModelResponse(JSON.stringify({summary:'设备',operations:[op]})));for(const parameters of [{width:NaN},{depth:0},{feeders:200},{feeders:2.5},{height:100},{unknown:1}])assert.throws(()=>buildEquipment('smt_mounter',parameters));assert.throws(()=>buildEquipment('unknown'));const r=applyBatch(base,{operations:[{...op,parameters:{width:100}}]});assert.equal(r.errors.length,1);assert.equal(r.doc.nodes.length,0)});
 await test('assembly move reaches every part, temp IDs work and whole batch undo/redo retains identity',()=>{const r=applyBatch(base,{operations:[op,{op:'translateAssembly',targetId:'machine',value:[3,0,2]}]});assert.equal(r.errors.length,0);const zero=buildEquipment('smt_mounter');r.doc.nodes.forEach((n,i)=>{assert.ok(Math.abs(n.transform.position[0]-zero[i].transform.position[0]-3)<1e-8)});store.setState({doc:base,past:[],future:[],messages:[],aiStatus:'previewing',pendingBatch:{requestId:'eq',projectId:base.projectId,baseRevision:base.revision,summary:'设备',selectedIds:[],operations:[op]},pendingResult:r});store.getState().confirmPending();const ids=store.getState().doc.nodes.map(n=>n.id);store.getState().undo();assert.equal(store.getState().doc.nodes.length,0);store.getState().redo();assert.deepEqual(store.getState().doc.nodes.map(n=>n.id),ids)});
 await test('project and GLB scene preserve editable parts, assembly IDs and transparent glazing',()=>{const doc=parseProject(serializeProject(result.doc));assert.equal(doc.nodes[0].assemblyId,result.doc.nodes[0].assemblyId);const scene=buildExportScene(doc);assert.equal(scene.children.length,doc.nodes.length);const glass=scene.children.find(n=>n.name.includes('烟色观察窗'));assert.ok(glass.material.isMeshPhysicalMaterial);assert.equal(glass.material.transmission,.92);assert.equal(glass.material.ior,1.5);assert.equal(glass.material.thickness,.008);assert.equal(glass.material.opacity,1);scene.traverse(n=>{n.geometry?.dispose();n.material?.dispose()})});
 await test('legacy project alpha glazing remains transparent instead of adopting stock physical glass',()=>{
  const legacy=structuredClone(result.doc);
  legacy.materials=legacy.materials.map(material=>material.id==='mat_glass'?{id:'mat_glass',baseColor:'#9BB8C9',roughness:.1,metalness:0,transparent:true,opacity:.38}:material);
  const restored=parseProject(serializeProject(legacy));const scene=buildExportScene(restored);
  const glass=scene.children.find(node=>node.name.includes('烟色观察窗'));
  assert.equal(glass.material.transparent,true);assert.equal(glass.material.opacity,.38);assert.ok(!glass.material.isMeshPhysicalMaterial);
  scene.traverse(node=>{node.geometry?.dispose();node.material?.dispose()});
 });
 await test('yaw rotates complete equipment consistently and conveyor uses different structure',()=>{const normal=buildEquipment('pcb_conveyor');const rotated=buildEquipment('pcb_conveyor',{},[2,0,1],90);normal.forEach((n,i)=>{assert.ok(Math.abs(rotated[i].transform.position[0]-2-n.transform.position[2])<1e-8);assert.ok(Math.abs(rotated[i].transform.position[2]-1+n.transform.position[0])<1e-8)});assert.ok(normal.some(n=>n.name.includes('皮带')));assert.ok(!normal.some(n=>n.name.includes('贴装头')))});
 await test('explicit thin-sheet bevel validates and shared geometry respects overall dimensions',()=>{const g={type:'box',params:{width:.4,height:.3,depth:.02,bevelRadius:.002}};assert.equal(validateGeometry(g).length,0);const geometry=buildPrimitiveGeometry(g);geometry.computeBoundingBox();const size=geometry.boundingBox.getSize(new THREE.Vector3());assert.ok(Math.abs(size.z-.02)<1e-6);assert.ok(validateGeometry({...g,params:{...g.params,bevelRadius:.2}}).length);assert.equal(validateGeometry({...g,params:{...g.params,bevelRadius:0}}).length,0);geometry.dispose()});
 if(process.env.EXPORT_EQUIPMENT){globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.()})}readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result='data:'+blob.type+';base64,'+Buffer.from(v).toString('base64');this.onloadend?.()})}};await writeFile('/workspace/shared/chat3d-equipment-preview.glb',Buffer.from(await exportGlb(result.doc)));}
 console.log(`${passed} equipment checks passed`);
}finally{await server.close()}
