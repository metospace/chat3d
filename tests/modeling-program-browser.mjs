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
const base=`const root=new THREE.Group();root.name='Curved test assembly';const rim=new THREE.Mesh(new THREE.TorusGeometry(.8,.1,12,32),new THREE.MeshPhysicalMaterial({color:'#4c78a8',metalness:.6,roughness:.3,clearcoat:.4,specularIntensity:0,specularColor:'#7b9bc2'}));rim.name='Curved rim';rim.position.set(1,2,3);root.add(rim);const shell=new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(.2,0),new THREE.Vector2(.4,.5),new THREE.Vector2(.1,1)],24),new THREE.MeshStandardMaterial({color:'#ab6633'}));shell.name='Lathed shell';root.add(shell);return root;`;
try{
  await server.listen();
  browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();const workers=new Set();
  page.on('worker',worker=>{workers.add(worker);worker.on('close',()=>workers.delete(worker));});
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__modeling_program');await page.waitForFunction(()=>window.qa);
  const run=source=>page.evaluate(source=>window.qa.run(source),source);
  const clean=async()=>{await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);assert.equal(workers.size,0);};
  const result=await run(base);assert.equal(result.nodes.length,2);assert.ok(result.nodes.every(n=>n.geometry.type==='mesh'&&n.geometry.params.normals.length&&n.geometry.params.uvs.length));assert.equal(new Set(result.nodes.map(n=>n.assemblyId)).size,1);assert.deepEqual(result.nodes[0].transform.position,[1,2,3]);assert.equal(result.materials[0].clearcoat,.4);assert.equal(result.materials[0].specularIntensity,0);assert.equal(result.materials[0].specularColor,'#7b9bc2');
  assert.deepEqual(await page.evaluate(doc=>window.qa.validate(doc).map(e=>e.message),result),[]);await clean();check('real opaque worker builds valid editable curved multi-mesh document and cleans up');
  const patched=await page.evaluate(async ({base,generated})=>{
    const {runModelingAgent}=await import('/src/ai/modelingAgent.ts');
    const {parseProject,serializeProject}=await import('/src/domain/project.ts');
    const plan={key:'curved',name:'Curved test assembly',purpose:'curved structure',detailLevel:'closeup',detailReason:'check editable curves',silhouette:'rim and shell',negativeSpaces:[],views:['front','side'],features:[{key:'body',name:'rim and shell',role:'form',geometryApproach:'mesh'}]};
    const empty={...generated,nodes:[],materials:[]};
    const source=`/*${'x'.repeat(256*1024)}*/\n${base}`;
    const replay=async(document,text,steps)=>{
      let turn=0;
      const result=await runModelingAgent({text,document,config:{baseURL:'https://fixture.invalid/v1',apiKey:'unused',model:'fixture'},selection:[],captureAvailable:()=>false,streamFn:async (model,context)=>{
        const next=steps[turn++],step=typeof next==='function'?next(context):next,reason=step?'toolUse':'stop';
        const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:step?[{type:'toolCall',id:step.name,name:step.name,arguments:step.args}]:[{type:'text',text:'Ready for visual review'}],stopReason:reason,timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
        return {result:async()=>message,async *[Symbol.asyncIterator](){yield {type:'start',partial:message};yield {type:'done',reason,message};}};
      }});
      const failed=result.activity.timings.find(t=>t.kind==='tool'&&t.failed);
      if(failed)throw Error(failed.toolName+': '+failed.detail);
      return {doc:result.result.doc,ops:result.batch.operations.map(op=>op.op),timings:result.activity.timings};
    };
    const profile=Array.from({length:850},(_,i)=>`new THREE.Vector2(${.12+.04*Math.sin(i*.01)},${i/850})`).join(',');
    const replace=`const insert=new THREE.Mesh(new THREE.LatheGeometry([${profile}],16),new THREE.MeshStandardMaterial());insert.name='Curved insert';root.add(insert);return new Promise(resolve=>setTimeout(()=>resolve(root),15500));`;
    let initialProgram,patchedProgram;
    const rebuilt=await replay(empty,'Build and finish the curved test assembly',[
      {name:'plan_object_structure',args:{objects:[plan]}},
      {name:'build_modeling_program',args:{name:plan.name,summary:'Build the curved rim and shell',blueprintKey:plan.key,source,stage:'silhouette',features:[{key:'body',partNames:['Curved rim','Lathed shell']}]}},
      context=>{
        const built=context.messages.find(m=>m.role==='toolResult'&&m.toolName==='build_modeling_program'&&!m.isError);
        initialProgram=JSON.parse(built.content[0].text).program;
        return {name:'patch_modeling_program',args:{componentId:initialProgram.componentId,expectedVersion:initialProgram.version,stage:'detailed',summary:'Add the curved insert',patches:[{find:'return root;',replace}],features:[{key:'body',partNames:['Curved rim','Lathed shell','Curved insert']}]}};
      },
      context=>{
        const patched=context.messages.find(m=>m.role==='toolResult'&&m.toolName==='patch_modeling_program'&&!m.isError);
        patchedProgram=JSON.parse(patched.content[0].text).program;
      },
    ]);
    const saved=parseProject(serializeProject(rebuilt.doc)).nodes[0].modelingProgram;
    if(patchedProgram.componentId!==rebuilt.doc.nodes[0].assemblyId)throw Error('Patch receipt points to an obsolete component');
    const timing=rebuilt.timings.find(t=>t.toolName==='patch_modeling_program');
    return {initialProgram,patchedProgram,patchedSourceMatches:saved.source===source.replace('return root;',replace),patchedBytes:new TextEncoder().encode(saved.source).byteLength,
      replaceChars:replace.length,parts:rebuilt.doc.nodes.map(n=>n.name),stage:saved.stage,ops:rebuilt.ops,elapsed:timing.endedAt-timing.startedAt};
  },{base,generated:result});
  assert.equal(patched.initialProgram.stage,'silhouette');assert.equal(patched.patchedProgram.stage,'detailed');
  assert.notEqual(patched.patchedProgram.componentId,patched.initialProgram.componentId);assert.notEqual(patched.patchedProgram.version,patched.initialProgram.version);
  assert.equal(patched.patchedSourceMatches,true);assert.ok(patched.patchedBytes>256*1024);
  assert.ok(patched.replaceChars>12000);assert.ok(patched.elapsed>=15000);
  assert.deepEqual(patched.parts,['Curved rim','Lathed shell','Curved insert']);
  assert.equal(patched.stage,'detailed');assert.deepEqual(patched.ops,['importComponentDraft','delete','importComponentDraft']);
  await clean();check('build receipt directly patches long source; rebuilt component persists after a patch runs beyond 15 seconds');
  const staged=await page.evaluate(async({base,empty})=>{
    const {runModelingAgent}=await import('/src/ai/modelingAgent.ts');
    const source='/*'+'x'.repeat(18500)+'*/\n'+base.replace("shell.name='Lathed shell';","shell.scale.x=.70;shell.name='Lathed shell';");
    const correctedSource=source.replace('shell.scale.x=.70;','shell.scale.x=1;');
    const picture='data:image/png;base64,YWJj';
    const features=[
     {key:'body',name:'主曲面',role:'form',geometryApproach:'mesh',referenceObservation:'连续旋转主体'},
     {key:'rim',name:'边缘环',role:'function',geometryApproach:'mesh',referenceObservation:'从斜视可见完整环形开口'},
     {key:'support',name:'支撑',role:'support',geometryApproach:'mesh',referenceObservation:'底部支撑连接'},
     {key:'cover',name:'盖板',role:'surface',geometryApproach:'mesh',referenceObservation:'独立的表面覆盖区'},
    ];
    const currentPlan={key:'curved-reference',name:'曲面参考件',purpose:'重建多视角图里的单体',detailLevel:'closeup',detailReason:'核对主体曲率与开口',
     silhouette:'连续主体和同向环形边缘',negativeSpaces:['环内开口'],views:['front','side'],features,
     referenceProportions:[{key:'body-height',name:'主体参考比例',numerator:{featureKey:'body',axis:'x'},denominator:{featureKey:'body',axis:'y'},expected:.8,source:'estimated',relativeTolerance:.05,view:'front',observation:'曲面主体的宽度约为总高的八成'}],
    };
    const bindings=[
     {key:'body',partNames:['Lathed shell']},{key:'rim',partNames:['Curved rim']},
     {key:'support',partNames:['Bottom support']},{key:'cover',partNames:['Top cover']},
    ];
    const build={name:currentPlan.name,summary:'构建主体和边缘',blueprintKey:currentPlan.key,source};
    const replace="root.getObjectByName('Lathed shell').scale.x*=.98;const support=new THREE.Mesh(new THREE.BoxGeometry(.2,.1,.2),new THREE.MeshStandardMaterial());support.name='Bottom support';root.add(support);const cover=new THREE.Mesh(new THREE.BoxGeometry(.15,.05,.15),new THREE.MeshStandardMaterial());cover.name='Top cover';root.add(cover);return root;";
    let latest,program,refinedSource;
    const wireStage=context=>context.messages.find(m=>m.role==='system').toolsAdded.find(tool=>tool.name==='patch_modeling_program').parameters.properties.stage;
    const localEdge={id:'local-edge',featureKey:'body',phase:'detail',view:'side',observed:'局部边缘接合略宽',expected:'局部接合向内收束',action:'细化时收束主曲面侧边'};
    const checked=(finish=false,includeChecks=true)=>({name:'review_model',args:{observations:'已查看正面和侧面的当前主体轮廓',issues:[],
     ...(!finish?{referenceDifferences:[{...localEdge,nodeIds:[latest.nodes.find(n=>n.name==='Lathed shell').id]}]}:{}),
     ...(finish&&!includeChecks?{resolvedDifferenceIds:[localEdge.id]}:{}),
     detailReviews:[{
     componentId:latest.nodes[0].assemblyId,
     checks:[
      {criterion:'silhouette',status:'pass',evidence:'已核对当前主曲面正侧轮廓',nodeIds:[latest.nodes.find(n=>n.name==='Lathed shell').id]},
      ...(finish?[{criterion:'structure',status:'pass',evidence:'已核对真实开口和支撑关系',nodeIds:latest.nodes.map(n=>n.id)}]:[]),
     ],
    }],...(finish?{completion:{
     summary:'主体和构造已核对',remainingIssues:[],
     ...(includeChecks?{referenceChecks:features.map((feature,i)=>({
      componentId:latest.nodes[0].assemblyId,featureKey:feature.key,image:(i%2)+1,
      view:i%2?'side':'front',status:'match',difference:'与对应参考角度比较，外轮缘及构件接合位置符合该特征的可见关系',
     }))}:{}),
    }}:{})}});
    const patch=()=>({name:'patch_modeling_program',args:{componentId:program.componentId,expectedVersion:program.version,stage:'detailed',summary:'补充支撑与盖板',patches:[{find:'return root;',replace}],features:bindings}});
    const findResult=(context,name)=>context.messages.filter(m=>m.role==='toolResult'&&m.toolName===name).at(-1);
    const steps=[
     ()=>[{name:'plan_object_structure',args:{objects:[currentPlan]}}],
     ()=>[{name:'build_modeling_program',args:{...build,stage:'detailed',features:bindings}}],
     context=>{
      const failure=findResult(context,'build_modeling_program');
      if(!failure.isError||!/先核对主形/.test(failure.content[0].text)||latest)throw Error('should reject detailed build before executing it');
      const rejected=context.messages.flatMap(m=>m.role==='assistant'?m.content:[]).find(c=>c.type==='toolCall'&&c.id===failure.toolCallId);
      if(!rejected||'source' in rejected.arguments)throw Error('blocked historical source should not be sent again');
      // The explicit read in the same turn makes auto-capture defer to a later action.
      return [{name:'build_modeling_program',args:{...build,stage:'silhouette',features:bindings.slice(0,2)}},{name:'read_scene',args:{}}];
     },
     context=>{
      const receipt=findResult(context,'build_modeling_program');
      program=JSON.parse(receipt.content[0].text).program;
      const read=JSON.parse(receipt.content[1].text);
      if(read.window.text!==source||read.version!==program.version)throw Error('silhouette receipt must include current repair source');
      if(wireStage(context).const!=='silhouette')throw Error('without current views only the silhouette stage should be exposed');
      return [patch()];
     },
     context=>{
      const failure=findResult(context,'patch_modeling_program');
      if(!failure.isError||!/主体比例/.test(failure.content[0].text)||latest.nodes.length!==2)throw Error('measured proportions must block early detailing');
      const rejected=context.messages.flatMap(m=>m.role==='assistant'?m.content:[]).find(c=>c.type==='toolCall'&&c.id===failure.toolCallId);
      if(!rejected||'patches' in rejected.arguments)throw Error('blocked historical patches should not be sent again');
      return [{name:'capture_quality_review',args:{overviewOnly:true,views:['front','side']}}];
     },
     context=>{
      if(wireStage(context).const!=='silhouette')throw Error('detailing should stay hidden even with the views delivered when proportions are wrong');
      return [checked(),patch()];
     },
     context=>{
      if(!findResult(context,'patch_modeling_program').isError||latest.nodes.length!==2)throw Error('a subjective silhouette pass cannot override a measured mismatch');
      const original=patch();
      return [{...original,args:{...original.args,stage:'silhouette',summary:'修正主体宽高比例',patches:[{find:'shell.scale.x=.70;',replace:'shell.scale.x=1;'}],features:bindings.slice(0,2)}}];
     },
     context=>{
      const fixed=findResult(context,'patch_modeling_program');
      if(fixed.isError)throw Error(fixed.content[0].text);
      program=JSON.parse(fixed.content[0].text).program;
      return [checked(),patch()];
     },
     context=>{
      const receipt=findResult(context,'patch_modeling_program');
      if(receipt.isError)throw Error(receipt.content[0].text);
      refinedSource=JSON.parse(receipt.content[1].text);
      if(refinedSource.window.text!==correctedSource.replace('return root;',replace)||refinedSource.componentId===program.componentId||refinedSource.version===program.version)throw Error('patched source identity is not current');
      if(receipt.content.filter(part=>part.type==='image').length!==2)throw Error('successful patch should deliver its current two views without a separate capture round');
      return [checked(true,false)];
     },
     context=>{
      const gate=findResult(context,'review_model');
      if(!gate.isError||!gate.content.some(part=>part.type==='text'&&part.text.includes('关键特征还未通过参考图对照')))throw Error('an overview cannot pass the feature comparison');
      return [checked(true)];
     },
     context=>{
      const blocked=findResult(context,'review_model');
      if(!blocked.isError||!blocked.content.some(part=>part.type==='text'&&part.text.includes('高光遮住开口')))throw Error('independent visual objection must block submission with a repair instruction');
      return [checked(true)];
     },
     context=>{
      if(!findResult(context,'review_model').isError||detailedAttempts!==1)throw Error('the same pixels cannot pass by repeating the verdict');
      const targetId=latest.nodes.find(node=>node.name==='Top cover').id;
      return [
       {name:'edit_scene',args:{summary:'降低盖板高光',operations:[{op:'setAppearance',targetId,specularIntensity:0.2}]}},
       {name:'capture_quality_review',args:{overviewOnly:true,views:['front','side']}},
      ];
     },
     ()=>[checked(true)],
    ];
    let turn=0,detailedAttempts=0,shapeComparisons=0;
    const agentOptions={
     text:'根据正侧两张图构建曲面参考件',document:empty,images:[picture,'data:image/png;base64,Zm9v'],selection:[],
     config:{baseURL:'https://fixture.invalid/v1',apiKey:'unused',model:'fixture'},capture:async()=>picture,onPreview:doc=>{latest=doc;},
     streamFn:async(model,context)=>{
      const system=context.messages.find(message=>message.role==='system');
      if(system?.content.includes('独立审核参考图还原度')){
       const input=context.messages.find(message=>message.role==='user');
       if(context.messages.length!==2||input.content.filter(part=>part.type==='image').length!==4||system.toolsAdded?.length)throw Error('visual reviewer must receive both real image sets without builder verdicts or modeling tools');
       const phase=JSON.parse(input.content[0].text).phase;
       if(phase==='silhouette'){shapeComparisons++;if(!system.content.includes('忽略尚未制作')||JSON.parse(input.content[0].text).features.some(row=>['rim','support','cover'].includes(row.key)))throw Error('silhouette reviewer must ignore unbuilt trim and materials');}
       if(phase==='silhouette')throw Error('fixture: unavailable silhouette reviewer');
       const first=++detailedAttempts===1;
       const rows=[{key:''},...features].map(feature=>({key:feature.key,reference:1,frame:1,status:first&&feature.key==='cover'?'mismatch':'match',difference:'可见边缘与参考图的相对位置相符',repair:''}));
       if(first)Object.assign(rows.at(-1),{difference:'盖板高光遮住开口',repair:'降低实际盖板材质高光强度'});
       const text=[2,3].includes(detailedAttempts)?'[]':JSON.stringify(rows);
       const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[{type:'text',text}],stopReason:'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
       return {result:async()=>message};
      }
      const actions=steps[turn++]?.(context);
      if(!actions)throw Error('unexpected round '+turn);
      const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,
       content:actions.map(({name,args},i)=>({type:'toolCall',id:`stage-${turn}-${i}`,name,arguments:args})),stopReason:'toolUse',timestamp:Date.now(),
       usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
      };
      return {result:async()=>message,async *[Symbol.asyncIterator](){yield {type:'start',partial:message};yield {type:'done',reason:'toolUse',message};}};
     },
    };
    const result=await runModelingAgent(agentOptions);
    if(result.activity.outcome!=='partial'||!result.batch.summary.includes('已保留细化结果')||!result.result.doc.nodes.some(node=>node.modelingProgram?.stage==='detailed'))throw Error('unavailable final review must preserve the detailed draft without marking it as verified: '+result.batch.summary);
    steps.push(()=>[{name:'capture_quality_review',args:{overviewOnly:true,views:['front','side']}}],()=>[checked(true)]);
    const resumed=await runModelingAgent({...agentOptions,text:'按原图重新复核已经细化的草稿',document:result.result.doc,qualityBaseline:empty});
    return {outcome:resumed.activity.outcome,nodes:resumed.result.doc.nodes.length,resumedEdits:resumed.batch.operations.length,reads:result.activity.timings.filter(t=>t.toolName==='read_modeling_program').length,turn,detailedAttempts,shapeComparisons,failedFinalChecks:result.activity.timings.filter(t=>t.label==='独立参考图对照'&&t.failed).length};
  },{base,empty:{...result,nodes:[],materials:[]}});
  assert.deepEqual(staged,{outcome:'preview-ready',nodes:4,resumedEdits:0,reads:0,turn:15,detailedAttempts:4,shapeComparisons:1,failedFinalChecks:2});
  await clean();check('independent review outage preserves detailing and a later review can finish without rewriting geometry');
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
