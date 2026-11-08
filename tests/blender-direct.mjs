import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom'});
const original=globalThis.fetch;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJxkAAAAASUVORK5CYII=','base64');
const script='import bpy\nwidth = 1\ncolor = "red"\nbpy.ops.mesh.primitive_cube_add(size=width)\n';
const call=(name,args,id=name)=>({type:'toolCall',id,name,arguments:args});
const receipts=context=>context.messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content.filter(c=>c.type==='text').flatMap(c=>{try{return [JSON.parse(c.text)];}catch{return [];}}));
const latest=context=>receipts(context).findLast(value=>value.status==='pending');
function response(content,reason=content.some(c=>c.type==='toolCall')?'toolUse':'stop'){
 const message={role:'assistant',content,api:'openai-completions',provider:'fixture',model:'fixture',stopReason:reason,timestamp:Date.now(),usage:{input:10,output:10,cacheRead:0,cacheWrite:0,totalTokens:20,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
 const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});for(const [contentIndex,block] of content.entries()){if(block.type==='toolCall'){stream.push({type:'toolcall_start',contentIndex,partial:message});stream.push({type:'toolcall_delta',contentIndex,delta:JSON.stringify(block.arguments),partial:message});}else if(block.type==='text'){stream.push({type:'text_delta',contentIndex,delta:block.text,partial:message});}}stream.push({type:'done',reason,message});});return stream;
}
try{
 const {runBlenderAgent}=await server.ssrLoadModule('/src/ai/blenderAgent.ts');
 const {readSource}=await server.ssrLoadModule('/src/ai/modelingProgramSource.ts');
 const config={baseURL:'https://fixture.invalid/v1',apiKey:'unused',model:'fixture',agentMode:'pi',stream:true};
 async function scenario(steps,extras={}){
  const posted=[],results=[],events=[],activities=[];let turn=0,control;
  globalThis.fetch=async(url,init)=>{
   if(String(url).endsWith('/status'))return Response.json({available:true,token:'fixture'});
   const {script:source}=JSON.parse(init.body);posted.push(source);
   if(source.includes('deliberate_failure'))return Response.json({error:'deliberate failure'},{status:422});
   const form=new FormData();form.append('blend',new Blob(['native '+source],{type:'application/octet-stream'}),'result.blend');form.append('glb',new Blob(['mesh '+source],{type:'model/gltf-binary'}),'result.glb');form.append('render',new Blob([png],{type:'image/png'}),'render.png');return new Response(form);
  };
  const promise=runBlenderAgent({text:'创建立方体并核对比例',config,images:[],history:[],signal:new AbortController().signal,confirm:async()=>true,onActivity:a=>activities.push(a),onResult:r=>results.push(r),onDiagnostic:(kind,data)=>events.push({kind,data}),onControl:c=>{control=c;},onSteeringApplied:()=>{},...extras,streamFn:async(_m,context)=>{
   assert.ok(turn<steps.length,'Unexpected extra model request');return response(await steps[turn++](context,{posted,results,events,get control(){return control;}}));
  }});
  return {summary:await promise,posted,results,events,activities};
 }
 const built=await scenario([
  ()=>[call('run_blender_python',{name:'立方体',script})],
  context=>{const image=context.messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content).find(c=>c.type==='image');assert.deepEqual(Buffer.from(image.data,'base64'),png);return [call('review_blender_result',{expectedVersion:latest(context).version,observations:'正面宽高相同，轮廓完整；背面未检查。',issues:['宽度应调整为 2']})];},
  context=>[call('patch_blender_script',{expectedVersion:latest(context).version,patches:[{find:'width = 1',replace:'width = 2'}]})],
  context=>{const images=context.messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content).filter(c=>c.type==='image');assert.equal(images.length,1,'Only latest generated image belongs in active model context');return [call('review_blender_result',{expectedVersion:latest(context).version,observations:'新图主体加宽，保留原有红色；未检查工程净空。',issues:[]})];},
 ]);
 assert.deepEqual(built.posted,[script,script.replace('width = 1','width = 2')]);
 assert.equal(built.results.at(-1).review.status,'reviewed');assert.equal(built.results[0].review.status,'pending');assert.equal(built.results[1].review.status,'issues');
 assert.equal(await built.results[0].blend.text(),'native '+script);assert.deepEqual(Buffer.from(await built.results.at(-1).render.arrayBuffer()),png);
 const receiving=built.activities.find(a=>a.blenderProgress?.stage==='receiving'&&a.blenderProgress.script===script);
 assert.ok(receiving);assert.equal(receiving.blenderProgress.receivedChars,script.length);assert.equal(receiving.toolCalls,0);
 const executing=built.activities.find(a=>a.blenderProgress?.stage==='starting'&&a.blenderProgress.script===script);
 assert.ok(executing);assert.ok(executing.toolCalls>0);
 assert.ok(built.activities.some(a=>a.blenderProgress?.stage==='completed'));
 console.log('PASS visible script stream precedes execution and received counts reflect actual code');
 console.log('PASS actual render feedback, explicit issue repair, unchanged source preservation and fresh review');
 const previous=built.results.at(-1),version=previous.review.version;
 const rejected=await scenario([
  ()=>[call('patch_blender_script',{expectedVersion:'stale',patches:[{find:'width = 2',replace:'width = 3'}]})],
  context=>{assert.match(context.messages.at(-1).content[0].text,/Stale/);return [call('patch_blender_script',{expectedVersion:version,patches:[{find:'bpy',replace:'other'}]})];},
  context=>{assert.match(context.messages.at(-1).content[0].text,/ambiguous/);return [call('patch_blender_script',{expectedVersion:version,patches:[{find:'width = 2',replace:'width = 3'}]})];},
  context=>[call('review_blender_result',{expectedVersion:latest(context).version,observations:'主体比例与本次修改一致。',issues:[]})],
 ],{previous});
 assert.deepEqual(rejected.posted,[previous.script.replace('width = 2','width = 3')]);assert.equal(previous.script.includes('width = 2'),true);
 console.log('PASS stale and ambiguous patches never execute or overwrite previous candidate');
 const sameTurn=await scenario([
  ()=>[call('run_blender_python',{name:'立方体',script}),call('review_blender_result',{expectedVersion:readSource(script).version,observations:'未看到图却宣称通过',issues:[]})],
  context=>{assert.equal(context.messages.at(-1).isError,true);return [call('review_blender_result',{expectedVersion:latest(context).version,observations:'现在已收到实际图片，正面轮廓完整。',issues:[]})];},
 ]);
 assert.equal(sameTurn.results.filter(r=>r.review.status==='reviewed').length,1);
 console.log('PASS generation cannot be reviewed before image reaches a later model turn');
 const retained=await scenario([
  ()=>[call('run_blender_python',{name:'立方体',script})],
  context=>[call('patch_blender_script',{expectedVersion:latest(context).version,patches:[{find:'width = 1',replace:'deliberate_failure = 1'}]})],
  context=>{assert.match(context.messages.at(-1).content[0].text,/deliberate failure/);return [{type:'text',text:'后续执行失败，保留原候选。'}];},
 ]);
 assert.equal(retained.results.at(-1).script,script);assert.equal(retained.results.at(-1).review.status,'pending');assert.match(retained.summary,/尚未完成/);
 console.log('PASS failed execution retains original downloadable candidate without claiming review');
 const unresolved=await scenario([
  ()=>[call('run_blender_python',{name:'立方体',script})],
  context=>[call('review_blender_result',{expectedVersion:latest(context).version,observations:'宽度明显不足。',issues:['宽度不足']})],
  context=>[call('review_blender_result',{expectedVersion:latest(context).version,observations:'尝试只清空问题',issues:[]})],
  context=>{assert.equal(context.messages.at(-1).isError,true);return [{type:'text',text:'保留未修复候选。'}];},
 ]);
 assert.equal(unresolved.results.at(-1).review.status,'issues');assert.deepEqual(unresolved.results.at(-1).review.issues,['宽度不足']);
 console.log('PASS known issues cannot be cleared without a new generation');
 const question=await scenario([
  ()=>[call('run_blender_python',{name:'不得执行',script})],
  context=>{assert.equal(context.messages.at(-1).isError,true);return [{type:'text',text:'当前模型有一个立方体。'}];},
 ],{previous,questionOnly:true});
 assert.deepEqual(question.posted,[]);assert.deepEqual(question.results,[]);assert.match(question.summary,/立方体/);
 console.log('PASS explicit question permission blocks all modeling and preserves previous result');
 const steered=await scenario([
  ()=>[call('run_blender_python',{name:'立方体',script})],
  (context,state)=>{assert.equal(state.control.steer('guide-width','把宽度改为 2'),true);return [call('review_blender_result',{expectedVersion:latest(context).version,observations:'旧要求的图不能结束最新补充。',issues:[]})];},
  context=>{assert.ok(context.messages.some(m=>m.role==='user'&&m.content.some(c=>c.type==='text'&&c.text.includes('把宽度改为 2'))));return [call('patch_blender_script',{expectedVersion:latest(context).version,patches:[{find:'width = 1',replace:'width = 2'}]})];},
  context=>[call('review_blender_result',{expectedVersion:latest(context).version,observations:'已核对补充要求后的新图。',issues:[]})],
 ]);
 assert.deepEqual(steered.posted,[script,script.replace('width = 1','width = 2')]);
 console.log('PASS steering after generation is consumed before review and applied to next candidate');
 const asked=await scenario([
  ()=>[call('run_blender_python',{name:'立方体',script})],
  (context,state)=>{assert.equal(state.control.steer('question-size','宽度是多少？',[],'question'),true);return [call('patch_blender_script',{expectedVersion:latest(context).version,patches:[{find:'width = 1',replace:'width = 9'}]})];},
  ()=>[call('patch_blender_script',{expectedVersion:readSource(script).version,patches:[{find:'width = 1',replace:'width = 9'}]})],
  context=>{assert.equal(context.messages.at(-1).isError,true);return [{type:'text',text:'当前脚本宽度为 1 米，本次只回答，未修改。'}];},
 ]);
 assert.deepEqual(asked.posted,[script]);assert.match(asked.summary,/当前脚本宽度为 1 米/);assert.equal(asked.results.at(-1).review.status,'pending');
 console.log('PASS question steering preserves answer and candidate without executing modifications');
 const largeScript=script+'#'+'.'.repeat(90000),largePrevious={...previous,script:largeScript};
 const large=await scenario([
  ()=>[call('patch_blender_script',{expectedVersion:readSource(largeScript).version,patches:[{find:'width = 1',replace:'width = 2'}]})],
  context=>[call('review_blender_result',{expectedVersion:latest(context).version,observations:'已核对修改后的当前图。',issues:[]})],
 ],{previous:largePrevious});
 assert.deepEqual(large.posted,[largeScript.replace('width = 1','width = 2')]);
 console.log('PASS Blender patches support scripts above Three.js source budget while preserving untouched bytes');
 const failedReview=[];
 await assert.rejects(scenario([
  ()=>[call('run_blender_python',{name:'立方体',script})],
  ()=>{throw Error('review provider unavailable');},
 ],{onResult:r=>failedReview.push(r)}),/review provider unavailable/);
 assert.equal(failedReview.at(-1).script,script);assert.equal(failedReview.at(-1).review.status,'pending');
 console.log('PASS provider failure after generation still publishes unreviewed original artifacts');
}finally{globalThis.fetch=original;await server.close();}
