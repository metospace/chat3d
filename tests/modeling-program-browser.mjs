import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';

const fixture=`<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script type="module">
import {runModelingProgram} from '/src/scene/modelingProgram.ts';
import {validateDocument} from '/src/domain/types.ts';
window.privateModelingSecret='not-visible-to-programs';
window.qa={run:runModelingProgram,validate:validateDocument};
</script>`;
const cacheDir=await mkdtemp(join(tmpdir(),'scenivo-modeling-'));
const forbiddenRequests=[];
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'modeling-program-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.includes('/private-modeling-probe')){forbiddenRequests.push(req.url);res.setHeader('Content-Type','text/javascript');res.end('export const leaked=true;');return;}if(req.url?.split('?')[0]!=='/__modeling_program')return next();res.setHeader('Content-Type','text/html');res.end(fixture);});}}]});
let browser,passed=0;
const check=name=>{passed++;console.log('PASS',name);};
const executablePath=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(path=>path&&existsSync(path));
assert.ok(executablePath,'Set CHAT3D_BROWSER_PATH');
const base=`const root=new THREE.Group();root.name='Curved test assembly';const rim=new THREE.Mesh(new THREE.TorusGeometry(.8,.1,12,32),new THREE.MeshPhysicalMaterial({color:'#4c78a8',metalness:.6,roughness:.3,clearcoat:.4}));rim.name='Curved rim';rim.position.set(1,2,3);root.add(rim);const shell=new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(.2,0),new THREE.Vector2(.4,.5),new THREE.Vector2(.1,1)],24),new THREE.MeshStandardMaterial({color:'#ab6633'}));shell.name='Lathed shell';root.add(shell);return root;`;
try{
  await server.listen();
  browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();const workers=new Set();
  page.on('worker',worker=>{workers.add(worker);worker.on('close',()=>workers.delete(worker));});
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__modeling_program');await page.waitForFunction(()=>window.qa);
  const run=source=>page.evaluate(source=>window.qa.run(source),source);
  const clean=async()=>{await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);assert.equal(workers.size,0);};
  const result=await run(base);assert.equal(result.nodes.length,2);assert.ok(result.nodes.every(n=>n.geometry.type==='mesh'&&n.geometry.params.normals.length&&n.geometry.params.uvs.length));assert.equal(new Set(result.nodes.map(n=>n.assemblyId)).size,1);assert.deepEqual(result.nodes[0].transform.position,[1,2,3]);assert.equal(result.materials[0].clearcoat,.4);
  assert.deepEqual(await page.evaluate(doc=>window.qa.validate(doc).map(e=>e.message),result),[]);await clean();check('real opaque worker builds valid editable curved multi-mesh document and cleans up');
  const patched=await page.evaluate(async ({base,generated})=>{
    const {runModelingAgent}=await import('/src/ai/modelingAgent.ts');
    const {readSource}=await import('/src/ai/modelingProgramSource.ts');
    const {applyBatch}=await import('/src/domain/commands.ts');
    const {parseProject,serializeProject}=await import('/src/domain/project.ts');
    const plan={key:'curved',name:'Curved test assembly',purpose:'curved structure',detailLevel:'closeup',detailReason:'check editable curves',silhouette:'rim and shell',negativeSpaces:[],views:['front','side'],features:[{key:'body',name:'rim and shell',role:'form',geometryApproach:'mesh'}]};
    const empty={...generated,nodes:[],materials:[]};
    const source=`/*${'x'.repeat(256*1024)}*/\n${base}`;
    const replay=async(document,text,steps)=>{
      let turn=0;
      const result=await runModelingAgent({text,document,config:{baseURL:'https://fixture.invalid/v1',apiKey:'unused',model:'fixture'},selection:[],captureAvailable:()=>false,streamFn:async model=>{
        const step=steps[turn++],reason=step?'toolUse':'stop';
        const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:step?[{type:'toolCall',id:step.name,name:step.name,arguments:step.args}]:[{type:'text',text:'Ready for visual review'}],stopReason:reason,timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
        return {result:async()=>message,async *[Symbol.asyncIterator](){yield {type:'start',partial:message};yield {type:'done',reason,message};}};
      }});
      const failed=result.activity.timings.find(t=>t.kind==='tool'&&t.failed);
      if(failed)throw Error(failed.toolName+': '+failed.detail);
      const committed=applyBatch(document,result.batch);
      if(committed.errors.length)throw committed.errors[0];
      return {doc:committed.doc,ops:result.batch.operations.map(op=>op.op),timings:result.activity.timings};
    };
    const built=await replay(empty,'Build the curved test assembly',[
      {name:'plan_object_structure',args:{objects:[plan]}},
      {name:'build_modeling_program',args:{name:plan.name,summary:'Build the curved rim and shell',blueprintKey:plan.key,source,stage:'silhouette',features:[{key:'body',partNames:['Curved rim','Lathed shell']}]}},
    ]);
    const initialNode=built.doc.nodes[0];
    const initialSource=parseProject(serializeProject(built.doc)).nodes[0].modelingProgram.source;
    const profile=Array.from({length:850},(_,i)=>`new THREE.Vector2(${.12+.04*Math.sin(i*.01)},${i/850})`).join(',');
    const replace=`const insert=new THREE.Mesh(new THREE.LatheGeometry([${profile}],16),new THREE.MeshStandardMaterial());insert.name='Curved insert';root.add(insert);return new Promise(resolve=>setTimeout(()=>resolve(root),15500));`;
    const args={componentId:initialNode.assemblyId,expectedVersion:readSource(initialSource).version,stage:'detailed',summary:'Add the curved insert',patches:[{find:'return root;',replace}],features:[{key:'body',partNames:['Curved rim','Lathed shell','Curved insert']}]};
    const rebuilt=await replay(built.doc,'Complete the insert in this draft',[{name:'patch_modeling_program',args}]);
    const saved=parseProject(serializeProject(rebuilt.doc)).nodes[0].modelingProgram;
    const timing=rebuilt.timings.find(t=>t.toolName==='patch_modeling_program');
    return {initialSourceMatches:initialSource===source,initialBytes:new TextEncoder().encode(initialSource).byteLength,initialOps:built.ops,
      patchedSourceMatches:saved.source===source.replace('return root;',replace),patchedBytes:new TextEncoder().encode(saved.source).byteLength,
      replaceChars:replace.length,parts:rebuilt.doc.nodes.map(n=>n.name),stage:saved.stage,ops:rebuilt.ops,elapsed:timing.endedAt-timing.startedAt};
  },{base,generated:result});
  assert.equal(patched.initialSourceMatches,true);assert.deepEqual(patched.initialOps,['importComponentDraft']);
  assert.equal(patched.patchedSourceMatches,true);assert.ok(patched.initialBytes>256*1024&&patched.patchedBytes>256*1024);
  assert.ok(patched.replaceChars>12000);assert.ok(patched.elapsed>=15000);
  assert.deepEqual(patched.parts,['Curved rim','Lathed shell','Curved insert']);
  assert.equal(patched.stage,'detailed');assert.deepEqual(patched.ops,['delete','importComponentDraft']);
  await clean();check('agent builds and commits long source; a large patch runs beyond 15 seconds and commits the rebuilt component');
  await assert.rejects(run('throw new Error("expected failure");'),/expected failure/);await clean();check('thrown model errors reject without returning partial document');
  const reversed='const material = new THREE.MeshStandardMaterial();\nconst shape = new THREE.BoxGeometry();\nconst add = (g, m) => new THREE.Mesh(g, m);\nreturn add(material, shape);';
  await assert.rejects(run(reversed), error=>/第 4 行/.test(error.message)&&/Mesh\(geometry, material\)/.test(error.message));await clean();
  const corrected=await run(reversed.replace('add(material, shape)','add(shape, material)'));assert.equal(corrected.nodes[0].geometry.type,'mesh');await clean();
  check('reversed geometry and material report the generated call site and the corrected script builds');
  await assert.rejects(run('return new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),2);'),/实例/);await clean();
  await assert.rejects(run('const m=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());m.material.map=new THREE.Texture();return m;'),/贴图/);await clean();check('unsupported geometry/material content rejects in real worker');
  const isolated=await run(`if(typeof window!=='undefined'||typeof document!=='undefined'||typeof parent!=='undefined'||typeof localStorage!=='undefined'||typeof globalThis.__TAURI_INTERNALS__!=='undefined'||typeof privateModelingSecret!=='undefined')throw Error('page API leaked');if(location.origin!=='null')throw Error('worker origin was not opaque: '+location.origin);for(const name of ['fetch','XMLHttpRequest','WebSocket','Worker','importScripts','indexedDB','caches']){let blocked=false;try{globalThis[name]('/private-modeling-probe');}catch{blocked=true;}if(!blocked)throw Error(name+' was not blocked');}${base}`);assert.equal(isolated.nodes.length,2);await clean();check('worker has opaque origin and cannot access page, app, storage or network APIs');
  const origin=new URL(page.url()).origin;
  await assert.rejects(run(`return import(${JSON.stringify(origin+'/private-modeling-probe')});`));await clean();assert.deepEqual(forbiddenRequests,[]);check('inherited connect/script CSP prevents dynamic external module network access');
  const aborted=await page.evaluate(async()=>{const controller=new AbortController();const task=window.qa.run('while(true){}',controller.signal);await new Promise(resolve=>setTimeout(resolve,500));const frame=document.querySelector('iframe');const sandbox=frame?.getAttribute('sandbox');controller.abort();try{await task;return {unexpected:true};}catch(error){return {name:error.name,sandbox};}});
  assert.equal(aborted.name,'AbortError');assert.equal(aborted.sandbox,'allow-scripts');await clean();check('abort terminates infinite worker and removes opaque frame');
  const preAbort=await page.evaluate(async()=>{const controller=new AbortController();controller.abort();try{await window.qa.run('return null',controller.signal);}catch(error){return {name:error.name,frames:document.querySelectorAll('iframe').length};}});assert.deepEqual(preAbort,{name:'AbortError',frames:0});check('already-aborted runs allocate no sandbox');
  const validAfter=await run(base);assert.equal(validAfter.nodes.length,2);await clean();check('failure and abort leave subsequent modeling runs functional');
  // Optional acceptance against the user's actual builder, never copied into product code.
  if(process.env.MODELING_PROGRAM_SOURCE){
    const original=await readFile(process.env.MODELING_PROGRAM_SOURCE,'utf8');
    const start=original.indexOf('const robot=new T.Group()'),end=original.indexOf('robot.updateMatrixWorld(true);');
    assert.ok(start>=0&&end>start,'original builder boundaries');
    const doc=await run('const T=THREE;\n'+original.slice(start,end)+'\nreturn robot;');
    assert.equal(doc.nodes.length,641);assert.deepEqual(await page.evaluate(doc=>window.qa.validate(doc).map(e=>e.message),doc),[]);await clean();check('actual supplied Codex robot builder converts all 641 editable meshes without GLB');
  }
  console.log(`${passed} modeling program browser checks passed`);
}finally{await browser?.close();await server.close();await rm(cacheDir,{recursive:true,force:true});}
