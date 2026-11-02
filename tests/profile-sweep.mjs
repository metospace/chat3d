import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)};
try{
 const {validateGeometry}=await server.ssrLoadModule('/src/domain/types.ts');
 const {buildPrimitiveGeometry}=await server.ssrLoadModule('/src/scene/geometry.ts');
 const {parseModelResponse,buildSceneContext}=await server.ssrLoadModule('/src/ai/provider.ts');
 const {applyBatch,cloneGeometry}=await server.ssrLoadModule('/src/domain/commands.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {serializeProject,parseProject}=await server.ssrLoadModule('/src/domain/project.ts');
 const {exportGlb}=await server.ssrLoadModule('/src/scene/export.ts');
 const {importGlb}=await server.ssrLoadModule('/src/scene/importGlb.ts');
 const profile=[[-.1,0],[.1,0],[.1,.1],[-.1,.1]];
 const geometry=(path,closed=false,p=profile)=>({type:'profileSweep',params:{profile:p,path,closed}});
 const volume=geo=>{const p=geo.attributes.position,i=geo.index.array;let v=0;for(let k=0;k<i.length;k+=3){const a=i[k],b=i[k+1],c=i[k+2];v+=(p.getX(a)*(p.getY(b)*p.getZ(c)-p.getZ(b)*p.getY(c))+p.getY(a)*(p.getZ(b)*p.getX(c)-p.getX(b)*p.getZ(c))+p.getZ(a)*(p.getX(b)*p.getY(c)-p.getY(b)*p.getX(c)))/6;}return v;};
 const manifold=geo=>{const edges=new Map(),p=geo.attributes.position,i=geo.index.array;const key=n=>[p.getX(n),p.getY(n),p.getZ(n)].map(x=>Math.round(x*1e5)).join(',');for(let k=0;k<i.length;k+=3)for(let j=0;j<3;j++){const a=key(i[k+j]),b=key(i[k+(j+1)%3]);const e=[a,b].sort().join('|');edges.set(e,(edges.get(e)??0)+1);}assert.ok([...edges.values()].every(n=>n===2),'solid must be watertight after welding positions');};
 await test('straight, mitered and closed sweeps retain dimensions, outward normals, metric UVs and watertight caps',()=>{
  for(const [path,closed,expected] of [[[[0,0],[2,0]],false,.04],[[[0,0],[1,0],[1,1]],false,.04],[[[0,0],[2,0],[2,2],[0,2]],true,.16]])for(const reverse of [false,true]){
   const g=geometry(reverse?[...path].reverse():path,closed);assert.deepEqual(validateGeometry(g),[]);const geo=buildPrimitiveGeometry(g);assert.ok(Math.abs(volume(geo)-expected)<1e-6);manifold(geo);assert.ok(geo.attributes.uv.count===geo.attributes.position.count);assert.ok([...geo.attributes.normal.array].every(Number.isFinite));geo.dispose();
  }
 });
 await test('concave section forms real negative space and reversing section winding preserves the solid',()=>{
  const section=[[0,0],[.2,0],[.2,.05],[.05,.05],[.05,.3],[0,.3]];
  for(const p of [section,[...section].reverse()]){const geo=buildPrimitiveGeometry(geometry([[0,0],[2,0]],false,p));assert.ok(Math.abs(volume(geo)-.045)<1e-6);manifold(geo);geo.dispose();}
 });
 await test('closed paths orient positive asymmetric offsets outward for both windings',()=>{
  const p=[[0,0],[.1,0],[.1,.1],[0,.1]],path=[[0,0],[2,0],[2,2],[0,2]];
  for(const line of [path,[...path].reverse()]){const geo=buildPrimitiveGeometry(geometry(line,true,p));geo.computeBoundingBox();assert.ok(Math.abs(geo.boundingBox.min.x+.1)<1e-6);assert.ok(Math.abs(geo.boundingBox.max.x-2.1)<1e-6);assert.ok(Math.abs(volume(geo)-.084)<1e-6);geo.dispose();}
 });
 await test('unbounded inputs, crossing paths, overlapping widths, foldbacks and acute miter spikes are rejected',()=>{
  for(const key of ['holes','y','radius'])assert.ok(validateGeometry({type:'profileSweep',params:{...geometry([[0,0],[1,0]]).params,[key]:[]}}).length);
  for(const g of [geometry([[0,0],[0,0]]),geometry([[0,0],[1,1],[0,1],[1,0]]),geometry([[0,0],[1,0],[0,0]]),geometry([[0,0],[.1,0],[.1,.1]],false,[[-.2,0],[.2,0],[.2,.1],[-.2,.1]]),geometry([[0,0],[1,0],[.01,.01]]),geometry([[0,0],[2,0],[2,.1],[0,.1]],true),geometry([[0,0],[Infinity,0]]),geometry(Array.from({length:65},(_,i)=>[i,0]))])assert.ok(validateGeometry(g).length,JSON.stringify(g));
 });
 let doc;
 await test('existing command pipeline accepts, clones, bounds, persists and modifies sweeps without mutating the source',()=>{
  const g=geometry([[0,0],[1,0],[1,1]]),copy=cloneGeometry(g);copy.params.path[0][0]=.3;assert.equal(g.params.path[0][0],0);
  const batch=parseModelResponse(JSON.stringify({summary:'连续型材',operations:[{op:'createAssembly',name:'扫掠验证',parts:[{name:'折角导轨',geometry:g,materialId:'mat_gray'}]}]}));
  const base=createInitialDoc(),r=applyBatch(base,batch);assert.equal(r.errors.length,0);assert.equal(base.nodes.length,0);doc=parseProject(serializeProject(r.doc));assert.equal(doc.nodes[0].geometry.type,'profileSweep');assert.ok(buildSceneContext(doc,[]).nodes[0].desc.includes('profileSweep'));
  const changed=applyBatch(doc,{operations:[{op:'updateParameters',targetId:doc.nodes[0].id,geometry:geometry([[0,0],[3,0]])}]});assert.equal(changed.errors.length,0);assert.equal(doc.nodes[0].geometry.params.path[1][0],1);
 });
 await test('actual GLB roundtrip exports sweep geometry with stable dimensions',async()=>{
  globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()})}};
  const out=await importGlb(await exportGlb(doc),'sweep.glb');assert.equal(out.doc.nodes.length,1);const geo=buildPrimitiveGeometry(out.doc.nodes[0].geometry);manifold(geo);assert.ok(volume(geo)>0);geo.dispose();
 });
 await test('native modeling agent uses the added geometry through its existing edit and preview tools',async()=>{
  const {runModelingAgent}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');let calls=0;
  const steps=[{name:'edit_scene',arguments:{summary:'连续导轨数据草稿',operations:[{op:'createAssembly',name:'折角导轨',parts:[{name:'型材',geometry:geometry([[0,0],[1,0],[1,1]]),materialId:'mat_gray'}]}]}},{name:'submit_data_preview',arguments:{summary:'已生成数据草稿，未经视觉验收'}}];
  const streamFn=async()=>{const step=steps[calls++];const message={role:'assistant',content:step?[{type:'toolCall',id:'offline-'+calls,...step}]:[{type:'text',text:'停止，保留草稿'}],api:'openai-completions',provider:'offline',model:'offline',stopReason:step?'toolUse':'stop',timestamp:Date.now(),usage:{input:20,output:10,cacheRead:0,cacheWrite:0,totalTokens:30,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});});return stream;};
  const base=createInitialDoc();const result=await runModelingAgent({text:'生成一根折角导轨',document:base,selection:[],workerTask:true,config:{baseURL:'https://offline.invalid/v1',apiKey:'offline-only',model:'offline',generationQuality:'fast'},streamFn});
  assert.equal(result.result.doc.nodes[0].geometry.type,'profileSweep');assert.equal(base.nodes.length,0);assert.equal(calls,2);assert.equal(result.batch.taskStatus,'partial');assert.equal(result.batch.incomplete,true);
 });
 console.log(`${passed} profile sweep checks passed; no model calls`);
}finally{await server.close()}
