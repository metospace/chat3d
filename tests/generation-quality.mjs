import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';

// All model calls and images in this suite are fabricated offline fixtures.
// It verifies policy/control flow, not real latency or visual fidelity.
const server = await createServer({server:{middlewareMode:true},appType:'custom'});
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const originalFetch = globalThis.fetch;
try {
  const {runModelingAgent} = await server.ssrLoadModule('/src/ai/modelingAgent.ts');
  const {normalizeGenerationQuality, generationQualityPrompt, FAST_STATIC_REVIEW_IMAGE_LIMIT} = await server.ssrLoadModule('/src/ai/generationPolicy.ts');
  const {generationReviewPlan} = await server.ssrLoadModule('/src/ai/generationReviewPolicy.ts');
  const {createInitialDoc} = await server.ssrLoadModule('/src/store.ts');
  const {applyBatch} = await server.ssrLoadModule('/src/domain/commands.ts');
  const {validateDocument} = await server.ssrLoadModule('/src/domain/types.ts');
  const {DETAIL_CRITERIA} = await server.ssrLoadModule('/src/domain/detailAcceptance.ts');
  const provider = await server.ssrLoadModule('/src/ai/provider.ts');
  const picture = 'data:image/png;base64,YWJj';
  const config = {baseURL:'https://offline.invalid/v1',apiKey:'offline-only-secret',model:'offline-fixture'};
  const transform = {position:[0,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]};
  const create = {op:'createPrimitive',name:'主体',tempId:'body',parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform,materialId:'mat_gray'};
  const edit = {name:'edit_scene',args:{summary:'生成主体',operations:[create]}};
  const capture = {name:'capture_quality_review',args:{}};
  const review = {name:'review_model',args:{observations:'测试只核对证据流程，不代表真实画面质量',issues:[]}};
  const finish = {...review,args:{...review.args,completion:{summary:'基础模型草稿',remainingIssues:[]}}};
  const data = {name:'submit_data_preview',args:{summary:'数据草稿，未视觉验收'}};
  const fake = steps => {
    let n = 0;
    const contexts = [];
    const fn = async (_model, context) => {
      contexts.push(structuredClone(context));
      const step = steps[n++] ?? '结束，保留未完成草稿';
      const actions = typeof step === 'function' ? step(context) : step;
      const content = Array.isArray(actions) ? actions.map((a, i) => ({type:'toolCall',id:`c${n}_${i}`,name:a.name,arguments:a.args})) : [{type:'text',text:actions}];
      const message = {role:'assistant',content,api:'openai-completions',provider:'offline',model:'offline',stopReason:Array.isArray(actions)?'toolUse':'stop',timestamp:Date.now(),usage:{input:20,output:10,cacheRead:0,cacheWrite:0,totalTokens:30,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({type:'start',partial:message}); stream.push({type:'done',reason:message.stopReason,message}); });
      return stream;
    };
    return {fn,contexts,get calls(){return n;}};
  };
  const opts = (f, quality = 'fast', document = createInitialDoc()) => ({text:'生成一个简单主体',document,selection:[],config:{...config,generationQuality:quality},streamFn:f.fn,capture:async()=>picture});
  const failures = f => f.contexts.flatMap(c=>c.messages.filter(m=>m.role==='toolResult'&&m.isError)).map(m=>JSON.stringify(m));
  const contextText = f => JSON.stringify(f.contexts);
  const errorsIn = result => result.activity.events.filter(e=>e.includes('工具失败')).join('\n');

  await test('legacy, corrupt and unsupported settings default to fine', () => {
    for(const value of [undefined,null,'balanced','FAST',{},false]) assert.equal(normalizeGenerationQuality(value),'fine');
    assert.equal(normalizeGenerationQuality('fast'),'fast');
    assert.equal(normalizeGenerationQuality('fine'),'fine');
  });
  await test('quality prompts change feature priorities without promising speed or dropping explicit constraints', () => {
    const fast = generationQualityPrompt('fast'), fine = generationQualityPrompt('fine');
    assert.match(fast,/普通质量/); assert.match(fast,/静态复核最多4张/); assert.match(fine,/多视角近景/);
    for(const text of [fast,fine]) {assert.match(text,/尺寸、数量/);assert.match(text,/不增加预算/);assert.match(text,/缺少证据/);assert.match(text,/人工确认/);}
    assert.match(generationQualityPrompt('fine','single'),/此路径不执行多轮视觉复核与修复/);
    assert.match(generationQualityPrompt('fast','data'),/submit_data_preview/);
  });
  const multi = applyBatch(createInitialDoc(),{operations:[0,1,2].map(i=>({op:'createAssembly',name:`模型${i}`,position:[i*2,0,0],parts:[{name:'主体',geometry:create.geometry,transform}]}))}).doc;
  await test('automatic fast agenda is bounded overview while fine retains paginated component evidence', () => {
    const fast = generationReviewPlan(createInitialDoc(),multi,'fast');
    const fine = generationReviewPlan(createInitialDoc(),multi,'fine');
    assert.equal(fast.coverage,'basic-overview'); assert.equal(fast.targets.length,0);assert.equal(fast.wholeViews.length,2);assert.equal(fast.deferredDetailTargets,3);assert.equal(fast.nextOffset,null);assert.equal(fast.accepted,false);
    assert.equal(fine.targets.length,2);assert.equal(fine.nextOffset,2);assert.equal(fine.coverage,'component-multiview');assert.equal(fine.accepted,false);
    assert.equal(generationReviewPlan(createInitialDoc(),multi,'fine',2).targets.length,1);
    const occupied=structuredClone(multi);occupied.nodes[1].sceneRole='person';occupied.nodes[1].transform.position=[...occupied.nodes[0].transform.position];
    assert.ok(generationReviewPlan(createInitialDoc(),occupied,'fast').risks.length>0);
    assert.throws(()=>generationReviewPlan(createInitialDoc(),multi,'fast',2),/没有后续组件页/);
  });
  await test('fast basic review submits manually confirmable draft without passing untouched six-item checks', async () => {
    let images = 0;
    const f = fake([[edit,{name:'inspect_model_quality',args:{}},capture],[finish]]), o = opts(f);
    o.capture = async () => {images++; return picture;};
    const r = await runModelingAgent(o);
    assert.equal(f.calls,2);assert.equal(images,2);assert.equal(r.batch.taskStatus,'submitted');assert.notEqual(r.batch.incomplete,true);
    assert.equal(r.activity.generationQuality,'fast');assert.equal(r.activity.generationReview.basicReviewCompleted,true);
    assert.equal(r.activity.generationReview.staticImages,2);assert.equal(r.activity.detailAcceptance.status,'pending');assert.equal(r.activity.detailAcceptance.reviews.length,0);
    assert.ok(r.batch.qualityIssues.some(i=>i.includes('尚未完成六项')));assert.match(r.batch.summary,/不代表精细质量通过/);
    assert.equal(o.document.nodes.length,0);assert.deepEqual(validateDocument(r.result.doc),[]);
    const inspectResult = f.contexts[1].messages.find(m=>m.role==='toolResult'&&m.toolName==='inspect_model_quality');
    assert.equal(JSON.parse(inspectResult.content[0].text).visual.coverage,'basic-overview');
    assert.ok(!contextText(f).includes(config.apiKey));
    assert.ok(!contextText(f).includes('当前为单次兼容生成'));
    assert.ok(!contextText(f).includes('此路径不执行多轮视觉复核与修复'));
    assert.ok(!contextText(f).includes('创建或修改结构前调用detail_quality_standard'));
    assert.ok(!contextText(f).includes('全部结构完成后优先用inspect_model_quality一次汇总数据检查，然后优先capture_quality_review按本轮变更自动获取全景和目标正反近景'));
  });
  await test('fine and legacy runs retain richer automatic target views without increasing user budgets', async () => {
    for(const quality of ['fine',undefined]) {
      const seen=[]; const f = fake([[edit,capture],[finish]]), o = opts(f,quality);o.config.generationQuality=quality;
      o.capture = async (_doc,view,ids) => {seen.push({view,ids});return picture;};
      const r = await runModelingAgent(o);
      assert.equal(r.activity.generationQuality,'fine');assert.ok(seen.some(x=>x.view==='front'&&x.ids?.includes(r.result.doc.nodes[0].id)));assert.ok(seen.some(x=>x.view==='back'&&x.ids?.includes(r.result.doc.nodes[0].id)));assert.equal(r.activity.generationReview.staticImageLimit,null);
      assert.notEqual(r.batch.incomplete,true);assert.notEqual(r.activity.detailAcceptance.status,'self_reviewed');
    }
  });
  await test('fast allowance exhaustion stops in the same turn and retains all applied draft changes', async () => {
    let doc, images=0;
    const move = x => ({name:'edit_scene',args:{summary:'修正主体位置',operations:[{op:'translate',targetId:doc.nodes[0].id,space:'world',mode:'delta',value:[x,0,0]}]}});
    const f = fake([[edit,capture],()=>[review,move(.1),capture],()=>[review,move(.1),capture],[finish]]), o=opts(f);
    o.onPreview=d=>doc=d;o.capture=async()=>{images++;return picture;};
    const r=await runModelingAgent(o);
    assert.equal(f.calls,3);assert.equal(images,FAST_STATIC_REVIEW_IMAGE_LIMIT);assert.equal(r.batch.taskStatus,'partial');assert.equal(r.batch.incomplete,true);
    assert.match(r.batch.summary,/停止继续视觉润色/);assert.equal(r.batch.operations.length,3);assert.equal(r.result.doc.nodes[0].transform.position[0],.2);assert.equal(o.document.nodes.length,0);
    assert.equal(r.activity.generationReview.basicReviewCompleted,false);assert.ok(r.batch.qualityIssues.length);
  });
  await test('manual multiview cannot bypass fast static image allowance', async () => {
    let images=0;const f=fake([[edit,capture],[{name:'capture_multiview',args:{views:['front','back','side']}}],[finish]]),o=opts(f);o.capture=async()=>{images++;return picture;};
    const r=await runModelingAgent(o);assert.equal(images,4);assert.equal(f.calls,2);assert.equal(r.batch.taskStatus,'partial');assert.match(r.batch.summary,/快速模式已完成4张/);
  });
  await test('fine does not inherit fast image ceiling', async () => {
    let images=0;const f=fake([[edit,capture],[{name:'capture_multiview',args:{views:['front','back','side']}}],[finish]]),o=opts(f,'fine');o.capture=async()=>{images++;return picture;};
    const r=await runModelingAgent(o);assert.ok(images>4);assert.equal(r.batch.taskStatus,'submitted');assert.equal(r.activity.generationReview.staticImages,images);
  });
  await test('same-turn review remains rejected in fast mode', async () => {
    const f=fake([[edit,capture,finish],'不能提前读取图片']),r=await runModelingAgent(opts(f));
    assert.equal(r.batch.taskStatus,'partial');assert.match(failures(f).join('\n'),/下一轮/);assert.equal(r.activity.generationReview.basicReviewCompleted,false);
  });
  await test('fast detail pass still requires real current multiview component evidence', async () => {
    let doc;const f=fake([[edit],()=>[{name:'audit_model_detail',args:{componentId:doc.nodes[0].id,checks:DETAIL_CRITERIA.map(c=>({criterion:c.key,status:'pass',evidence:'伪造的测试依据，不能视为真实检查',nodeIds:[doc.nodes[0].id]}))}}],'没有图片不能通过']),o=opts(f);o.onPreview=d=>doc=d;
    const r=await runModelingAgent(o);assert.equal(r.activity.detailAcceptance.reviews.length,0);assert.match(errorsIn(r),/没有当前多角度近景/);
  });
  await test('geometry validation and atomic rejection are unchanged in both modes', async () => {
    for(const quality of ['fast','fine']) {
      const f=fake([[{name:'edit_scene',args:{summary:'拒绝非法尺寸',operations:[create,{...create,name:'非法',tempId:'bad',geometry:{type:'box',params:{width:-1,height:1,depth:1}}}]}}],'参数无效']),o=opts(f,quality);
      const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,0);assert.equal(r.batch.operations.length,0);assert.match(errorsIn(r),/整批未执行|No operations applied|Command validation failed/);
    }
  });
  await test('explicit-selection and position locks apply equally to fast and fine', async () => {
    const base=applyBatch(createInitialDoc(),{operations:[create,{...create,name:'other',tempId:'other'}]}).doc;
    for(const quality of ['fast','fine'])for(const scope of [{nodeIds:[base.nodes[0].id]},{lockPlacement:true}]) {
      const f=fake([[{name:'edit_scene',args:{summary:'越界平移',operations:[{op:'translate',targetId:base.nodes[1].id,space:'world',mode:'delta',value:[1,0,0]}]}}],'范围受限']),o=opts(f,quality,base);o.editScope=scope;
      const r=await runModelingAgent(o);assert.deepEqual(r.result.doc,base);assert.ok(errorsIn(r));
    }
  });
  await test('explicit count and dimension mismatches remain visible with fast basic review', async () => {
    const f=fake([[edit,{name:'check_requirements',args:{items:[{quote:'创建2个主体，每个主体长2米',target:'主体',kind:'count',expected:'2'},{quote:'创建2个主体，每个主体长2米',target:'主体',kind:'length',expected:'2'}]}},capture],[finish]]),o=opts(f);o.text='创建2个主体，每个主体长2米';
    const r=await runModelingAgent(o);assert.equal(r.activity.requirements.items.length,2);assert.ok(r.activity.requirements.items.every(i=>i.status==='mismatch'));assert.equal(r.batch.incomplete,true);assert.match(r.batch.qualityIssues.join('\n'),/需求不符/);
  });
  await test('declared structured dimensions still reject a mismatched fast component atomically', async () => {
    const blueprint={key:'shape',name:'主体',purpose:'明确尺寸的主体',detailLevel:'scene',detailReason:'保留基本轮廓',silhouette:'一米立方体',dimensions:{x:2},features:[{key:'body',name:'整体主体',role:'form',geometryApproach:'primitive'}],negativeSpaces:[],views:['front','back']};
    const f=fake([[{name:'plan_object_structure',args:{objects:[blueprint]}},{name:'build_structured_component',args:{blueprintKey:'shape',definition:{name:'主体',parts:[{name:'body',geometry:create.geometry,transform}]},features:[{key:'body',partNames:['body']}]}}],'尺寸尚未满足']),r=await runModelingAgent(opts(f));
    assert.equal(r.result.doc.nodes.length,0);assert.match(errorsIn(r),/尺寸/);
  });
  await test('renderer unavailability keeps complete data scope and never fabricates visual acceptance', async () => {
    for(const quality of ['fast','fine']) {
      const f=fake([[{...edit,args:{summary:'两个主体',operations:[create,{...create,name:'second',tempId:'second'}]}},data]]),o=opts(f,quality);o.captureAvailable=()=>false;o.capture=()=>{throw Error('must not render');};
      const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.batch.taskStatus,'partial');assert.equal(r.activity.dataDraftSubmitted,true);assert.equal(r.activity.detailAcceptance.status,'pending');
    }
  });
  await test('both modes obey explicit round and token budgets rather than multiplying them', async () => {
    for(const quality of ['fast','fine'])for(const taskBudget of [{maxRounds:1},{maxReportedTokens:60}]) {
      const f=fake([[edit],[{...edit,args:{summary:'第二个主体',operations:[{...create,name:'second',tempId:'second'}]}}], [capture],[finish]]),o=opts(f,quality);o.config.taskBudget=taskBudget;
      const r=await runModelingAgent(o);assert.equal(r.batch.taskStatus,'partial');assert.equal(r.result.doc.nodes.length,1);assert.equal(f.calls,taskBudget.maxRounds?1:2);assert.match(r.batch.summary,/上限/);
    }
  });
  await test('quality and user budget are invocation snapshots, including after live config mutation', async () => {
    let o;const f=fake([()=>{o.config.generationQuality='fine';o.config.taskBudget.maxRounds=80;return [edit,capture];},[finish]]);o=opts(f);o.config.taskBudget={maxRounds:2};
    const r=await runModelingAgent(o);assert.equal(r.activity.generationQuality,'fast');assert.equal(r.activity.generationReview.staticImageLimit,4);assert.equal(f.calls,2);
    assert.match(JSON.stringify(f.contexts[1]),/本次生成档位：快速/);assert.match(JSON.stringify(f.contexts[1]),/本次上限2轮/);
  });
  await test('local unambiguous edits retain zero-token path and pending application in either mode', async () => {
    const base=applyBatch(createInitialDoc(),{operations:[create]}).doc;
    for(const quality of ['fast','fine']) {
      const f=fake(['must not call']),o=opts(f,quality,base);o.text='把主体改名为“测试体”';o.selection=[base.nodes[0].id];
      const r=await runModelingAgent(o);assert.equal(f.calls,0);assert.equal(r.activity.generationQuality,quality);assert.equal(r.activity.inputTokens+r.activity.outputTokens,0);assert.equal(r.result.doc.nodes[0].name,'测试体');assert.equal(base.nodes[0].name,'主体');
    }
  });
  await test('fast animation still requires evaluated moving samples and next-turn review', async () => {
    const base=applyBatch(createInitialDoc(),{operations:[create]}).doc;
    let images=0;const f=fake([[{name:'plan_model',args:{steps:['配置运动','检查动态样本'],assumptions:'无'}},{name:'configure_animation',args:{summary:'创建运动',name:'move',duration:4,loop:true,tracks:[{id:'move',name:'move',targetIds:[base.nodes[0].id],channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:4,value:[1,0,0]}]}]}},{name:'preview_animation',args:{}}],[finish]]),o=opts(f,'fast',base);o.text='让主体移动动画';o.capture=async()=>{images++;return picture;};
    const r=await runModelingAgent(o);assert.equal(images,3);assert.equal(r.activity.generationReview.staticImages,0);assert.equal(r.batch.taskStatus,'submitted');assert.ok(r.result.doc.animation);assert.equal(base.animation,undefined);
  });
  await test('single-call policies preserve JSON/schema path and explicitly label missing visual review', async () => {
    const requests=[],responses=[];
    globalThis.fetch=async (_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:responses.shift()??JSON.stringify({summary:'已生成主体',operations:[create]})}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
    for(const quality of ['fast','fine']) {
      const r=await provider.generateBatch('创建主体',{...config,generationQuality:quality,stream:false},{nodes:[],selection:[]});
      assert.equal(r.operations.length,1);assert.match(r.summary,/未经视觉验收/);assert.match(requests.at(-1).messages[0].content,quality==='fast'?/本次生成档位：快速/:/本次生成档位：精细/);
      assert.match(requests.at(-1).messages[0].content,/此路径不执行多轮视觉复核与修复/);
    }
    assert.ok(requests[0].messages[0].content.length<requests[1].messages[0].content.length);
    assert.ok(!requests[0].messages[0].content.includes('# 参考范例'));assert.equal(requests[0].max_tokens,requests[1].max_tokens);
    assert.match(requests[0].messages[0].content,/多轮任务预算监控和视觉修复仅适用于Pi模式/);
    responses.push('not JSON');
    const live={...config,generationQuality:'fast',reasoningEffort:'high',stream:false};
    const retried=await provider.generateBatch('创建主体',live,{nodes:[],selection:[]},undefined,[],[],()=>{live.generationQuality='fine';live.reasoningEffort='low';});
    assert.equal(requests.length,4);assert.match(retried.summary,/快速模式数据草稿/);assert.match(requests.at(-1).messages[0].content,/本次生成档位：快速/);
    assert.ok(requests.slice(2).every(body=>body.reasoning_effort==='high'),'correction requests keep the invocation reasoning snapshot');
    assert.ok(requests.slice(0,2).every(body=>!Object.hasOwn(body,'reasoning_effort')),'legacy/default requests omit the parameter');
    for(const reasoningEffort of [undefined,'low','medium','high','xhigh'])for(const stream of [false,true]) {
      await provider.generateBatch('创建主体',{...config,reasoningEffort,stream},{nodes:[],selection:[]});
      const body=requests.at(-1);assert.equal(body.reasoning_effort,reasoningEffort);assert.equal(Object.hasOwn(body,'reasoning_effort'),reasoningEffort!==undefined);
      assert.equal(body.stream,stream);assert.equal(body.max_tokens,8192);assert.equal(body.temperature,.2);assert.equal(body.model,config.model);
    }
  });
  console.log(`${passed} generation-quality policy checks passed; all model/render calls mocked, no measured speed or fidelity claims`);
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
