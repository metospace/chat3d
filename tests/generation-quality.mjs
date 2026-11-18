import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({configFile:false,server:{middlewareMode:true,ws:false},appType:'custom'}),originalFetch=globalThis.fetch;
try{
 const {runModelingAgent}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const {generationReviewPlan}=await server.ssrLoadModule('/src/ai/generationReviewPolicy.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const provider=await server.ssrLoadModule('/src/ai/provider.ts');
 const config={baseURL:'https://fixture.invalid/v1',apiKey:'unused',model:'fixture'},picture='data:image/png;base64,YWJj';
 const transform={position:[0,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]};
 const create={op:'createPrimitive',name:'主体',parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_gray',transform};
 const edit={name:'edit_scene',args:{summary:'创建主体',operations:[create]}},capture={name:'capture_quality_review',args:{}},finish={name:'review_model',args:{observations:'测试仅验证证据流程',issues:[],completion:{summary:'模型候选',remainingIssues:[]}}};
 const fake=steps=>{let n=0;const contexts=[];return {contexts,get calls(){return n;},fn:async(_m,context)=>{contexts.push(structuredClone(context));const entry=steps[n++]??'停止并保留草稿';const step=typeof entry==='function'?entry(context):entry;const content=Array.isArray(step)?step.map((x,i)=>({type:'toolCall',id:`${n}_${i}`,name:x.name,arguments:x.args})):[{type:'text',text:step}];const message={role:'assistant',content,api:'openai-completions',provider:'fixture',model:'fixture',stopReason:Array.isArray(step)?'toolUse':'stop',timestamp:Date.now(),usage:{input:20,output:10,cacheRead:0,cacheWrite:0,totalTokens:30,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});});return stream;}};};
 const options=(f,legacy,document=createInitialDoc())=>({text:'创建完整模型',document,selection:[],config:{...config,...(legacy===undefined?{}:{generationQuality:legacy})},streamFn:f.fn,capture:async()=>picture});
 const multi=applyBatch(createInitialDoc(),{operations:[0,1,2].map(i=>({op:'createAssembly',name:'模型'+i,position:[i*2,0,0],parts:[{name:'主体',geometry:create.geometry,transform}]}))}).doc;
 const first=generationReviewPlan(createInitialDoc(),multi),second=generationReviewPlan(createInitialDoc(),multi,first.nextOffset);
 assert.equal(first.targets.length,2);assert.equal(second.targets.length,1);assert.equal(first.accepted,false);assert.equal(first.coverage,'component-multiview');
 console.log('PASS one review plan retains paginated current-component evidence');
 for(const legacy of [undefined,'fast','fine','unrecognized']){
  const f=fake([[edit,capture],[{name:'capture_multiview',args:{views:['front','back','side']}}],[finish]]),o=options(f,legacy),seen=[];
  o.capture=async(_doc,view,ids)=>{seen.push({view,ids});return picture;};
  const result=await runModelingAgent(o);
  assert.ok(seen.length>4);assert.ok(seen.some(x=>x.view==='front'&&x.ids?.length));assert.ok(seen.some(x=>x.view==='back'&&x.ids?.length));
  assert.equal('generationQuality' in result.activity,false);assert.equal(result.activity.generationReview.staticImages,seen.length);assert.equal(result.activity.detailAcceptance.status,'pending');assert.equal(o.document.nodes.length,0);
 }
 console.log('PASS obsolete quality values cannot select reduced views or a four-image ceiling');
 const same=fake([[edit,capture,finish],'未完成复核']),sameResult=await runModelingAgent(options(same));
 assert.equal(sameResult.batch.incomplete,true);assert.ok(same.contexts.flatMap(c=>c.messages).some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m).includes('下一轮')));
 console.log('PASS one quality mode retains later-turn visual evidence guard');
 const viewGroup=(...views)=>({name:'capture_multiview',args:{views}});
 const receiptError=(ctx,pattern)=>assert.ok(ctx.messages.some(m=>m.role==='toolResult'&&m.isError&&pattern.test(JSON.stringify(m.content))),String(pattern));
 for(const [name,secondary] of [['四门轿车','溜背座舱'],['电箱加热器','带开口的护罩'],['长颈鸟','颈部与躯干的过渡']]){
  let current;
  const assembly={name:'edit_scene',args:{summary:'建立主体与次级结构',operations:[{op:'createAssembly',name,parts:[{name:'主体',geometry:create.geometry,transform},{name:secondary,geometry:{type:'tube',params:{outerRadius:.3,innerRadius:.2,height:.3}},transform:{...transform,position:[0,1,0]}}]}]}};
  const checks=(status='pass')=>({componentId:current.nodes[0].assemblyId,checks:[{criterion:'silhouette',status,evidence:status==='fail'?'当前主体侧向体积不足':'核对当前侧向主体比例及轮廓',nodeIds:[current.nodes[0].id]},{criterion:'structure',status:'pass',evidence:'互补方向下可核对次级部位与开口',nodeIds:[current.nodes[1].id]}]});
  const complete=()=>({name:'review_model',args:{...finish.args,detailReviews:[checks()]}});
  const f=fake([[assembly,viewGroup('front','back')],()=>[complete()],ctx=>{receiptError(ctx,/互补视角/);return [viewGroup('front','side')];},[finish],ctx=>{receiptError(ctx,/必要结构仍待核对/);return [complete()];}]);
  const outcome=await runModelingAgent({...options(f),text:`创建${name}单体`,onPreview:d=>current=d});
  assert.equal(outcome.batch.taskStatus,'submitted',JSON.stringify(outcome.activity.events));
  assert.equal(outcome.activity.detailAcceptance.status,'pending','materials and remaining criteria were not claimed reviewed');
  const inspect={name:'capture_quality_review',args:{componentIds:[current.nodes[0].assemblyId]}};
  const formId=current.nodes[0].id;
  const fail={name:'audit_model_detail',args:{...checks('fail'),checks:[checks('fail').checks[0]]}};
  const editForm=depth=>({name:'edit_scene',args:{summary:'调整主体深度',operations:[{op:'updateParameters',targetId:formId,geometry:{type:'box',params:{width:1,height:1,depth}}}]}});
  const repaint={name:'edit_scene',args:{summary:'修改颜色',operations:[{op:'setAppearance',targetId:formId,baseColor:'#ff0000'}]}};
  const defective=fake([[viewGroup('front','side')],[fail,repaint,inspect],()=>[complete()],ctx=>{receiptError(ctx,/尚未实际修改/);return '保留仍有几何问题的草稿';}]);
  const partial=await runModelingAgent({...options(defective,undefined,current),text:`检查并完善${name}`,qualityBaseline:createInitialDoc()});
  assert.equal(partial.batch.taskStatus,'partial');assert.equal(partial.activity.referenceRepairs.length,1);
  const fix=fake([[editForm(1.4),viewGroup('front','side')],()=>[complete()]]);
  const repaired=await runModelingAgent({...options(fix,undefined,partial.result.doc),text:`恢复${name}主体深度`,qualityBaseline:createInitialDoc(),referenceRepairs:partial.activity.referenceRepairs});
  assert.equal(repaired.batch.taskStatus,'submitted',JSON.stringify(repaired.activity.events));assert.equal(repaired.activity.referenceRepairs.length,0);
  assert.equal(repaired.result.doc.nodes[0].geometry.params.depth,1.4);assert.deepEqual(repaired.result.doc.nodes[1],partial.result.doc.nodes[1]);
  console.log(`PASS ${name}: complementary current views and explicit verdicts required; color cannot clear geometry failure, real repair can`);
 }
 const directBodies=[];globalThis.fetch=async(_url,init)=>{directBodies.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:JSON.stringify({summary:'数据候选',operations:[create]})}}]});};
 for(const legacy of [undefined,'fast','fine']){const result=await provider.generateBatch('创建一只低模艺术狐狸',{...config,generationQuality:legacy,stream:false},{nodes:[],selection:[]});assert.equal(result.operations.length,1);assert.match(result.summary,/未经视觉验收/);}
 assert.deepEqual(directBodies[0].messages,directBodies[1].messages);assert.deepEqual(directBodies[1].messages,directBodies[2].messages);
 assert.ok(directBodies.every(body=>body.messages[body.messages.length-1].content.includes('低模艺术狐狸')));
 assert.ok(directBodies.every(body=>!Object.hasOwn(body,'max_tokens')&&!Object.hasOwn(body,'max_completion_tokens')));
 console.log('PASS legacy preferences cannot change actual single-call requests or erase explicit user style');
}finally{globalThis.fetch=originalFetch;await server.close();}
