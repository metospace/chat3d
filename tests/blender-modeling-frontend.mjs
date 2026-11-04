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
  const {blenderModelingStatus,blenderPlateCommands,blenderScriptCommands,blenderPythonStatus}=await server.ssrLoadModule('/src/scene/blenderModeling.ts');
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
  const wheel=new Mesh(new BoxGeometry(.03,.03,.03),new MeshStandardMaterial({color:0x303030}));wheel.name='Wheel';wheel.position.set(.08,.02,.02);mesh.name='Chassis';scene.add(wheel);
  const multi=await new GLTFExporter().parseAsync(scene,{binary:true});
  const scriptArgs={name:'AGV',script:'import bpy\n# AGV',position:[1,2,3]};
  let requests=0,posts=0,approved=false;
  globalThis.fetch=async(url,request)=>{
    requests++;
    if(url==='/api/blender/python/status'){assert.equal(request.headers['X-Chat3D-Python'],'1');return Response.json({available:true,token:'token'});}
    posts++;
    assert.ok(approved);assert.equal(url,'/api/blender/python');assert.equal(request.headers['X-Chat3D-Python'],'token');assert.deepEqual(JSON.parse(request.body),{script:scriptArgs.script});
    return new Response(outcome==='invalid-glb'?new ArrayBuffer(20):multi);
  };
  assert.deepEqual(await blenderPythonStatus(),{available:true,reason:undefined});requests=0;
  await assert.rejects(blenderScriptCommands(scriptArgs),/未确认/);
  await assert.rejects(blenderScriptCommands(scriptArgs,async()=>false),/未确认/);
  const stop=new AbortController();
  await assert.rejects(blenderScriptCommands(scriptArgs,async()=>{stop.abort();return true;},stop.signal),{name:'AbortError'});
  assert.equal(requests,0);assert.equal(posts,0);
  const confirm=async request=>{assert.deepEqual(request,scriptArgs);approved=true;return true;};
  outcome='ok';
  const withAgv=applyBatch(created.doc,{operations:await blenderScriptCommands(scriptArgs,confirm)});
  assert.deepEqual(withAgv.errors,[]);assert.equal(posts,1);assert.deepEqual(withAgv.doc.nodes[0],original);
  const added=withAgv.doc.nodes.slice(1);assert.deepEqual(added.map(n=>n.name),['Chassis','Wheel']);assert.equal(new Set(added.map(n=>n.assemblyId)).size,1);assert.equal(new Set(added.map(n=>n.materialId)).size,2);assert.ok(Math.abs(added[1].transform.position[0]-1.08)<1e-6);
  outcome='invalid-glb';await assert.rejects(blenderScriptCommands(scriptArgs,confirm));assert.equal(JSON.stringify(created.doc),snapshot);
  console.log('PASS Blender status, existing plate compatibility, Python confirmation/cancellation and atomic multi-mesh append');
} finally {globalThis.fetch=originalFetch;globalThis.FileReader=originalReader;await server.close();}
