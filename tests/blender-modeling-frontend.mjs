import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {BoxGeometry,Mesh,MeshStandardMaterial,Scene} from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

const server=await createServer({configFile:false,server:{middlewareMode:true,ws:false},appType:'custom'});
const originalFetch=globalThis.fetch;
const originalReader=globalThis.FileReader;
try {
  globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(bytes=>{this.result=bytes;this.onloadend?.();});}};
  const scene=new Scene(),mesh=new Mesh(new BoxGeometry(.12,.008,.08),new MeshStandardMaterial());
  scene.add(mesh);mesh.position.y=.004;
  const bytes=await new GLTFExporter().parseAsync(scene,{binary:true});
  const {blenderModelingStatus,blenderPlateCommands,runBlenderScript,blenderPythonStatus}=await server.ssrLoadModule('/src/scene/blenderModeling.ts');
  const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
  const draft={schemaVersion:1,projectId:'blender-regression',revision:0,unit:'m',upAxis:'Y',nodes:[],materials:[],assets:[]};
  let outcome='ok';
  globalThis.fetch=async(url,request)=>{
    if(url==='/api/blender/build/status')return Response.json({modelingAvailable:true});
    assert.equal(url,'/api/blender/build');assert.equal(request.headers['X-Chat3D-Build'],'1');
    assert.deepEqual(JSON.parse(request.body),{type:'mounting_plate',width:120,depth:80,thickness:8,holeDiameter:6,holeInset:12,bevel:1});
    if(outcome==='server-error')return Response.json({error:'build unavailable'},{status:503});
    return new Response(outcome==='invalid-glb'?new ArrayBuffer(20):bytes);
  };
  assert.equal((await blenderModelingStatus()).available,true);
  const args={name:'板',width:120,depth:80,thickness:8,holeDiameter:6,holeInset:12,bevel:1};
  const created=applyBatch(draft,{operations:await blenderPlateCommands(draft,{...args,position:[1,2,3]})});
  assert.deepEqual(created.errors,[]);const original=created.doc.nodes[0];
  assert.deepEqual(original.transform.position,[1,2,3]);
  assert.ok(Math.abs(Math.min(...original.geometry.params.positions.filter((_,i)=>i%3===1)))<1e-6);
  const replaced=applyBatch(created.doc,{operations:await blenderPlateCommands(created.doc,{...args,targetId:original.id})});
  assert.deepEqual(replaced.errors,[]);assert.deepEqual(replaced.doc.nodes[0],original);
  const {serializeProject,parseProject}=await server.ssrLoadModule('/src/domain/project.ts');
  assert.equal(parseProject(serializeProject(created.doc)).nodes[0].blenderSource,'mounting_plate');
  const other={...created.doc,nodes:[{...original,blenderSource:undefined}]};
  await assert.rejects(blenderPlateCommands(other,{...args,targetId:original.id}),/Blender 实验安装板/);
  const snapshot=JSON.stringify(created.doc);
  for(const failure of ['server-error','invalid-glb']){
    outcome=failure;await assert.rejects(blenderPlateCommands(created.doc,{...args,targetId:original.id}));
    assert.equal(JSON.stringify(created.doc),snapshot);
  }
  const scriptArgs={name:'AGV',script:'import bpy\n# AGV'};
  const payloads={blend:new Uint8Array([1,2,3]),glb:new Uint8Array(bytes),render:new Uint8Array([4,5,6])};
  let requests=0,posts=0,approved=false;
  globalThis.fetch=async(url,request)=>{
    requests++;
    if(url==='/api/blender/python/status'){assert.equal(request.headers['X-Chat3D-Python'],'1');return Response.json({available:true,token:'token'});}
    posts++;
    assert.ok(approved);assert.equal(url,'/api/blender/python');assert.equal(request.headers['X-Chat3D-Python'],'token');assert.deepEqual(JSON.parse(request.body),{script:scriptArgs.script});
    const form=new FormData();
    for(const [key,mime] of [['blend','application/octet-stream'],['glb','model/gltf-binary'],['render','image/png']]){
      if(outcome!=='missing-render'||key!=='render')form.append(key,new Blob([payloads[key]],{type:mime}),key);
    }
    return new Response(form);
  };
  assert.deepEqual(await blenderPythonStatus(),{available:true,reason:undefined});requests=0;
  await assert.rejects(runBlenderScript(scriptArgs),/未确认/);
  await assert.rejects(runBlenderScript(scriptArgs,async()=>false),/未确认/);
  const stop=new AbortController();
  await assert.rejects(runBlenderScript(scriptArgs,async()=>{stop.abort();return true;},stop.signal),{name:'AbortError'});
  assert.equal(requests,0);assert.equal(posts,0);
  const confirm=async request=>{assert.deepEqual(request,scriptArgs);approved=true;return true;};
  outcome='ok';
  const result=await runBlenderScript(scriptArgs,confirm);
  assert.equal(posts,1);
  for(const [key,expected] of Object.entries(payloads))assert.deepEqual(new Uint8Array(await result[key].arrayBuffer()),expected);
  outcome='missing-render';await assert.rejects(runBlenderScript(scriptArgs,confirm),/未返回完整/);
  console.log('PASS plate compatibility, Python authorization/cancellation and unchanged Blender artifacts');
} finally {globalThis.fetch=originalFetch;globalThis.FileReader=originalReader;await server.close();}
