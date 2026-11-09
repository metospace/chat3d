import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
import * as THREE from 'three';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
const dom=new JSDOM('<!doctype html><html><body></body></html>');installBrowserGlobals(dom);
const globals=['window','document','HTMLImageElement','HTMLCanvasElement','ImageData','Image'];
const original=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9sAAAAASUVORK5CYII=';
let imageLoads=0;
let labelDraws=[];
let rejectImage=false;
for(const key of globals.filter(key=>key!=='Image'))Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true});
dom.window.HTMLCanvasElement.prototype.getContext=function(type){
  assert.equal(type,'2d');
  return {fillText(text){labelDraws.push(text);},drawImage(){},putImageData(){}};
};
dom.window.HTMLCanvasElement.prototype.toDataURL=()=>png;
const imageSources=new WeakMap();
Object.defineProperty(dom.window.HTMLImageElement.prototype,'src',{configurable:true,get(){return imageSources.get(this)??'';},set(value){
  imageSources.set(this,value);
  imageLoads++;
  queueMicrotask(()=>this.dispatchEvent(new dom.window.Event(rejectImage?'error':'load')));
}});
Object.defineProperty(dom.window.HTMLImageElement.prototype,'width',{configurable:true,get:()=>1});
Object.defineProperty(dom.window.HTMLImageElement.prototype,'height',{configurable:true,get:()=>1});
dom.window.HTMLImageElement.prototype.decode=function(){return rejectImage?Promise.reject(new Error('fixture decode failed')):Promise.resolve();};
Object.defineProperty(globalThis,'Image',{configurable:true,writable:true,value:class {
  constructor(){return dom.window.document.createElement('img');}
}});
const node=(extra={})=>({id:'node-main',name:'模型',parentId:null,kind:'primitive',visible:true,materialId:'mat',geometry:{type:'box',params:{width:2,height:3,depth:1}},transform:{position:[3,2,-4],rotationQuaternion:[0,0,0,1],scale:[1.5,1,2]},...extra});
const documentFor=nodes=>({schemaVersion:1,projectId:'private-project-marker',revision:7,unit:'m',upAxis:'Y',nodes,materials:[{id:'mat',baseColor:'#b45432',roughness:.7,metalness:.2}],assets:[],credentials:{apiKey:'private-api-marker'},messages:[{content:'private-dialog-marker'}]});
const parse=html=>{
  const result=new JSDOM(html);
  return {dom:result,data:JSON.parse(result.window.document.getElementById('scene-data').textContent)};
};
function release(scene){scene.traverse(object=>{object.geometry?.dispose();for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[]){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}});}
let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
try {
  const {exportHtml,withHtmlViewerView}=await server.ssrLoadModule('/src/scene/exportHtml.ts');
  await test('empty and hidden-only documents reject without mutating the input',async()=>{
    for(const doc of [documentFor([]),documentFor([node({visible:false})])]){
      const before=structuredClone(doc);
      await assert.rejects(exportHtml(doc,'空项目'));
      assert.deepEqual(doc,before);
    }
  });
  const malicious='中文 <>& "\' </title></script><script>globalThis.injection=1</script>\u2028\u2029';
  const doc=documentFor([node({name:malicious}),node({id:'hidden-secret-node',name:'hidden-secret-name',visible:false,kind:'asset',geometry:undefined})]);
  doc.animation={private:'private-animation-marker'};
  const before=structuredClone(doc);
  let html;
  await test('HTML title and scene names roundtrip special characters without injected elements or scripts',async()=>{
    html=await exportHtml(doc,malicious);
    const {dom:output,data}=parse(html);
    try{
      assert.equal(output.window.document.title,malicious);
      assert.equal(output.window.document.querySelector('h1').textContent,malicious);
      assert.equal(data.object.children[0].name,malicious);
      assert.equal(output.window.document.querySelectorAll('script:not([type="application/json"])').length,1);
      assert.equal(output.window.document.querySelectorAll('script[src],link[href],iframe,img').length,0);
      assert.equal(output.window.injection,undefined);
    }finally{output.window.close();}
  });
  await test('authored embedded camera settings survive configuration replacement without changing scene data',async()=>{
    const view={zoom:1.7,offsetX:.08,offsetY:-.12,azimuth:70,elevation:45};
    const embedded=await exportHtml(doc,'看板模型',undefined,{embedded:true,view});
    const changed=withHtmlViewerView(embedded,{...view,zoom:2});const {dom:original,data}=parse(embedded),{dom:output,data:after}=parse(changed);
    try{assert.deepEqual(after,data);assert.deepEqual(JSON.parse(output.window.document.getElementById('viewer-options').textContent),{view:{...view,zoom:2}});assert.equal(output.window.document.body.dataset.embedded,'true');assert.throws(()=>withHtmlViewerView(embedded,{...view,offsetY:2}),/offsetY/);assert.throws(()=>withHtmlViewerView(embedded,{...view,zoom:NaN}),/zoom/);}finally{original.window.close();output.window.close();}
  });
  await test('only visible static meshes and materials are exported, without private document metadata',async()=>{
    const {dom:output,data}=parse(html);
    let restored;
    try{
      assert.equal(data.object.children.length,1);
      assert.equal(data.animations,undefined);
      for(const secret of ['hidden-secret-node','hidden-secret-name','private-project-marker','private-api-marker','private-dialog-marker','private-animation-marker'])assert.equal(html.includes(secret),false,secret);
      restored=await new THREE.ObjectLoader().parseAsync(data);
      const mesh=restored.children[0];
      assert.equal(mesh.isMesh,true);
      assert.equal(mesh.geometry.attributes.position.count>0,true);
      assert.deepEqual(mesh.position.toArray(),doc.nodes[0].transform.position);
      assert.deepEqual(mesh.scale.toArray(),doc.nodes[0].transform.scale);
      assert.equal(mesh.material.color.getHexString(),'b45432');
      assert.equal(mesh.material.roughness,.7);
      assert.equal(mesh.material.metalness,.2);
      assert.deepEqual(doc,before);
    }finally{if(restored)release(restored);output.window.close();}
  });
  await test('rounded addon geometry and baked primitive transforms roundtrip as exact vertex buffers',async()=>{
    const {buildPrimitiveGeometry}=await server.ssrLoadModule('/src/scene/geometry.ts');
    const geometries=[
      {type:'box',params:{width:2,height:3,depth:1,bevelRadius:.04}},
      {type:'box',params:{width:2,height:3,depth:1,bevelRadius:0}},
      {type:'profile',params:{points:[[0,0],[2,0],[1,1]],depth:.4,edgeRadius:.02}},
      {type:'roundedPlate',params:{width:3,height:.2,depth:2,cornerRadius:.2,holeRadius:.1}},
      {type:'frame',params:{width:3,height:2,depth:.3,thickness:.2}},
      {type:'sweepTube',params:{points:[[0,0,0],[1,1,0],[2,1,1]],radius:.1,segments:12,radialSegments:8}},
      {type:'mesh',params:{positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],uvs:[0,0,1,0,0,1]}}
    ];
    const source=documentFor(geometries.map((geometry,index)=>node({id:`buffer-${index}`,geometry})));
    const snapshot=structuredClone(source);
    const {dom:output,data}=parse(await exportHtml(source,'真实几何缓冲区'));
    let restored;
    try{
      assert.ok(data.geometries.every(geometry=>geometry.type==='BufferGeometry'&&geometry.data?.attributes.position));
      restored=await new THREE.ObjectLoader().parseAsync(data);
      assert.equal(restored.children.length,geometries.length);
      for(let index=0;index<geometries.length;index++){
        const expected=buildPrimitiveGeometry(geometries[index]);
        try{
          const actual=restored.children[index].geometry;
          assert.deepEqual(Object.keys(actual.attributes).sort(),Object.keys(expected.attributes).sort());
          for(const key of Object.keys(expected.attributes)){
            assert.deepEqual(Array.from(actual.attributes[key].array,value=>value===0?0:value),Array.from(expected.attributes[key].array,value=>value===0?0:value),`${geometries[index].type} ${key}`);
            assert.equal(actual.attributes[key].itemSize,expected.attributes[key].itemSize);
            assert.equal(actual.attributes[key].normalized,expected.attributes[key].normalized);
          }
          assert.deepEqual(actual.index?Array.from(actual.index.array):null,expected.index?Array.from(expected.index.array):null);
          assert.deepEqual(actual.groups,expected.groups);
          actual.computeBoundingBox();expected.computeBoundingBox();
          assert.deepEqual(actual.boundingBox.min.toArray(),expected.boundingBox.min.toArray());
          assert.deepEqual(actual.boundingBox.max.toArray(),expected.boundingBox.max.toArray());
        }finally{expected.dispose();}
      }
      assert.deepEqual(source,snapshot);
    }finally{if(restored)release(restored);output.window.close();}
  });
  await test('repeated shapes share one exact vertex buffer while preserving names transforms and materials',async()=>{
    const repeated=documentFor([node({id:'a',name:'first'}),node({id:'b',name:'second',transform:{position:[-2,1,0],rotationQuaternion:[0,0,0,1],scale:[1,2,1]}})]);
    const phases=[];const {dom:output,data}=parse(await exportHtml(repeated,'重复构件',progress=>phases.push(progress.stage)));let scene;
    try{assert.equal(data.geometries.length,1);assert.equal(data.object.children.length,2);scene=await new THREE.ObjectLoader().parseAsync(data);assert.equal(scene.children[0].geometry,scene.children[1].geometry);assert.deepEqual(scene.children.map(mesh=>mesh.name),['first','second']);assert.deepEqual(scene.children[1].position.toArray(),[-2,1,0]);assert.deepEqual(scene.children[1].scale.toArray(),[1,2,1]);assert.equal(scene.children[0].geometry.attributes.position.count,scene.children[1].geometry.attributes.position.count);assert.ok(phases.includes('geometry')&&phases.includes('textures')&&phases.includes('serialize'));}finally{if(scene)release(scene);output.window.close();}
  });
  await test('embedded runtime resolves to a full Three namespace with its retained license, without external imports',async()=>{
    const {dom:output}=parse(html);
    try{
      const runtime=JSON.parse(output.window.document.getElementById('three-runtime').textContent);
      // Node does not load blob modules; a data module performs the same local static dependency substitution.
      const localCore='data:text/javascript;base64,'+Buffer.from(runtime.core).toString('base64');
      const localModule='data:text/javascript;base64,'+Buffer.from(runtime.module.split("'./three.core.js'").join(JSON.stringify(localCore))).toString('base64');
      const embedded=await import(localModule);
      assert.equal(typeof embedded.WebGLRenderer,'function');
      assert.equal(typeof embedded.ObjectLoader.prototype.parseAsync,'function');
      assert.equal(embedded.REVISION,THREE.REVISION);
      assert.equal(output.window.document.querySelector('details pre').textContent.includes('Permission is hereby granted'),true);
    }finally{output.window.close();}
  });
  await test('image textures finish loading and procedural detail and canvas labels remain embedded on roundtrip',async()=>{
    labelDraws=[];
    const textured=documentFor([node(),node({id:'label',name:'标牌',label:'工位 A 中文',transform:{position:[0,4,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}})]);
    textured.materials[0].maps={baseColor:{dataUrl:png,repeat:[2,3],offset:[.1,.2]}};
    textured.materials[0].surface={preset:'fabric',repeat:[2,2],strength:.3};
    const snapshot=structuredClone(textured);
    const loadsBefore=imageLoads;
    const result=await exportHtml(textured,'贴图与标签');
    const {dom:output,data}=parse(result);
    let restored;
    try{
      assert.ok(imageLoads>loadsBefore);
      assert.deepEqual(labelDraws,['工位 A 中文']);
      assert.ok(data.images.length>=4);
      for(const image of data.images)assert.ok(typeof image.url==='string'?image.url.startsWith('data:image/'):Array.isArray(image.url.data));
      restored=await new THREE.ObjectLoader().parseAsync(data);
      const material=restored.children[0].material;
      assert.equal(material.map.image.src,png);
      assert.deepEqual(material.map.repeat.toArray(),[2,3]);
      assert.deepEqual(material.map.offset.toArray(),[.1,.2]);
      assert.equal(material.normalMap.image.width,128);
      assert.equal(material.roughnessMap.image.width,128);
      assert.equal(restored.children[1].material.map.image.src,png);
      assert.equal(restored.children[1].material.transparent,true);
      assert.deepEqual(textured,snapshot);
    }finally{if(restored)release(restored);output.window.close();}
  });
  await test('export resources are disposed on both success and preparation failure',async()=>{
    const counts={geometry:0,material:0,texture:0};
    const watched=[[THREE.BufferGeometry.prototype,'geometry'],[THREE.Material.prototype,'material'],[THREE.Texture.prototype,'texture']];
    const saved=watched.map(([proto])=>proto.dispose);
    watched.forEach(([proto,key],index)=>{proto.dispose=function(){counts[key]++;return saved[index].call(this);};});
    try{
      await exportHtml(documentFor([node()]),'释放资源');
      assert.equal(counts.geometry,2);
      assert.equal(counts.material,1);
      rejectImage=true;
      const broken=documentFor([node()]);
      // A unique valid-header data URI bypasses the image cache, then the fake decoder rejects it.
      broken.materials[0].maps={baseColor:{dataUrl:png.replace('AAAAASUVORK5CYII=','AAAAASUVORK5CYIA=')}};
      await assert.rejects(exportHtml(broken,'失败释放'));
      assert.equal(counts.geometry,3);
      assert.equal(counts.material,2);
      assert.ok(counts.texture>=1);
    }finally{rejectImage=false;watched.forEach(([proto],index)=>{proto.dispose=saved[index];});}
  });
  await test('partially constructed exports release preceding meshes when an unsupported visible node rejects',async()=>{
    let geometries=0;
    let materials=0;
    const geometryDispose=THREE.BufferGeometry.prototype.dispose;
    const materialDispose=THREE.Material.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose=function(){geometries++;return geometryDispose.call(this);};
    THREE.Material.prototype.dispose=function(){materials++;return materialDispose.call(this);};
    try{
      await assert.rejects(exportHtml(documentFor([node(),node({id:'bad',kind:'asset',geometry:undefined})]),'不支持的对象'));
      assert.equal(geometries,1);
      assert.equal(materials,1);
    }finally{THREE.BufferGeometry.prototype.dispose=geometryDispose;THREE.Material.prototype.dispose=materialDispose;}
  });
  if(process.env.HTML_EXPORT_QA)await writeFile(process.env.HTML_EXPORT_QA,html,'utf8');
  console.log(`${passed} HTML export checks passed`);
} finally {
  for(const key of globals){const descriptor=original.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  dom.window.close();
  await server.close();
}
