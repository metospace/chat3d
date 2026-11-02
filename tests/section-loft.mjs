import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {Box3,Vector3,Quaternion,Euler} from 'three';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)};
try{
 const {validateGeometry}=await server.ssrLoadModule('/src/domain/types.ts');
 const {buildPrimitiveGeometry}=await server.ssrLoadModule('/src/scene/geometry.ts');
 const {parseModelResponse,buildSceneContext}=await server.ssrLoadModule('/src/ai/provider.ts');
 const {applyBatch,cloneGeometry}=await server.ssrLoadModule('/src/domain/commands.ts');
 const {createInitialDoc,useEditorStore}=await server.ssrLoadModule('/src/store.ts');
 const {serializeProject,parseProject}=await server.ssrLoadModule('/src/domain/project.ts');
 const {boundsFor}=await server.ssrLoadModule('/src/domain/sceneQuality.ts');
 const {matchesGeometryApproach}=await server.ssrLoadModule('/src/domain/geometryApproach.ts');
 const {buildExportScene,disposeExportScene,exportGlb}=await server.ssrLoadModule('/src/scene/export.ts');
 const {importGlb}=await server.ssrLoadModule('/src/scene/importGlb.ts');
 const {scenePublication,assetPublication}=await server.ssrLoadModule('/src/domain/teamLibrary.ts');
 const {createModelAsset,parseModelAsset,instantiateAsset}=await server.ssrLoadModule('/src/domain/modelAssets.ts');
 const {buildTeamCopyExport}=await server.ssrLoadModule('/src/domain/teamCopyExport.ts');
 const rounded={type:'sectionLoft',params:{shape:'roundedRectangle',segments:32,sections:[{center:[0,0,0],width:1.1,depth:1.8,cornerRadius:.12},{center:[0,.25,0],width:1.15,depth:1.85,cornerRadius:.15},{center:[.03,.8,0],width:.95,depth:1.6,cornerRadius:.2},{center:[.04,1,0],width:.85,depth:1.45,cornerRadius:.18}]}};
 const contour=[[-.5,-.4],[.5,-.4],[.5,-.1],[.1,-.1],[.1,.4],[-.5,.4]];
 const polygon={type:'sectionLoft',params:{shape:'polygon',sections:[{center:[0,0,0],points:contour},{center:[.03,1,.02],points:contour.map(([x,z])=>[x*.8,z*.7])}]}};
 const create=geometry=>({op:'createPrimitive',name:'continuous shell',parentId:null,geometry,materialId:'mat_gray',transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}});
 function solid(geo){
  const edges=new Map(),p=geo.attributes.position,uv=geo.attributes.uv,index=geo.index.array;let volume=0;
  const key=n=>[p.getX(n),p.getY(n),p.getZ(n)].map(x=>Math.round(x*1e6)).join(',');
  for(let k=0;k<index.length;k+=3){const [a,b,c]=index.slice(k,k+3),av=new Vector3().fromBufferAttribute(p,a),bv=new Vector3().fromBufferAttribute(p,b),cv=new Vector3().fromBufferAttribute(p,c);assert.ok(bv.clone().sub(av).cross(cv.clone().sub(av)).length()>1e-10,'non-degenerate triangle');volume+=av.dot(bv.clone().cross(cv))/6;
   assert.ok(Math.abs((uv.getX(b)-uv.getX(a))*(uv.getY(c)-uv.getY(a))-(uv.getY(b)-uv.getY(a))*(uv.getX(c)-uv.getX(a)))>1e-12,'non-collapsed UV');
   for(let j=0;j<3;j++){const a=key(index[k+j]),b=key(index[k+(j+1)%3]),edge=[a,b].sort().join('|');edges.set(edge,(edges.get(edge)??0)+1);}
  }
  assert.ok(volume>0,'outward winding');assert.ok([...edges.values()].every(n=>n===2),'watertight welded solid');assert.ok([...geo.attributes.normal.array].every(Number.isFinite));return volume;
 }
 let doc;
 await test('four compact rounded sections make one capped shell with true rounded-rectangle dimensions and seam normals',()=>{
  assert.deepEqual(validateGeometry(rounded),[]);const geo=buildPrimitiveGeometry(rounded);solid(geo);geo.computeBoundingBox();assert.ok(Math.abs(geo.boundingBox.getSize(new Vector3()).x-1.15)<1e-6);assert.ok(Math.abs(geo.boundingBox.getSize(new Vector3()).z-1.85)<1e-6);assert.deepEqual(boundsFor(rounded).min.toArray(),geo.boundingBox.min.toArray());
  for(let row=0;row<4;row++){const a=row*33,b=a+32;for(const axis of ['X','Y','Z'])assert.equal(geo.attributes.normal['get'+axis](a),geo.attributes.normal['get'+axis](b));}
  assert.ok(geo.attributes.normal.getY(132)<-.999);assert.ok(geo.attributes.normal.getY(164)>.999);geo.dispose();
  const high=structuredClone(rounded);high.params.segments=64;assert.deepEqual(validateGeometry(high),[]);const detailed=buildPrimitiveGeometry(high);solid(detailed);assert.equal(detailed.attributes.position.count,4*65+2*64);detailed.dispose();
  const legacy={type:'loft',params:{rings:[{center:[0,0,0],radiusX:.5,radiusZ:.3},{center:[0,1,0],radiusX:.4,radiusZ:.2}],segments:32}};assert.deepEqual(validateGeometry(legacy),[]);const legacyGeometry=buildPrimitiveGeometry(legacy);solid(legacyGeometry);legacyGeometry.dispose();
 });
 await test('explicit concave non-elliptical sections preserve real silhouette and either consistent winding',()=>{
  for(const reverse of [false,true]){const g=structuredClone(polygon);if(reverse)g.params.sections.forEach(s=>s.points.reverse());assert.deepEqual(validateGeometry(g),[]);const geo=buildPrimitiveGeometry(g);solid(geo);geo.dispose();}
 });
 await test('invalid layer order, correspondence, crossed polygons, twists, precision collapse and budgets reject without simplification',()=>{
  const mutate=fn=>{const g=structuredClone(rounded);fn(g.params);return g;};const twist=structuredClone(polygon);twist.params.sections[1].points=twist.params.sections[0].points.map(([x,z])=>[-x,-z]);
  const bad=[mutate(p=>p.segments=1000),mutate(p=>p.segments=31),mutate(p=>p.sections=Array(33).fill(p.sections[0])),mutate(p=>p.sections[1].center[1]=0),mutate(p=>p.sections[0].center[0]=Infinity),mutate(p=>p.sections[0].cornerRadius=.9),mutate(p=>p.unknown=true),mutate(p=>p.sections[0].hidden='secret'),twist];
  for(const change of [s=>s.points.reverse(),s=>s.points.pop(),s=>s.points=[[0,0],[1,1],[0,1],[1,0]],s=>s.points[1]=s.points[0]]){const g=structuredClone(polygon);change(g.params.sections[1]);bad.push(g);}
  bad.push({type:'sectionLoft',params:{shape:'polygon',sections:[{center:[99,0,99],points:[[0,0],[1e-6,0],[0,1e-6]]},{center:[99,1,99],points:[[0,0],[1e-6,0],[0,1e-6]]}]}});
  for(const g of bad){assert.ok(validateGeometry(g).length,JSON.stringify(g));assert.throws(()=>buildPrimitiveGeometry(g));}
 });
 await test('parser, commands, duplication, persistence, matching and compact scene context consume the new geometry',()=>{
  const parsed=parseModelResponse(JSON.stringify({summary:'continuous sections',operations:[create(rounded),create(polygon)]}));assert.equal(parsed.operations.length,2);const r=applyBatch(createInitialDoc(),parsed);assert.deepEqual(r.errors,[]);doc=parseProject(serializeProject(r.doc));assert.deepEqual(doc.nodes.map(n=>n.geometry),[rounded,polygon]);assert.ok(matchesGeometryApproach('sweep',doc.nodes));assert.ok(buildSceneContext(doc,[]).nodes.every(n=>n.desc.includes('sectionLoft')));
  const copy=cloneGeometry(rounded);copy.params.sections[0].center[0]=9;assert.equal(rounded.params.sections[0].center[0],0);
  const grouped=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'shell',parts:[{name:'shell',geometry:rounded,transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}]});const duplicate=applyBatch(grouped.doc,{operations:[{op:'duplicateAssembly',targetId:grouped.doc.nodes[0].id,offset:[2,0,0],name:'shell copy'}]});assert.deepEqual(duplicate.errors,[]);assert.deepEqual(duplicate.doc.nodes[1].geometry,rounded);
 });
 await test('command failure remains atomic and undo redo restores complete section arrays',()=>{
  const base=createInitialDoc(),bad=structuredClone(rounded);bad.params.sections[1].center[1]=0;
  const failed=applyBatch(base,{operations:[create(rounded),create(bad)]});assert.ok(failed.errors.length);assert.equal(failed.doc,base);assert.deepEqual(failed.applied,[]);
  useEditorStore.setState({doc:base,past:[],future:[],aiStatus:'idle'});assert.equal(useEditorStore.getState().applyCommandBatch([create(rounded)],'shell').ok,true);const id=useEditorStore.getState().doc.nodes[0].id;
  const changed=structuredClone(rounded);changed.params.sections[3].width=.7;assert.equal(useEditorStore.getState().applyCommandBatch([{op:'updateParameters',targetId:id,geometry:changed}],'taper').ok,true);useEditorStore.getState().undo();assert.deepEqual(useEditorStore.getState().doc.nodes[0].geometry,rounded);useEditorStore.getState().redo();assert.deepEqual(useEditorStore.getState().doc.nodes[0].geometry,changed);
  const before=useEditorStore.getState().doc,history=useEditorStore.getState().past;assert.equal(useEditorStore.getState().applyCommandBatch([create(rounded),create(bad)],'reject').ok,false);assert.equal(useEditorStore.getState().doc,before);assert.equal(useEditorStore.getState().past,history);
 });
 await test('scene and asset team copies roundtrip sections while filtering all unknown nested fields',()=>{
  const dirty=structuredClone(doc);dirty.nodes[0].geometry.private='hidden';dirty.nodes[0].geometry.params.private='hidden';dirty.nodes[0].geometry.params.sections[0].private={session:'hidden'};
  const published=scenePublication(dirty);assert.ok(!JSON.stringify(published).includes('hidden'));const restored=parseProject(buildTeamCopyExport({kind:'scene',name:'sections',payload:published}));assert.notEqual(restored.projectId,doc.projectId);assert.deepEqual(restored.nodes.map(n=>n.geometry),doc.nodes.map(n=>n.geometry));
  const asset=createModelAsset(doc,doc.nodes.map(n=>n.id),{name:'sections',category:'设备'});asset.nodes[0].geometry.params.sections[0].private='hidden';const safe=assetPublication(asset);assert.ok(!JSON.stringify(safe).includes('hidden'));const copy=parseModelAsset(buildTeamCopyExport({kind:'asset',name:'sections',payload:safe}));const inserted=applyBatch(createInitialDoc(),{operations:[instantiateAsset(copy,[0,0,0])]});assert.deepEqual(inserted.errors,[]);assert.deepEqual(inserted.doc.nodes.map(n=>n.geometry),doc.nodes.map(n=>n.geometry));
 });
 await test('rotated visible export preserves dimensions, caps, normals and GLB geometry and disposes resources',async()=>{
  const rotated=structuredClone(doc);rotated.nodes=rotated.nodes.slice(0,1);rotated.nodes[0].transform.rotationQuaternion=new Quaternion().setFromEuler(new Euler(Math.PI/2,0,0)).toArray();const scene=buildExportScene(rotated);scene.updateMatrixWorld(true);const size=new Box3().setFromObject(scene).getSize(new Vector3());assert.ok(Math.abs(size.y-1.85)<1e-6);assert.ok(Math.abs(size.z-1)<1e-6);solid(scene.children[0].geometry);
  let geometryDisposed=false,materialDisposed=false;scene.children[0].geometry.addEventListener('dispose',()=>geometryDisposed=true);scene.children[0].material.addEventListener('dispose',()=>materialDisposed=true);disposeExportScene(scene);assert.equal(geometryDisposed,true);assert.equal(materialDisposed,true);
  globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()})}};
  const imported=await importGlb(await exportGlb(rotated),'sections.glb');assert.equal(imported.doc.nodes.length,1);const mesh=buildPrimitiveGeometry(imported.doc.nodes[0].geometry);solid(mesh);mesh.dispose();
 });
 console.log(`${passed} section loft checks passed; no model calls`);
}finally{await server.close()}
