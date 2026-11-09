import assert from 'node:assert/strict';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
let passed=0;
const test=async(name,fn)=>{await fn();console.log('PASS '+name);passed++;};
try{
 const {parseModelResponse}=await server.ssrLoadModule('/src/ai/provider.ts');
 const {MODEL_CONFIG_KEY,saveModelConfig,loadModelConfig}=await server.ssrLoadModule('/src/ai/modelConfigStorage.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {validateMaterial,validateDocument}=await server.ssrLoadModule('/src/domain/types.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const {withStockMaterials}=await server.ssrLoadModule('/src/domain/materials.ts');
 const {createSceneMaterial,materialCastsShadow}=await server.ssrLoadModule('/src/scene/material.ts');
 const {buildExportScene,exportGlb,disposeExportScene}=await server.ssrLoadModule('/src/scene/export.ts');
 const {importGlb}=await server.ssrLoadModule('/src/scene/importGlb.ts');
 const {exportHtml}=await server.ssrLoadModule('/src/scene/exportHtml.ts');
 const {proceduralMaps}=await server.ssrLoadModule('/src/scene/surfaceTextures.ts');
 const {serializeProject,parseProject}=await server.ssrLoadModule('/src/domain/project.ts');
 const {scenePublication}=await server.ssrLoadModule('/src/domain/teamLibrary.ts');
 const {normalizeRenderPreset,loadRenderPreset,saveRenderPreset}=await server.ssrLoadModule('/src/scene/renderPreset.ts');
 const config={baseURL:'https://example.invalid/v1',apiKey:'private-test-key',model:'test'};
 const base=createInitialDoc();

 await test('legacy quality and style are discarded while respecting API key consent',()=>{
  const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  for(const rememberApiKey of [false,true]){
   const legacy={...config,generationQuality:'fast',generationStyle:'illustrative',rememberApiKey};
   saveModelConfig(legacy);const saved=JSON.parse(values.get(MODEL_CONFIG_KEY)),loaded=loadModelConfig();
   for(const value of [saved,loaded]){assert.equal(Object.hasOwn(value,'generationQuality'),false);assert.equal(Object.hasOwn(value,'generationStyle'),false);assert.equal(value.baseURL,config.baseURL);assert.equal(value.model,config.model);}
   assert.equal(loaded.apiKey,rememberApiKey?config.apiKey:'');assert.equal(saved.apiKey,rememberApiKey?config.apiKey:undefined);assert.equal(JSON.stringify([...values]).includes(config.apiKey),rememberApiKey);
   values.set(MODEL_CONFIG_KEY,JSON.stringify(legacy));const migrated=loadModelConfig(),persisted=JSON.parse(values.get(MODEL_CONFIG_KEY));
   for(const value of [migrated,persisted]){assert.equal(Object.hasOwn(value,'generationQuality'),false);assert.equal(Object.hasOwn(value,'generationStyle'),false);assert.equal(value.baseURL,config.baseURL);assert.equal(value.model,config.model);}
   assert.equal(migrated.apiKey,config.apiKey);assert.equal(persisted.apiKey,rememberApiKey?config.apiKey:undefined);assert.equal(JSON.stringify([...values]).includes(config.apiKey),rememberApiKey);
  }
  assert.equal(normalizeRenderPreset('invalid'),'studio');saveRenderPreset('classic');assert.equal(loadRenderPreset(),'classic');
  globalThis.localStorage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};assert.equal(loadRenderPreset(),'classic');assert.doesNotThrow(()=>saveRenderPreset('studio'));assert.equal(loadRenderPreset(),'studio');delete globalThis.localStorage;
 });
 const physical={id:'test-glass',baseColor:'#dce9eb',roughness:.1,metalness:0,opacity:1,transmission:.9,thickness:.008,ior:1.5,clearcoat:.1,clearcoatRoughness:.2,specularIntensity:.3,specularColor:'#80a0c0'};
 await test('physical factors are validated and partial edits preserve original project materials',()=>{
  assert.equal(validateMaterial(physical).length,0);
  for(const patch of [{ior:NaN},{ior:.9},{transmission:1.1},{thickness:-1},{clearcoat:Infinity},{specularIntensity:NaN},{specularIntensity:-.1},{specularIntensity:1.1},{specularColor:'white'},{specularColor:'#fff'}])assert.ok(validateMaterial({...physical,...patch}).length);
  const before=structuredClone(base);
  const r=applyBatch(base,{operations:[{op:'createPrimitive',name:'玻璃',tempId:'glass',geometry:{type:'box',params:{width:1,height:1,depth:.008,bevelRadius:0}},parentId:null,transform:{position:[0,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]},materialId:'mat_gray'},{op:'setAppearance',targetId:'glass',transmission:.9,ior:1.5,thickness:.008,opacity:1}]});
  assert.equal(r.errors.length,0);assert.deepEqual(base,before);assert.equal(validateDocument(r.doc).length,0);
  assert.equal(r.doc.materials.find(m=>m.id===r.doc.nodes[0].materialId).transmission,.9);
  const parsed=parseModelResponse(JSON.stringify({summary:'材质',operations:[{op:'setAppearance',targetId:'real-id',...Object.fromEntries(['transmission','thickness','ior','clearcoat','clearcoatRoughness'].map(k=>[k,physical[k]]))}]}));
  assert.equal(parsed.operations[0].ior,1.5);
  const legacy={...base,materials:base.materials.map(m=>m.id==='mat_paint'?{...m,metalness:.18,roughness:.32}:m)};
  assert.deepEqual(withStockMaterials(legacy).materials.find(m=>m.id==='mat_paint'),legacy.materials.find(m=>m.id==='mat_paint'));
 });
 await test('only requested physical shaders are used and transmissive glass does not cast an opaque shadow',()=>{
  const glass=createSceneMaterial(physical),paint=createSceneMaterial({...physical,transmission:0}),plain=createSceneMaterial({id:'plain',baseColor:'#ffffff',roughness:.5,metalness:0});
  assert.equal(glass.isMeshPhysicalMaterial,true);assert.equal(materialCastsShadow(glass),false);assert.equal(materialCastsShadow(paint),true);assert.ok(!plain.isMeshPhysicalMaterial);
  assert.equal(createSceneMaterial({...physical,transmission:0,opacity:.4}).opacity,.4);
  for(const patch of [{specularIntensity:0},{specularColor:'#80a0c0'}]){
   const material=createSceneMaterial({id:'specular',baseColor:'#ffffff',roughness:.5,metalness:0,...patch});
   assert.equal(material.isMeshPhysicalMaterial,true);assert.equal(material.specularIntensity,patch.specularIntensity??1);assert.equal(material.specularColor.getHexString(),(patch.specularColor??'#ffffff').slice(1));material.dispose();
  }
  for(const m of [glass,paint,plain])m.dispose();
 });
 await test('surface maps retain authored roughness and encode normalized, repeating normal vectors',()=>{
  for(const preset of ['brushed_metal','powder_coat','rubber','fabric','wood','concrete']){
   const {normal,rough}=proceduralMaps({preset,repeat:[6,8],strength:.1});assert.deepEqual(normal.repeat.toArray(),[6,8]);
   assert.ok(Math.min(...rough.image.data)>=235); // roughness pixels include alpha 255
   for(let i=0;i<normal.image.data.length;i+=1024){const vector=Array.from(normal.image.data.slice(i,i+3),v=>v/127.5-1);assert.ok(Math.abs(Math.hypot(...vector)-1)<.015);}
   normal.dispose();rough.dispose();
  }
 });
 await test('project and actual GLB roundtrips preserve physical factors, geometry, and labels',async()=>{
  globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()})}};
  const r=applyBatch(base,{operations:[{op:'createPrimitive',name:'透射玻璃',geometry:{type:'box',params:{width:1,height:1,depth:.008,bevelRadius:0}},parentId:null,transform:{position:[0,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]},materialId:'mat_gray'}]});assert.equal(r.errors.length,0);
  const doc={...r.doc,materials:[physical],nodes:r.doc.nodes.map(n=>({...n,materialId:physical.id}))};
  const saved=parseProject(serializeProject(doc)).materials[0];assert.equal(saved.transmission,.9);assert.equal(saved.specularIntensity,.3);assert.equal(saved.specularColor,physical.specularColor);
  const published=scenePublication(doc).scene.materials[0];for(const key of ['clearcoat','clearcoatRoughness','transmission','thickness','ior','specularIntensity','specularColor'])assert.equal(published[key],physical[key],key);
  const html=await exportHtml(doc,'glass');
  const embedded=JSON.parse(html.match(/<script id="scene-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.ok(embedded.materials.every(m=>m.attenuationDistance!==null));
  const scene=buildExportScene(doc);assert.equal(scene.children[0].material.transmission,.9);assert.equal(scene.children[0].material.specularIntensity,.3);assert.equal(scene.children[0].material.specularColor.getHexString(),physical.specularColor.slice(1));disposeExportScene(scene);
  const round=await importGlb(await exportGlb(doc),'glass.glb');const m=round.doc.materials.find(m=>m.id===round.doc.nodes[0].materialId);
  for(const key of ['clearcoat','clearcoatRoughness','transmission','thickness','ior','specularIntensity'])assert.ok(Math.abs(m[key]-physical[key])<1e-6,key);
  assert.equal(m.specularColor.toLowerCase(),physical.specularColor);
  assert.equal(round.doc.nodes[0].geometry.type,'mesh');
 });
 console.log(`${passed} realistic modeling checks passed; no model requests`);
}finally{await server.close()}
