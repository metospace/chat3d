import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;let forceTransportError=false;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name)};
try{
 const {runModelingAgent,compactAgentContext,agentSceneContext}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const {normalizeModelingRequestText,normalizeModelingRequestMessages}=await server.ssrLoadModule('/src/ai/modelingRequest.ts');
 const {createInitialDoc,useEditorStore:store}=await server.ssrLoadModule('/src/store.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const cfg={baseURL:'https://mock.invalid/v1',apiKey:'mock-only',model:'mock-vision-tools',useMock:false};
 const create={op:'createPrimitive',parentId:null,transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]},name:'body',tempId:'body',geometry:{type:'roundedPlate',params:{width:1.1,height:.25,depth:.8,cornerRadius:.2}},materialId:'mat_white'};
 const design={flow:['加工','检测'],layout:'设备面向操作通道，人员与物料流向明确',equipment:[{name:'按需求设计的设备',count:2,features:['有独立加工空间','明确操作面']}],checks:['检查通道连续性','检查设备近景'],composition:{zones:[{name:'生产区',purpose:'加工与检测'}],connections:[],support:[],palette:['灰蓝'],presentation:'设备与地面区分，完整沙盘取景'}};
 const plan={name:'plan_model',args:{steps:['主体','截图检查'],assumptions:'尺寸按图估算',design}};
 const edit={name:'edit_scene',args:{summary:'创建主体',operations:[create]}};
 const capture={name:'capture_view',args:{view:'perspective'}};
 const review={name:'review_model',args:{observations:'检查了外形比例与部件关系',issues:[]}};
 const inspect={name:'inspect_scene',args:{}};
 const submit={name:'submit_preview',args:{summary:'主体预览',remainingIssues:[]}};
 const picture='data:image/jpeg;base64,YWJj';
 const fake=(steps)=>{let n=0;const contexts=[];const fn=async(model,context)=>{contexts.push(structuredClone(context));const step=steps[n++]??'done';const actions=typeof step==='function'?step(context):step;const content=Array.isArray(actions)?actions.map((a,i)=>({type:'toolCall',id:`call_${n}_${i}`,name:a.name,arguments:a.args})):[{type:'text',text:actions}];const message={role:'assistant',content,api:'openai-completions',provider:'mock',model:'mock',stopReason:Array.isArray(actions)?'toolUse':'stop',timestamp:Date.now(),usage:{input:20,output:10,cacheRead:0,cacheWrite:0,totalTokens:30,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message})});return stream};return {fn,contexts,get calls(){return n}}};
 const opts=(transport,document=createInitialDoc())=>({text:'按参考图建模',config:cfg,document,selection:[],images:[picture],streamFn:transport.fn,capture:async()=>picture});
 await test('provider tool parameters clone nested schemas and preserve conjunctive unions',async()=>{
  const {sanitizeToolParametersForProvider}=await server.ssrLoadModule('/src/ai/toolParameters.ts');
  const schema={type:'object',required:['items'],additionalProperties:false,properties:{items:{type:'array',uniqueItems:true,minItems:1,items:{oneOf:[{const:'a'},{type:'array',uniqueItems:true,items:{oneOf:[{type:'number'}]}}],anyOf:[{type:'string'},{type:'array'}],allOf:[{description:'keep this constraint'}]}}}};
  const original=structuredClone(schema);
  const result=sanitizeToolParametersForProvider(schema);
  assert.deepEqual(result,{type:'object',required:['items'],additionalProperties:false,properties:{items:{type:'array',minItems:1,items:{anyOf:[{type:'string'},{type:'array'}],allOf:[{description:'keep this constraint'},{anyOf:[{const:'a'},{type:'array',items:{anyOf:[{type:'number'}]}}]}]}}}});
  assert.deepEqual(schema,original);
  assert.notEqual(result.required,schema.required);
  assert.notEqual(result.properties.items.items.anyOf[0],schema.properties.items.items.anyOf[0]);
 });
 await test('provider tool parameters strip TypeBox metadata and rewrite optional tuples',async()=>{
  const {sanitizeToolParametersForProvider}=await server.ssrLoadModule('/src/ai/toolParameters.ts');
  const schema=Type.Object({position:Type.Optional(Type.Tuple([Type.Number(),Type.Number(),Type.Number()])),points:Type.Array(Type.Tuple([Type.Number(),Type.Number()]),{uniqueItems:true}),choice:Type.Number()},{additionalProperties:false});
  schema.properties.choice.oneOf=[Type.Number(),Type.String()];
  schema[Symbol('internal')]='hidden';
  const original=JSON.stringify(schema);
  const result=sanitizeToolParametersForProvider(schema);
  assert.equal(result.type,'object');
  assert.equal(result.additionalProperties,false);
  assert.doesNotMatch(JSON.stringify(result),/"(?:~[^"\s]*|oneOf|uniqueItems)"\s*:/);
  assert.deepEqual(Reflect.ownKeys(result),Object.keys(result));
  assert.deepEqual(result.properties.position,{type:'array',prefixItems:[{type:'number'},{type:'number'},{type:'number'}],items:false,minItems:3,maxItems:3});
  assert.deepEqual(result.properties.points.items,{type:'array',prefixItems:[{type:'number'},{type:'number'}],items:false,minItems:2,maxItems:2});
  for(const maxItems of [1,5]){
   const tuple=sanitizeToolParametersForProvider({type:'array',items:[Type.Number(),Type.Number()],additionalItems:false,maxItems});
   assert.equal(tuple.maxItems,Math.min(maxItems,2));
   assert.equal(tuple.items,false);
   assert.ok(!Object.hasOwn(tuple,'additionalItems'));
  }
  assert.equal(JSON.stringify(schema),original);
 });
 await test('provider tool parameters replace only ambiguous non-whitespace patterns without mutation',async()=>{
  const {sanitizeToolParametersForProvider}=await server.ssrLoadModule('/src/ai/toolParameters.ts');
  const schema={type:'string',minLength:1,pattern:'\\S',maxLength:80},original=structuredClone(schema);
  assert.deepEqual(sanitizeToolParametersForProvider(schema),{type:'string',minLength:1,maxLength:80});
  assert.deepEqual(schema,original);
  for(const minLength of [undefined,0,-1,NaN,'1',3]){
   const result=sanitizeToolParametersForProvider({type:'string',pattern:'\\S',minLength});
   assert.ok(!Object.hasOwn(result,'pattern'));
   assert.equal(result.minLength,minLength===3?3:1);
  }
  const hex={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
  assert.deepEqual(sanitizeToolParametersForProvider(hex),hex);
 });
 await test('provider tool parameters force object roots for bare unions',async()=>{
  const {ensureToolParametersObject}=await server.ssrLoadModule('/src/ai/toolParameters.ts');
  const root=ensureToolParametersObject({anyOf:[{type:'object',properties:{mode:{type:'string',const:'list'}},additionalProperties:false},{type:'object',required:['mode','captureId'],properties:{mode:{type:'string',const:'images'},captureId:{type:'string'}},additionalProperties:false}]});
  assert.equal(root.type,'object');
  assert.equal(root.anyOf.length,2);
  assert.deepEqual(ensureToolParametersObject({type:'object',properties:{}}),{type:'object',properties:{}});
  assert.deepEqual(ensureToolParametersObject(null),{type:'object',properties:{}});
 });
 await test('live optional tool registry exposes only provider-compatible schemas',async()=>{
  const {OPTIONAL_TOOL_GROUP_NAMES}=await server.ssrLoadModule('/src/ai/toolExposure.ts');
  const f=fake([[{name:'enable_modeling_tools',args:{groups:OPTIONAL_TOOL_GROUP_NAMES}}],[{name:'submit_data_preview',args:{summary:'工具注册表数据检查完成，未视觉验收'}}]]);
  const o=opts(f,createInitialDoc());o.captureAvailable=()=>false;o.onPreview=()=>{};
  await assert.rejects(()=>runModelingAgent(o),/本轮未修改场景，也未完成视觉验收/);
  assert.equal(f.calls,2);
  const tools=new Map(f.contexts.flatMap(c=>c.messages.flatMap(m=>m.toolsAdded??[])).map(t=>[t.name,t]));
  assert.ok(tools.size>=50,`expected >=50 tools, got ${tools.size}`);
  const walk=(value,path)=>{
   if(!value||typeof value!=='object')return;
   for(const [key,child] of Object.entries(value)){
    const location=`${path}.${key}`;
    assert.ok(!/^~/.test(key)&&!['oneOf','uniqueItems','additionalItems'].includes(key),location);
    assert.ok(key!=='items'||!Array.isArray(child),location);
    assert.ok(key!=='pattern'||child!=='\\S',location);
    walk(child,location);
   }
  };
  for(const [name,tool] of tools){
   assert.equal(tool.parameters?.type,'object',name+'.parameters.type');
   walk(tool.parameters,name);
  }
  assert.ok(tools.has('recall_evidence'));
  assert.equal(tools.get('recall_evidence').parameters.type,'object');
  assert.ok(Array.isArray(tools.get('recall_evidence').parameters.anyOf));
  assert.ok(tools.has('build_modeling_program'));
  const position=tools.get('build_modeling_program').parameters.properties.position;
  assert.equal(position.items,false);
  assert.ok(Array.isArray(position.prefixItems));assert.equal(position.prefixItems.length,3);
  assert.ok(tools.has('edit_scene'));
  assert.ok(!JSON.stringify(tools.get('edit_scene').parameters).includes(JSON.stringify('pattern')+':'+JSON.stringify('\\S')));
 });
 await test('task budgets normalize invalid input and preserve bounded defaults',async()=>{
  const {normalizeTaskBudget,taskBudgetReason}=await server.ssrLoadModule('/src/ai/taskBudget.ts');
  assert.deepEqual(normalizeTaskBudget(),{maxMinutes:10,maxRounds:24,maxReportedTokens:2000000});
  assert.deepEqual(normalizeTaskBudget({maxMinutes:Infinity,maxRounds:0,maxReportedTokens:NaN}),{maxMinutes:10,maxRounds:1,maxReportedTokens:2000000});
  assert.match(taskBudgetReason(normalizeTaskBudget(),1800000,0,0),/分钟上限/);
  assert.match(taskBudgetReason(normalizeTaskBudget(),0,0,2_000_000),/软上限/);
  assert.match(taskBudgetReason(normalizeTaskBudget(),0,0,2_000_000),/不是单个资产的价格或账单/);
  assert.match(taskBudgetReason(normalizeTaskBudget(),0,0,2_000_000),/继续/);
 });
 await test('productive task stops at configured round cap and keeps an incomplete atomic draft',async()=>{
  const f=fake([[edit],[{name:'edit_scene',args:{summary:'second',operations:[{...create,name:'second',tempId:'second'}]}}],[edit]]);
  const o=opts(f);o.config={...cfg,taskBudget:{maxRounds:2}};const r=await runModelingAgent(o);
  assert.equal(f.calls,2);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/2 轮上限/);
 });
 await test('reported token cap blocks returned tools and the next request without losing earlier work',async()=>{
  const f=fake([[edit],[{name:'edit_scene',args:{summary:'second',operations:[{...create,name:'second',tempId:'second'}]}}]]);
  const o=opts(f);o.config={...cfg,taskBudget:{maxReportedTokens:60}};const r=await runModelingAgent(o);
  assert.equal(f.calls,2);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.activity.inputTokens+r.activity.outputTokens,60);assert.match(r.batch.summary,/Token 上限/);assert.equal(r.batch.incomplete,true);
 });
 await test('elapsed deadline retains a previous edit and prevents further model calls',async()=>{
  const realNow=Date.now;let advanced=false;const f=fake([[edit],[edit]]);const o=opts(f);o.config={...cfg,taskBudget:{maxMinutes:1}};o.onPreview=()=>{advanced=true;};
  Date.now=()=>realNow()+(advanced?61000:0);
  try{const r=await runModelingAgent(o);assert.equal(f.calls,1);assert.equal(r.result.doc.nodes.length,1);assert.match(r.batch.summary,/分钟上限/);}finally{Date.now=realNow;}
 });
 await test('budget exhaustion before any edit is explicit and does not invent a preview',async()=>{
  const f=fake([[edit]]);const o=opts(f);o.config={...cfg,taskBudget:{maxReportedTokens:1}};
  await assert.rejects(()=>runModelingAgent(o),/Token 上限/);assert.equal(f.calls,1);
 });
 await test('wall-clock timer aborts an in-flight request and preserves earlier draft with incomplete usage',async()=>{
  const originalTimeout=globalThis.setTimeout;let deadlineCallback;globalThis.setTimeout=(fn,ms,...args)=>{if(ms>59000&&ms<=60000){deadlineCallback=fn;return originalTimeout(()=>{},120000);}return originalTimeout(fn,ms,...args);};
  let first=true;const f=fake([[edit]]);const o=opts(f);o.config={...cfg,taskBudget:{maxMinutes:1}};o.streamFn=(m,context,streamOptions)=>{if(first){first=false;return f.fn(m,context,streamOptions);}const stream=createAssistantMessageEventStream();queueMicrotask(()=>{deadlineCallback();const error={role:'assistant',content:[],api:'openai-completions',provider:'mock',model:'mock',stopReason:'aborted',errorMessage:'cancelled',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};stream.push({type:'error',reason:'aborted',error});});return stream;};
  try{const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.activity.usageIncomplete,true);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/分钟上限/);}finally{globalThis.setTimeout=originalTimeout;}
 });
 await test('parallel child requests share one parent round budget rather than multiplying it',async()=>{
  const items=[{name:'one',brief:'独立柜体',position:[0,0,0],sceneRole:'equipment'},{name:'two',brief:'独立柜体',position:[2,0,0],sceneRole:'equipment'}];
  const f=fake([[edit,{name:'build_components_parallel',args:{style:'统一',items}}],[edit]]),children=[];const o=opts(f);o.captureAvailable=()=>false;o.config={...cfg,parallelDrafts:true,taskBudget:{maxRounds:2}};
  o.workerStreamFn=name=>{const child=fake([[{name:'edit_scene',args:{summary:'独立部件',operations:[{...create,name}]}},{name:'submit_data_preview',args:{summary:'数据未验收'}}]]);children.push(child);return child.fn;};
  const r=await runModelingAgent(o);assert.equal(f.calls+children.reduce((n,c)=>n+c.calls,0),2);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/轮上限/);
 });
 await test('incremental agent audit preserves unchanged shape evidence and accepts only missing relationship checks',async()=>{
 const base=createInitialDoc(),doc=applyBatch(base,{operations:[{...create,name:'A',tempId:'a'},{...create,name:'B',tempId:'b',transform:{...create.transform,position:[3,0,0]}}]}).doc;const a=doc.nodes[0],b=doc.nodes[1];const checks=['silhouette','structure','connections','materials','details','context'].map(criterion=>({criterion,status:'pass',evidence:'当前两张测试图和真实部件共同支持',nodeIds:[a.id]}));const f=fake([[{name:'capture_multiview',args:{componentId:a.id,views:['front','back']}}],[{name:'audit_model_detail',args:{componentId:a.id,checks}}],[{name:'edit_scene',args:{summary:'move unrelated B',operations:[{op:'translateAssembly',targetId:b.id,value:[1,0,0]}]}}],[{name:'audit_model_detail',args:{componentId:a.id,checks:checks.filter(c=>['connections','context'].includes(c.criterion)).map(c=>({...c,status:'unknown',evidence:'邻接布局发生变化，仍需当前图片复查'}))}}],'仍需关系检查']);const r=await runModelingAgent({...opts(f,doc),qualityBaseline:base});const audit=r.activity.detailAcceptance.reviews.find(x=>x.componentId===a.id);assert.ok(audit);assert.equal(audit.visualEvidence,false);assert.equal(audit.evidenceRevision,doc.revision);assert.equal(audit.checks.find(c=>c.criterion==='structure').status,'pass');assert.equal(audit.checks.find(c=>c.criterion==='context').status,'unknown');assert.equal(audit.reusedCriteria.length,4);
 });
 await test('failed geometry batch is repaired by one field correction without partial application',async()=>{
 const invalid={name:'edit_scene',args:{summary:'two parts',operations:[create,{...create,name:'pipe',tempId:'pipe',geometry:{type:'sweepTube',params:{points:[[0,0,0],[0,.3,.1]],radius:.01,segments:16,radialSegments:4}}}]}};
 const f=fake([[invalid],context=>{const error=context.messages.find(m=>m.role==='toolResult'&&m.isError);assert.match(JSON.stringify(error),/radialSegments/);assert.match(JSON.stringify(error),/失败批次ID=call_1_0/);return [{name:'retry_scene_edit',args:{failedId:'call_1_0',patches:[{path:['operations',1,'geometry','params','radialSegments'],value:12}]}}];},'已修复数据草稿']);let sizes=[];const r=await runModelingAgent({...opts(f),onPreview:d=>sizes.push(d.nodes.length)});assert.deepEqual(sizes,[2]);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.result.doc.nodes.find(n=>n.name==='pipe').geometry.params.radialSegments,12);
 });
 await test('failed batch patches reject stale tasks, prototype paths and excessive retries',async()=>{
 const {FailedEditBuffer}=await server.ssrLoadModule('/src/ai/failedEdit.ts');const b=new FailedEditBuffer(),payload={summary:'x',operations:[{op:'createPrimitive',geometry:{type:'box',params:{width:1}}}]};b.remember('e',1,'goal',payload);assert.throws(()=>b.correct('e',2,'goal',[{path:['operations',0,'geometry','params','width'],value:2}]),/变化/);assert.throws(()=>b.correct('e',1,'new goal',[{path:['operations',0,'geometry','params','width'],value:2}]),/变化/);assert.throws(()=>b.correct('e',1,'goal',[{path:['operations',0,'__proto__','x'],value:1}]),/无效/);const patch=[{path:['operations',0,'geometry','params','width'],value:2}];assert.equal(b.correct('e',1,'goal',patch).operations[0].geometry.params.width,2);assert.equal(payload.operations[0].geometry.params.width,1);b.correct('e',1,'goal',patch);assert.throws(()=>b.correct('e',1,'goal',patch),/上限/);
 });
 await test('automatic closeup frames only its target while retaining all scene geometry for occlusion',async()=>{
 const baseline=createInitialDoc(),doc=applyBatch(baseline,{operations:[{op:'createAssembly',name:'small object',parts:[{name:'detail',geometry:{type:'box',params:{width:.1,height:.1,depth:.1}},transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]},{op:'createAssembly',name:'large adjacent object',parts:[{name:'large',geometry:{type:'box',params:{width:5,height:5,depth:5}},transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}]}).doc;let captures=[];const f=fake([[{name:'capture_quality_review',args:{}}],'图已取得待验']);await runModelingAgent({...opts(f,doc),qualityBaseline:baseline,capture:async(d,v,ids)=>{captures.push({nodes:d.nodes.length,ids});return picture;}});assert.ok(captures.filter(c=>c.ids).every(c=>c.nodes===2&&c.ids.length===1));assert.ok(doc.nodes.every(n=>captures.some(c=>c.ids?.includes(n.id))));assert.ok(captures.some(c=>c.nodes===2&&c.ids===undefined));
 });
 await test('batch detail review validates all entries before recording and never invents passes',async()=>{
  const baseline=createInitialDoc(),doc=applyBatch(baseline,{operations:[{...create,name:'one'},{...create,name:'two',tempId:'two'}]}).doc;
  const checks=node=>['silhouette','structure','connections','materials','details','context'].map(criterion=>({criterion,status:'unknown',evidence:'当前证据不足，明确保留待核对',nodeIds:[node.id]}));
  const rows=doc.nodes.map(n=>({componentId:n.id,checks:checks(n)}));
  const bad=fake([[{name:'detail_quality_standard',args:{}},{name:'audit_model_details_batch',args:{reviews:[rows[0],{...rows[1],componentId:'missing'}]}}],'检查未通过']);const badResult=await runModelingAgent({...opts(bad,doc),qualityBaseline:baseline});assert.equal(badResult.activity.detailAcceptance.reviews.length,0);
  const good=fake([[{name:'audit_model_details_batch',args:{reviews:rows}}],'已记录待核对']);const result=await runModelingAgent({...opts(good,doc),qualityBaseline:baseline});assert.equal(result.activity.detailAcceptance.reviews.length,2);assert.equal(result.activity.detailAcceptance.status,'pending');
 });
 await test('combined detail batch completes after later-turn subject views without duplicate whole frames',async()=>{
  let current;const seen=[];const f=fake([[edit,{name:'capture_quality_review',args:{}}],()=>[{name:'review_model',args:{...review.args,detailReviews:[{componentId:current.nodes[0].id,checks:['silhouette','structure','connections','materials','details','context'].map(criterion=>({criterion,status:'pass',evidence:'当前正反面完整呈现主体轮廓、结构与表面',nodeIds:[current.nodes[0].id]}))}],completion:submit.args}}]]);
  const o=opts(f);o.images=[];o.text='创建一个自定义主体';o.onPreview=d=>current=d;o.capture=async(doc,view,ids)=>{seen.push({view,ids,nodes:doc.nodes.map(n=>n.id)});return picture;};
  const r=await runModelingAgent(o);assert.equal(f.calls,2);assert.equal(r.batch.incomplete,undefined);assert.equal(r.activity.detailAcceptance.status,'self_reviewed');assert.ok(seen.length>=2);assert.ok(seen.every(c=>c.ids?.length===current.nodes.length));assert.ok(new Set(seen.map(c=>c.view)).size>=2);assert.equal(r.activity.generationReview.basicReviewCompleted,true);assert.equal(r.activity.phase,'reviewing');assert.equal(typeof r.activity.lastModelEditAt,'number');
 });
 await test('invalid combined batch changes neither sibling reviews nor global review state',async()=>{
  let current;const f=fake([[{name:'edit_scene',args:{summary:'两个主体',operations:[create,{...create,name:'second',tempId:'second',transform:{...create.transform,position:[3,0,0]}}]}},{name:'capture_quality_review',args:{}}],()=>[{name:'review_model',args:{...review.args,detailReviews:current.nodes.map((n,i)=>({componentId:n.id,checks:['silhouette','structure','connections','materials','details','context'].map(criterion=>({criterion,status:'pass',evidence:'最新多视角明确呈现当前真实组件',nodeIds:[i?'missing-node':n.id]}))})),completion:submit.args}}],context=>{const err=context.messages.filter(m=>m.role==='toolResult'&&m.isError).at(-1);assert.ok(err);return [submit];},'保留未验收草稿']);
  const o=opts(f);o.onPreview=d=>current=d;const r=await runModelingAgent(o);assert.equal(r.activity.detailAcceptance.reviews.length,0);assert.equal(r.batch.incomplete,true);assert.ok(!r.activity.events.some(e=>e.startsWith('视觉检查')));assert.ok(f.contexts.some(c=>c.messages.some(m=>m.role==='toolResult'&&m.toolName==='submit_preview'&&m.isError)));
 });
 await test('combined batch retains known failures and all normal completion gates',async()=>{
  for(const defect of ['detail','requirement','visual']){
   let current;const req={name:'check_requirements',args:{items:[{quote:'两个body',target:'body',kind:'count',expected:'2'}]}};
   const f=fake([[...(defect==='requirement'?[req]:[]),edit,{name:'capture_quality_review',args:{}}],()=>[{name:'review_model',args:{...review.args,issues:defect==='visual'?['主体背面开口缺失']:[],detailReviews:[{componentId:current.nodes[0].id,checks:['silhouette','structure','connections','materials','details','context'].map(criterion=>({criterion,status:defect==='detail'&&criterion==='silhouette'?'fail':'pass',evidence:defect==='detail'&&criterion==='silhouette'?'主体轮廓过高需要修复':'最新双向截图已核对具体可见结构',nodeIds:[current.nodes[0].id]}))}],completion:submit.args}}],'尚有明确缺陷']);
   const o=opts(f);o.text='两个body';o.images=[];o.onPreview=d=>current=d;const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,true);assert.notEqual(r.activity.outcome,'preview-ready');assert.equal(r.activity.detailAcceptance.reviews.length,1);
  }
 });
 await test('combined review still rejects same-turn and stale evidence',async()=>{
  let current;const combined=()=>({name:'review_model',args:{...review.args,detailReviews:[{componentId:current.nodes[0].id,checks:['silhouette','structure','connections','materials','details','context'].map(criterion=>({criterion,status:'pass',evidence:'试图使用尚未读取或过期的画面',nodeIds:[current.nodes[0].id]}))}],completion:submit.args}});
  const same=fake([[edit,{name:'capture_quality_review',args:{}}],()=>[{name:'capture_view',args:{view:'side'}},combined()],'仍需下一轮读取']);const o=opts(same);o.onPreview=d=>current=d;let r=await runModelingAgent(o);assert.equal(r.batch.incomplete,true);assert.equal(r.activity.detailAcceptance.reviews.length,0);
  const stale=fake([[edit,{name:'capture_quality_review',args:{}}],()=>[{name:'edit_scene',args:{summary:'移动主体',operations:[{op:'translate',targetId:current.nodes[0].id,space:'world',mode:'delta',value:[1,0,0]}]}},combined()],'保留需要新证据的草稿']);const p=opts(stale);p.onPreview=d=>current=d;r=await runModelingAgent(p);assert.equal(r.batch.incomplete,true);assert.equal(r.activity.detailAcceptance.reviews.length,0);
 });
 await test('phase survives model waits and metadata never refreshes model mutation time',async()=>{
  let current,editedAt;const snapshots=[];const f=fake([[plan,edit,capture],()=>{editedAt=snapshots.at(-1).lastModelEditAt;return [review,{name:'edit_scene',args:{summary:'只改名',operations:[{op:'rename',targetId:current.nodes[0].id,name:'final'}]}},plan];},[submit]]);const o=opts(f);o.onPreview=d=>current=d;o.onActivity=a=>snapshots.push(a);const r=await runModelingAgent(o);
  assert.equal(typeof editedAt,'number');assert.equal(r.activity.lastModelEditAt,editedAt);assert.ok(snapshots.some(a=>a.phase==='building'));assert.ok(snapshots.some(a=>a.title.includes('第 2 轮：等待')&&a.phase==='reviewing'));assert.ok(snapshots.some(a=>a.title.includes('第 3 轮：等待')&&a.phase==='planning'));assert.ok(r.activity.timings.filter(t=>t.kind==='model').every(t=>typeof t.endedAt==='number'));
 });
 await test('runtime notes leave the stable system prefix and user reference evidence intact',async()=>{
  const f=fake([[{name:'read_scene',args:{}}],'仅回答']);const o=opts(f);o.text='保留原始用户指令';await runModelingAgent(o);const systems=f.contexts.map(c=>c.messages.find(m=>m.role==='system').content);assert.deepEqual(systems[0],systems[1]);for(const c of f.contexts){const runtime=c.messages.at(-1);assert.equal(runtime.role,'user');assert.match(JSON.stringify(runtime.content),/运行时状态/);assert.ok(c.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('保留原始用户指令')));assert.ok(c.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('YWJj')));}assert.equal(f.contexts[1].messages.filter(m=>m.role==='user'&&JSON.stringify(m.content).includes('运行时状态')).length,1);
 });
 await test('metadata binds and replans do not count as shape edits or erase measured mismatch blockers',async()=>{
  const doc=applyBatch(createInitialDoc(),{operations:[create]}).doc,id=doc.nodes[0].id;
  const blueprint={key:'shape',name:'主体',purpose:'用于测试完整轮廓',detailLevel:'closeup',detailReason:'需要核对外形比例',silhouette:'连续圆角主体',features:[{key:'body',name:'主体轮廓',referenceObservation:'参考图主体横向约为竖向两倍',role:'form',geometryApproach:'profile'}],negativeSpaces:[],views:['front','back'],referenceProportions:[{key:'width-height',name:'宽高比',numerator:{featureKey:'body',axis:'x'},denominator:{featureKey:'body',axis:'y'},expected:2,source:'estimated',relativeTolerance:.1,view:'front',observation:'参考图正面观察的主体宽高比'}]};
  const f=fake([[{name:'plan_object_structure',args:{objects:[blueprint]}},{name:'bind_object_features',args:{bindings:[{blueprintKey:'shape',componentId:id,features:[{key:'body',nodeIds:[id]}]}]}}],[{name:'plan_object_structure',args:{objects:[{...blueprint,referenceProportions:[{...blueprint.referenceProportions[0],expected:4.4}]}]}},submit],'比例差异仍需真实修复或新证据']);const snapshots=[];const o=opts(f,doc);o.onActivity=a=>snapshots.push(a);const r=await runModelingAgent(o);assert.equal(r.activity.lastModelEditAt,undefined);assert.ok(snapshots.every(a=>a.lastModelEditAt===undefined));assert.equal(r.batch.incomplete,true);assert.ok(f.contexts.some(c=>c.messages.some(m=>m.role==='toolResult'&&m.toolName==='submit_preview'&&m.isError)));assert.deepEqual(r.result.doc.nodes[0].geometry,doc.nodes[0].geometry);
 });
 await test('multi-component image packet stays until all sibling targets are audited',()=>{
  const image={type:'image',data:'a'.repeat(100),mimeType:'image/png'};const packet={role:'toolResult',toolCallId:'captureAB',toolName:'capture_quality_review',isError:false,details:{revision:3},content:[{type:'text',text:'revision=3 scope=A view=front'},image,{type:'text',text:'revision=3 scope=B view=front'},image],timestamp:0};
  const audit=id=>({role:'toolResult',toolCallId:'audit'+id,toolName:'audit_model_detail',isError:false,details:{revision:3,componentId:id},content:[{type:'text',text:'recorded'}],timestamp:0});const newer={...packet,toolCallId:'captureC',content:[{type:'text',text:'revision=3 scope=C view=front'},image]};
  let messages=compactAgentContext([packet,audit('A'),newer]);assert.equal(messages[0].content.filter(c=>c.type==='image').length,2);messages=compactAgentContext([packet,audit('A'),audit('B'),newer]);assert.equal(messages[0].content.filter(c=>c.type==='image').length,0);const fresh={...packet,content:packet.content.map(c=>c.type==='text'?{...c,text:c.text.replace('revision=3','revision=4')}:c)};const freshC={...newer,content:newer.content.map(c=>c.type==='text'?{...c,text:c.text.replace('revision=3','revision=4')}:c)};messages=compactAgentContext([audit('A'),audit('B'),fresh,freshC]);assert.equal(messages[2].content.filter(c=>c.type==='image').length,2);
 });
 await test('context keeps every current plan scope and target while deduplicating successful payloads',()=>{
  const call=(id,name,args)=>({role:'assistant',content:[{type:'toolCall',id,name,arguments:args}],timestamp:0});const result=(id,name,data,isError=false)=>({role:'toolResult',toolCallId:id,toolName:name,content:[{type:'text',text:JSON.stringify(data)}],isError,timestamp:0});
  const a={key:'A',silhouette:'old contour',features:[{key:'body',referenceObservation:'A reference'}]},b={key:'B',silhouette:'B contour',features:[{key:'body',referenceObservation:'B reference'}]},newA={...a,silhouette:'corrected A contour'};
  const messages=[call('p1','plan_object_structure',{objects:[a,b]}),result('p1','plan_object_structure',{objects:[a,b]}),call('p2','plan_object_structure',{objects:[newA]}),result('p2','plan_object_structure',{objects:[newA]}),result('quality','inspect_model_quality',{revision:1,scene:{issues:['old finding'],large:'geometry'.repeat(3000)}}),call('edit','edit_scene',{summary:'real mutation',operations:[{targetId:'keep-target'}]}),result('edit','edit_scene',{revision:2}),result('bind','bind_object_features',{objects:[{key:'B',componentId:'B',features:[{key:'body',nodeIds:['all-real-ids'],referenceObservation:'B reference',status:'linked_needs_visual_review'}]}],issues:['must preserve']}),result('bind-again','bind_object_features',{objects:[{key:'B',componentId:'B',features:[{key:'body',nodeIds:['all-real-ids'],referenceObservation:'B reference',status:'linked_needs_visual_review'}]}],issues:['must preserve']}),result('err','inspect_model_quality',{error:'exact diagnostic'},true)];
  const before=JSON.stringify(messages),compacted=compactAgentContext(messages);assert.equal(JSON.stringify(messages),before);assert.deepEqual(compacted[0].content[0].arguments.objects,[b]);assert.deepEqual(compacted[2].content[0].arguments.objects,[newA]);assert.ok(!JSON.stringify(compacted).includes('geometrygeometry'));assert.ok(JSON.stringify(compacted).includes('all-real-ids'));assert.ok(JSON.stringify(compacted).includes('must preserve'));assert.deepEqual(compacted.at(-1),messages.at(-1));
  const scopes=Array.from({length:30},(_,i)=>({role:'toolResult',toolCallId:'scope'+i,toolName:'read_scene',isError:false,details:{revision:9,scopeKey:'component'+i,snapshot:true},content:[{type:'text',text:JSON.stringify({nodes:[{id:'part'+i}]})}],timestamp:0}));const kept=compactAgentContext(scopes);assert.ok(kept.every((m,i)=>JSON.stringify(m).includes('part'+i)));
 });
 await test('isolated diagnostic capture hides occluders without modifying scene or granting review evidence',async()=>{
  const initial=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'人物',sceneRole:'person',parts:[{name:'hand',geometry:{type:'sphere',params:{radius:.04}},materialId:'mat_gray',transform:{position:[0,1,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]},{op:'createAssembly',name:'occluder',sceneRole:'equipment',parts:[{name:'wall',geometry:{type:'box',params:{width:1,height:2,depth:.1}},materialId:'mat_gray',transform:{position:[0,1,1],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}]}).doc;
  const id=initial.nodes[0].id;let seen=[];const f=fake([[{name:'capture_detail_diagnostic',args:{targetIds:[id],views:['front','side']}}],[{name:'review_model',args:{summary:'isolated view',issues:[]}}],'诊断完成，仍待完整场景检查']);
  const r=await runModelingAgent({...opts(f,initial),text:'检查人物手部遮挡',capture:async(doc)=>{seen.push(doc.nodes.map(n=>n.id));return picture;}});
  assert.deepEqual(seen,[[id],[id]]);assert.deepEqual(r.result.doc.nodes,initial.nodes);const result=f.contexts.flatMap(c=>c.messages).filter(m=>m.role==='toolResult'&&m.toolName==='review_model');assert.ok(result.some(m=>m.isError));
 });
 await test('generic hand tool replaces only explicit hand parts and schedules real hand closeups',async()=>{
  const initial=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'任意人员',sceneRole:'person',parts:[{name:'hand',geometry:{type:'sphere',params:{radius:.04}},materialId:'mat_gray',transform:{position:[0,1,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}},{name:'torso',geometry:{type:'box',params:{width:.3,height:.5,depth:.2}},materialId:'mat_gray',transform:{position:[0,1,.3],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}]}).doc;
  const hand=initial.nodes[0],body=initial.nodes[1];let images=0;
  const f=fake([[{name:'create_hand_pose',args:{name:'右手',assemblyId:hand.assemblyId,materialId:hand.materialId,wrist:[0,1,0],forward:[0,0,-1],dorsal:[0,1,0],handedness:'right',pose:'point',replaceIds:[hand.id]}}],[{name:'capture_quality_review',args:{}}],'完成局部检查但尚未记录验收']);
  const r=await runModelingAgent({...opts(f,initial),text:'只调整这个人物的手部',capture:async()=>{images++;return picture;}});
  assert.equal(r.result.doc.nodes.length,2);assert.deepEqual(r.result.doc.nodes.find(n=>n.id===body.id),body);assert.equal(r.result.doc.nodes.find(n=>n.name.includes('articulated hand')).assemblyId,hand.assemblyId);assert.ok(images>=2);assert.ok(r.batch.incomplete);
 });
 await test('unified quality packet is reused until geometry or evidence changes',async()=>{
  const packet={name:'inspect_model_quality',args:{}};
  const f=fake([[edit,packet],[packet],context=>{
    const results=context.messages.filter(m=>m.role==='toolResult'&&m.toolName==='inspect_model_quality');
    assert.ok(JSON.stringify(results).includes('repeated'));assert.ok(JSON.stringify(results).includes('accepted\\":false')||JSON.stringify(results).includes('accepted'));
    return [{name:'edit_scene',args:{summary:'second generic solid',operations:[{...create,name:'second',transform:{...create.transform,position:[2,0,0]}}]}},packet];
  },context=>{const result=context.messages.filter(m=>m.role==='toolResult'&&m.toolName==='inspect_model_quality').at(-1);assert.ok(!JSON.stringify(result).includes('repeated'));return [{name:'submit_data_preview',args:{summary:'两件数据草稿，无视觉验收'}}]}]);
  const o=opts(f);o.captureAvailable=()=>false;const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.activity.quality.revision,r.result.doc.revision);assert.equal(r.activity.detailAcceptance.status,'pending');
 });
 await test('repeat scene inspections are compact and invalid geometry reports the failing part',async()=>{
  const bad={name:'edit_scene',args:{summary:'invalid lathe',operations:[{op:'createAssembly',name:'lamp',parts:[{name:'shade',geometry:{type:'lathe',params:{points:[[.1,0],[.05,.1]],segments:64,wallThickness:.2}}}]}]}};
  const f=fake([[edit,inspect],[inspect,bad],context=>{const raw=JSON.stringify(context);assert.ok(raw.includes('repeated'));const rejected=context.messages.find(m=>m.role==='toolResult'&&m.toolName==='edit_scene'&&m.isError);assert.ok(rejected);return [{name:'submit_data_preview',args:{summary:'保留未视觉验收模型'}}]}]);
  const o=opts(f);o.captureAvailable=()=>false;const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.activity.dataDraftSubmitted,true);
 });
 await test('real Pi loop plans, edits, receives screenshot, reviews on later turn and submits only preview',async()=>{const f=fake([[plan,edit,capture],[review,submit]]);const o=opts(f);let previews=0;o.onPreview=()=>previews++;const before=JSON.stringify(o.document);const result=await runModelingAgent(o);assert.equal(f.calls,2);assert.equal(previews,1);assert.equal(result.result.doc.nodes.length,1);assert.equal(JSON.stringify(o.document),before);assert.equal(result.activity.timings.filter(t=>t.kind==='model').length,2);assert.ok(result.activity.timings.every(t=>t.endedAt>=t.startedAt));assert.equal(result.activity.inputTokens,40);assert.equal(result.activity.outputTokens,20);assert.ok(f.contexts[1].messages.some(m=>m.role==='toolResult'&&m.content.some(c=>c.type==='image')));assert.ok(result.activity.events.some(e=>e.includes('等待你确认')))});
 await test('steering skips stale tool calls and delivers text plus reference before next model turn',async()=>{
   let control,received=[];
   const f=fake([()=>{assert.ok(control.steer('guide-1','先不要创建，请回答高度问题',[picture]));return [edit];},context=>{assert.ok(context.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('高度问题')));assert.ok(context.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('YWJj')));return '建议高度八米';}]);
   const o=opts(f);o.onControl=c=>control=c;o.onSteeringApplied=id=>received.push(id);
   const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,0);assert.deepEqual(received,['guide-1']);assert.equal(control,null);assert.match(r.batch.summary,/八米/);
 });
 await test('steering after an applied edit preserves draft and bypasses stale submit',async()=>{
   let control,queued=false;
   const f=fake([[edit,capture],context=>{const id=JSON.parse(context.messages.find(m=>m.role==='toolResult'&&m.toolName==='edit_scene').content[0].text).scene.nodes[0].id;return [{name:'edit_scene',args:{summary:'按新要求改名',operations:[{op:'rename',targetId:id,name:'用户新名称'}]}},capture];},[review,submit]]);
   const o=opts(f);o.onControl=c=>control=c;o.onPreview=()=>{if(!queued){queued=true;assert.ok(control.steer('guide-2','改名为用户新名称'));}};
   const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.result.doc.nodes[0].name,'用户新名称');assert.ok(r.activity.detailAcceptance.issues.length);
 });
 await test('a question during modeling can get an answer without looping away or losing the draft',async()=>{
   let control;const f=fake([[edit,capture],'建议高度八米，分四层']);const o=opts(f);o.onControl=c=>control=c;o.onPreview=()=>control.steer('question','先回答货架多高合适，不要继续建模');const r=await runModelingAgent(o);assert.equal(f.calls,2);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/建议高度八米/);
 });
 await test('multiple steering messages are delivered in order without dropping the newer request',async()=>{
   let control;const received=[];const f=fake([()=>{control.steer('one','高度八米');control.steer('two','纠正，高度九米');return '旧回答';},'收到八米',context=>{assert.match(JSON.stringify(context.messages),/高度九米/);return '按九米';}]);const o=opts(f);o.onControl=c=>control=c;o.onSteeringApplied=id=>received.push(id);const r=await runModelingAgent(o);assert.deepEqual(received,['one','two']);assert.match(r.batch.summary,/九米/);assert.equal(f.calls,3);
 });
 await test('explicit question mode blocks model edits and preserves the prior checkpoint',async()=>{
   let control,once=false;const f=fake([[edit,capture],[edit],'可以分四层']);const o=opts(f);o.onControl=c=>control=c;o.onPreview=()=>{if(!once){once=true;control.steer('q','应该分几层',[],'question');}};const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,1);assert.match(r.batch.summary,/分四层/);assert.ok(f.contexts[2].messages.some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m.content).includes('只提问')));
 });
 await test('measurable unmet user requirements block normal submission and retain an incomplete draft',async()=>{
   const req={name:'check_requirements',args:{items:[{quote:'六个货架',target:'货架',kind:'count',expected:'6'}]}};
   const f=fake([[req,{name:'edit_scene',args:{summary:'一组货架',operations:[{...create,name:'货架1'}]}},capture],[review,submit]]);const o=opts(f);o.text='六个货架';const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.activity.requirements.items[0].status,'mismatch');assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/需求不符/);
 });
 await test('complex plans accept more than six steps and equipment features without losing detail',async()=>{const complex={...plan,args:{...plan.args,steps:Array.from({length:12},(_,i)=>'步骤'+i),design:{...design,equipment:[{name:'设备',count:20,features:Array.from({length:14},(_,i)=>'结构特征'+i)}]}}};const f=fake([[complex,edit,capture],[review,submit]]);const r=await runModelingAgent(opts(f));assert.equal(r.activity.plan.length,12);assert.equal(r.activity.design.equipment[0].features.length,14);assert.equal(r.result.doc.nodes.length,1);assert.ok(r.activity.detailAcceptance.issues.length)});
 await test('oversized plan gets concise corrective feedback then can recover with a valid plan',async()=>{const invalid={...plan,args:{...plan.args,steps:Array(25).fill('过多步骤')}};const f=fake([[invalid],context=>{const err=context.messages.find(m=>m.role==='toolResult'&&m.isError);assert.match(JSON.stringify(err.content),/最多24/);assert.ok(!JSON.stringify(err.content).includes('Received arguments'));return [plan,edit,capture];},[review,submit]]);const r=await runModelingAgent(opts(f));assert.ok(r.activity.detailAcceptance.issues.length);assert.equal(r.result.doc.nodes.length,1)});
 await test('failed planning reports actual validation cause rather than unsupported-model speculation',async()=>{const invalid={...plan,args:{...plan.args,steps:Array(25).fill('过多步骤')}};const f=fake(Array(8).fill([invalid]));await assert.rejects(()=>runModelingAgent(opts(f)),/plan_model.*Validation/);assert.ok(f.calls<=4)});
 await test('conversation animation config previews sampled motion then submits an undoable program',async()=>{const d=applyBatch(createInitialDoc(),{operations:[create]}).doc;const animation={version:1,name:'物料输送',duration:8,loop:true,tracks:[{id:'move',name:'移动',targetIds:[d.nodes[0].id],channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:4,value:[2,0,0]},{time:8,value:[0,0,0]}]}]};const f=fake([[plan,{name:'edit_scene',args:{summary:'让物料移动',operations:[{op:'setAnimation',animation}]}},{name:'preview_animation',args:{}}],[review,submit]]);const o=opts(f,d);const times=[];o.capture=async(_d,_v,_ids,time)=>{times.push(time);return picture};const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,undefined);assert.deepEqual(r.result.doc.nodes,d.nodes);assert.ok(r.result.doc.animation);assert.equal(times.length,3);assert.ok(times.some(t=>t>0));assert.equal(d.animation,undefined)});
 await test('animation submit requires motion samples and animated targets obey selected scope',async()=>{const d=applyBatch(createInitialDoc(),{operations:[create,{...create,name:'other'}]}).doc;const animation={version:1,name:'运动',duration:2,loop:true,tracks:[{id:'move',name:'移动',targetIds:[d.nodes[1].id],channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:2,value:[1,0,0]}]}]};const f=fake([[plan,{name:'edit_scene',args:{summary:'move',operations:[{op:'setAnimation',animation}]}}],'范围不足']);const o=opts(f,d);o.editScope={nodeIds:[d.nodes[0].id]};const r=await runModelingAgent(o);assert.equal(r.result.doc.animation,undefined);assert.ok(JSON.stringify(f.contexts[1]).includes('选中范围'));const f2=fake([[plan,{name:'edit_scene',args:{summary:'move',operations:[{op:'setAnimation',animation}]}},capture],[review,submit],'结束']);const r2=await runModelingAgent(opts(f2,d));assert.equal(r2.batch.incomplete,true);assert.ok(f2.contexts.some(c=>JSON.stringify(c).includes('preview_animation检查')))});
 await test('native animation tool is discoverable and completes after explicit recovery guidance',async()=>{const d=applyBatch(createInitialDoc(),{operations:[create]}).doc;const animation={summary:'让物料移动',name:'输送',duration:4,loop:true,tracks:[{id:'move',name:'移动',channel:'position',targetIds:[d.nodes[0].id],keyframes:[{time:0,value:[0,0,0]},{time:4,value:[2,0,0]}]}]};const f=fake([[plan,{name:'read_scene',args:{}}],[{name:'read_scene',args:{}}],[{name:'read_scene',args:{}}],context=>{return [{name:'configure_animation',args:animation},{name:'preview_animation',args:{}}];},[review,submit]]);const o=opts(f,d);o.text='让这个沙盘动起来';o.history=[{role:'assistant',text:'以前这个版本不支持动画，只能静态'}];const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,undefined);assert.ok(r.result.doc.animation);assert.deepEqual(r.result.doc.nodes,d.nodes);assert.ok(r.activity.events.some(e=>e.includes('configure_animation')))});
 await test('stalled animation request retains exact per-turn tool trace rather than opaque four-round error',async()=>{const f=fake(Array(10).fill([{name:'read_scene',args:{}}]));const o=opts(f);o.text='让场景动起来';await assert.rejects(()=>runModelingAgent(o),error=>error.message.includes('最近执行')&&error.message.includes('read_scene')&&error.message.includes('尚无动画配置'));assert.equal(f.calls,4)});
 await test('all-scene animation is permitted despite an unrelated highlighted object and stale scope history',async()=>{const d=applyBatch(createInitialDoc(),{operations:[{...create,name:'地面'}, {...create,name:'人物'}]}).doc;const animation={summary:'给人物增加动作',name:'人物动作',duration:4,loop:true,tracks:[{id:'person',name:'动作',channel:'rotation',targetIds:[d.nodes[1].id],axis:[0,0,1],pivot:[0,0,0],keyframes:[{time:0,value:0},{time:2,value:15},{time:4,value:0}]}]};const f=fake([[plan,{name:'read_scene',args:{}}],context=>{const scene=JSON.parse(context.messages.filter(m=>m.role==='toolResult'&&m.toolName==='read_scene').at(-1).content[0].text);assert.equal(scene.editingScope.mode,'all-scene');assert.ok(JSON.stringify(context).includes('高亮地面或其他对象不限制修改人物'));assert.ok(!JSON.stringify(context).includes('不能给未选中设备加动画'));assert.ok(!JSON.stringify(context).includes('禁止新建其他组件或修改未选中对象'));return [{name:'configure_animation',args:animation},{name:'preview_animation',args:{}}];},[review,submit]]);const o=opts(f,d);o.selection=[d.nodes[0].id];o.editScope={};o.text='开始给人物补动作';o.history=[{role:'assistant',text:'当前选中地面，必须切换范围才能改人物'}];const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,undefined);assert.deepEqual(r.result.doc.animation.tracks[0].targetIds,[d.nodes[1].id]);assert.deepEqual(r.result.doc.nodes,d.nodes);});
 await test('component detail reads remain available together and count as bounded preparation progress',async()=>{const d=applyBatch(createInitialDoc(),{operations:Array.from({length:6},(_,i)=>({op:'createAssembly',name:'人物'+i,parts:[{name:'手臂'+i,geometry:create.geometry,transform:create.transform}]}))}).doc;const ids=d.nodes.map(n=>n.assemblyId);const f=fake([[plan],...ids.map(assemblyId=>[{name:'read_scene',args:{assemblyId}}]),context=>{const reads=context.messages.filter(m=>m.role==='toolResult'&&m.toolName==='read_scene'&&!m.isError);assert.equal(reads.length,6);for(const r of reads)assert.equal(JSON.parse(r.content[0].text).nodes.length,1);return [{name:'configure_animation',args:{summary:'补充全部人物动作',name:'人物动作',duration:4,loop:true,tracks:[{id:'move',name:'move',targetIds:d.nodes.map(n=>n.id),channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:4,value:[0,.1,0]}]}]}},{name:'preview_animation',args:{}}];},[review,submit]]);const o=opts(f,d);o.text='开始吧';o.history=[{role:'user',text:'人物怎么没有动，给他们补上手臂动作'},{role:'assistant',text:'可以补充人物动作'}];const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,undefined);assert.equal(f.calls,9);assert.ok(r.activity.events.some(e=>e.includes('read_scene(组件:')))});
 await test('context compaction keeps distinct current-revision scopes and expires them only after a real edit',()=>{const result=(id,scope,revision,snapshot=true)=>({role:'toolResult',toolName:'read_scene',toolCallId:id,isError:false,details:{scopeKey:scope,revision,snapshot},content:[{type:'text',text:JSON.stringify(snapshot?{nodes:[{id:scope+'-part'}]}:{repeated:true})}],timestamp:0});const messages=[result('a','person-A',3),result('b','person-B',3),result('a2','person-A',3,false)];let compact=compactAgentContext(messages);assert.ok(compact[0].content[0].text.includes('person-A-part'));assert.ok(compact[1].content[0].text.includes('person-B-part'));compact=compactAgentContext([...messages,{role:'toolResult',toolName:'configure_animation',toolCallId:'edit',isError:false,details:{revision:4},content:[{type:'text',text:'new scene'}],timestamp:0}]);assert.ok(!compact[0].content[0].text.includes('person-A-part'));assert.ok(!compact[1].content[0].text.includes('person-B-part'));});
 await test('read_scene unions assembly and explicit nodes instead of rejecting valid combined selectors',async()=>{const d=applyBatch(createInitialDoc(),{operations:['A','B'].map(name=>({op:'createAssembly',name,parts:[{name:'body',geometry:create.geometry,transform:create.transform},{name:'arm',geometry:create.geometry,transform:create.transform}]}))}).doc;const assemblyId=d.nodes[0].assemblyId;const f=fake([[plan,{name:'read_scene',args:{assemblyId,nodeIds:[d.nodes[0].id,d.nodes[2].id]}}],context=>{const result=context.messages.find(m=>m.role==='toolResult'&&m.toolName==='read_scene');assert.equal(result.isError,false);const data=JSON.parse(result.content[0].text);assert.equal(data.nodes.length,3);assert.equal(new Set(data.nodes.map(n=>n.id)).size,3);return '已读取组件及额外节点';}]);const r=await runModelingAgent(opts(f,d));assert.equal(r.batch.operations.length,0);assert.deepEqual(r.result.doc,d);});
 await test('several read errors in one turn allow a correction turn instead of immediate circuit break',async()=>{const d=applyBatch(createInitialDoc(),{operations:[create]}).doc;const invalid={name:'read_scene',args:{assemblyId:'missing'}};const f=fake([[plan],[invalid,invalid,invalid],context=>{assert.equal(context.messages.filter(m=>m.role==='toolResult'&&m.isError).length,3);return [{name:'read_scene',args:{nodeIds:[d.nodes[0].id]}},{name:'configure_animation',args:{summary:'移动',name:'move',duration:4,loop:true,tracks:[{id:'move',name:'move',targetIds:[d.nodes[0].id],channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:4,value:[1,0,0]}]}]}},{name:'preview_animation',args:{}}];},[review,submit]]);const r=await runModelingAgent(opts(f,d));assert.equal(r.batch.incomplete,undefined);assert.equal(r.activity.timings.filter(t=>t.failed).length,3);assert.ok(r.result.doc.animation);});
 await test('multi-turn correction retains IDs and all steps undo as one transaction',async()=>{let current;const f=fake([[plan,edit,capture],()=>[{...review,args:{...review.args,issues:['主体偏高']}},{name:'edit_scene',args:{summary:'降低主体',operations:[{op:'setTransform',targetId:current.nodes[0].id,transform:{scale:[1,.8,1]}}]}},capture],[review,submit]]);const o=opts(f);o.onPreview=d=>current=d;const result=await runModelingAgent(o);assert.equal(result.result.doc.nodes[0].transform.scale[1],.8);store.setState({doc:o.document,past:[],future:[],aiStatus:'previewing',pendingBatch:result.batch,pendingResult:result.result,previewDoc:result.result.doc,messages:[]});store.getState().confirmPending();assert.equal(store.getState().past.length,1);const id=store.getState().doc.nodes[0].id;store.getState().undo();assert.equal(store.getState().doc.nodes.length,0);store.getState().redo();assert.equal(store.getState().doc.nodes[0].id,id);assert.equal(store.getState().doc.nodes[0].transform.scale[1],.8)});
 await test('same-turn invented visual review is rejected',async()=>{const f=fake([[plan,edit,capture,review,submit],'finished']);const r=await runModelingAgent(opts(f));assert.equal(r.batch.incomplete,true);assert.equal(r.result.doc.nodes.length,1);const failures=f.contexts[1].messages.filter(m=>m.role==='toolResult'&&m.isError);assert.ok(failures.some(m=>JSON.stringify(m.content).includes('下一轮')))});
 await test('editing after review requires fresh screenshot and review',async()=>{let current;const f=fake([[plan,edit,capture],()=>[review,{name:'edit_scene',args:{summary:'move',operations:[{op:'translate',targetId:current.nodes[0].id,space:'world',mode:'delta',value:[1,0,0]}]}},submit],'done']);const o=opts(f);o.onPreview=d=>current=d;const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,true);assert.equal(r.result.doc.nodes.length,1)});
 await test('capture failure cannot claim a visually checked preview',async()=>{const f=fake([[plan,edit,capture],[review,submit],'done']);const o=opts(f);o.capture=async()=>{throw new Error('webgl unavailable')};const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,true);assert.equal(r.result.doc.nodes.length,1)});
 await test('latest review problems cannot silently disappear from submitted summary',async()=>{const f=fake([[plan,edit,capture],[{...review,args:{...review.args,issues:['背面未还原']}},submit]]);const r=await runModelingAgent(opts(f));assert.match(r.batch.summary,/背面未还原/)});
 await test('clarification makes no scene changes',async()=>{const f=fake(['请提供实际宽度']);const r=await runModelingAgent(opts(f));assert.equal(r.batch.operations.length,0);assert.equal(r.batch.summary,'请提供实际宽度')});
 await test('repeated scene reads stop after four no-progress turns',async()=>{const f=fake(Array(20).fill([{name:'read_scene',args:{}}]));await assert.rejects(()=>runModelingAgent(opts(f)));assert.equal(f.calls,4)});
 await test('Pi edit_scene rejects manual editSelection alone or mixed with valid commands without budget bypass',async()=>{
  const base=applyBatch(createInitialDoc(),{operations:[create]}).doc,id=base.nodes[0].id,manual={op:'editSelection',targetIds:[id],change:{kind:'color',value:'#123456'}};
  for(const operations of [[manual],[{op:'rename',targetId:id,name:'must roll back'},manual]]){
   const f=fake([[{name:'edit_scene',args:{summary:'manual-only command attempt',operations}}],'不支持该命令']);const r=await runModelingAgent(opts(f,base));assert.deepEqual(r.result.doc,base);assert.equal(r.result.applied.length,0);assert.ok(f.contexts[1].messages.some(m=>m.role==='toolResult'&&m.isError));
  }
 });
 await test('invalid command in group refuses entire group and leaves base untouched',async()=>{const f=fake([[plan,{name:'edit_scene',args:{summary:'invalid',operations:[create,{op:'execute_shell',command:'bad'}]}}],'不支持该命令']);const o=opts(f);const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,0);assert.ok(f.contexts[1].messages.some(m=>m.role==='toolResult'&&m.isError))});
 await test('cancellation during capture prevents completion and later draft callbacks',async()=>{const f=fake([[plan,edit,capture],[review,submit]]);const ctrl=new AbortController();let release;const o=opts(f);o.signal=ctrl.signal;o.capture=()=>new Promise(r=>release=r);const promise=runModelingAgent(o);while(!release)await new Promise(r=>setTimeout(r,1));ctrl.abort();release(picture);await assert.rejects(()=>promise,/停止/);assert.equal(o.document.nodes.length,0);assert.equal(f.calls,1)});
 await test('mesh tool routes actual catalogue geometry through scope-checked preview without raw vertices in model context',async()=>{
   const fs=await import('node:fs');const oldFetch=globalThis.fetch;globalThis.fetch=async url=>new Response(fs.readFileSync('public'+url));
   try{const f=fake([[{name:'list_mesh_components',args:{}},plan,{name:'add_mesh_component',args:{key:'vmc',name:'精细立加',position:[0,0,0]}},{name:'add_mesh_component',args:{key:'production-worker',name:'生产人员',position:[1.45,0,1.5]}}],[{name:'inspect_scene',args:{}},{name:'submit_data_preview',args:{summary:'已放置机床和生产人员，未视觉验收'}}]]);const o=opts(f);o.captureAvailable=()=>false;const result=await runModelingAgent(o);assert.ok(result.result.doc.nodes.length>140);assert.equal(new Set(result.result.doc.nodes.map(n=>n.assemblyId)).size,2);assert.ok(result.result.doc.nodes.every(n=>n.geometry.type==='mesh'));assert.ok(result.batch.incomplete);assert.doesNotMatch(JSON.stringify(f.contexts),/indices\\?":\s*\[/);assert.equal(o.document.nodes.length,0);
   const base=result.result.doc;const scoped=fake([[{name:'add_mesh_component',args:{key:'hmc',name:'越界新设备',position:[4,0,0]}}],'局部范围不允许新增']);const scopedOpts=opts(scoped,base);scopedOpts.editScope={nodeIds:[base.nodes[0].id]};const blocked=await runModelingAgent(scopedOpts);assert.equal(blocked.result.doc.nodes.length,base.nodes.length);assert.equal(blocked.batch.operations.length,0);
   }finally{globalThis.fetch=oldFetch;}
 });
 await test('general detail audit closes only after actual latest capture and all six evidenced criteria',async()=>{
 const keys=['silhouette','structure','connections','materials','details','context'];
 const f=fake([[edit,{name:'capture_multiview',args:{views:['front','back']}}],ctx=>{const node=JSON.parse(ctx.messages.find(m=>m.role==='toolResult'&&m.toolName==='edit_scene').content[0].text).scene.nodes[0];return [{name:'audit_model_detail',args:{componentId:node.id,checks:keys.map(criterion=>({criterion,status:'pass',evidence:'测试截图中核对当前对象的形体与表面',nodeIds:[node.id]}))}},review,submit]}]);const result=await runModelingAgent(opts(f));assert.equal(result.activity.detailAcceptance.status,'self_reviewed');assert.ok(result.batch.qualityIssues.some(x=>x.includes('参考图尚未拆解')));
 });
 await test('detail audit cannot fabricate pass without a screenshot or same-turn image reading',async()=>{
 const keys=['silhouette','structure','connections','materials','details','context'];const f=fake([[edit],ctx=>{const node=JSON.parse(ctx.messages.find(m=>m.role==='toolResult'&&m.toolName==='edit_scene').content[0].text).scene.nodes[0];return [{name:'audit_model_detail',args:{componentId:node.id,checks:keys.map(criterion=>({criterion,status:'pass',evidence:'企图无截图声称通过的测试',nodeIds:[node.id]}))}},capture]},[review,submit]]);const result=await runModelingAgent(opts(f));assert.equal(result.activity.detailAcceptance.status,'pending');assert.ok(f.contexts.some(c=>c.messages.some(m=>m.role==='toolResult'&&m.isError&&m.toolName==='audit_model_detail')));
 });
 await test('continuing a pending draft retains its original quality baseline so unchanged geometry can be audited',async()=>{
 const original=createInitialDoc(),working=applyBatch(original,{operations:[create]}).doc,id=working.nodes[0].id;const keys=['silhouette','structure','connections','materials','details','context'];
 const f=fake([[{name:'edit_scene',args:{summary:'整理名称',operations:[{op:'rename',targetId:id,name:'待验收模型'}]}},{name:'capture_multiview',args:{views:['front','back']}}],[{name:'audit_model_detail',args:{componentId:id,checks:keys.map(criterion=>({criterion,status:'pass',evidence:'依据最新截图核对已生成的当前模型',nodeIds:[id]}))}},review,submit]]);const o=opts(f,working);o.qualityBaseline=original;const r=await runModelingAgent(o);assert.equal(r.activity.detailAcceptance.targets.length,1);assert.equal(r.activity.detailAcceptance.status,'self_reviewed');assert.equal(r.batch.incomplete,undefined);
 });
 await test('multi-view failed detail repair invalidates old evidence and requires fresh two-view recheck',async()=>{
  let d;const keys=['silhouette','structure','connections','materials','details','context'];
  const audit=status=>({name:'audit_model_detail',args:{componentId:d.nodes[0].id,checks:keys.map(criterion=>({criterion,status:criterion==='silhouette'?status:'pass',evidence:status==='fail'?'近景主体比例需要修正':'已读取当前正反面并核对具体轮廓',nodeIds:[d.nodes[0].id]}))}});
  const multi={name:'capture_multiview',args:{views:['front','back']}};
  const f=fake([[edit,multi],()=>[audit('fail'),{name:'edit_scene',args:{summary:'修正比例',operations:[{op:'setTransform',targetId:d.nodes[0].id,transform:{scale:[1,.8,1]}}]}},audit('pass')],context=>{assert.ok(context.messages.some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m.content).includes('近景')));return [multi]},()=>[audit('pass'),review,submit]]);
  const o=opts(f);o.onPreview=x=>d=x;const captures=[];o.capture=async(doc,view)=>{captures.push([doc.revision,view]);return picture};
  const r=await runModelingAgent(o);assert.equal(r.activity.detailAcceptance.status,'self_reviewed');assert.ok(r.batch.qualityIssues.some(x=>x.includes('参考图尚未拆解')));assert.equal(captures.length,4);assert.notEqual(captures[0][0],captures[2][0]);assert.equal(r.result.doc.nodes[0].transform.scale[1],.8);
 });
 await test('parallel experiment isolates child context, merges once and counts all model usage',async()=>{
  const items=['设备甲','设备乙'].map((name,i)=>({name,brief:'创建一个尺寸准确并且包含真实主体结构的独立测试设备',position:[i*2,0,0]}));
  const f=fake([[{name:'build_components_parallel',args:{style:'统一米制尺度',items}}],[{name:'submit_data_preview',args:{summary:'两组件数据完成，视觉检查待做'}}]]);const children=[];const o=opts(f);o.captureAvailable=()=>false;o.config={...cfg,parallelDrafts:true};o.history=[{role:'user',text:'只属于主代理的历史上下文标记'}];o.workerStreamFn=name=>{const child=fake([ctx=>{assert.ok(!JSON.stringify(ctx).includes('只属于主代理的历史上下文标记'));const tools=ctx.messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded??[]);assert.ok(!tools.some(t=>t.name==='build_components_parallel'));return [{name:'edit_scene',args:{summary:'独立部件',operations:[{...create,name}]}},{name:'submit_data_preview',args:{summary:'独立数据已完成，未视觉验收'}}]}]);children.push(child);return child.fn};let previews=0;o.onPreview=()=>previews++;const r=await runModelingAgent(o);assert.equal(children.length,2);assert.equal(previews,1);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.result.doc.nodes[1].transform.position[0],2);assert.equal(r.activity.inputTokens+r.activity.outputTokens,120);assert.equal(r.activity.parallelRuns.length,2);assert.ok(r.activity.parallelRuns.every(x=>x.status==='done'&&x.rounds===1&&x.toolCalls===2));assert.equal(r.activity.usageIncomplete,false);assert.equal(r.activity.detailAcceptance.status,'pending');assert.equal(r.batch.incomplete,true);
 });
 await test('parallel tool remains absent by default, in workers and in restricted edit scopes',async()=>{
  for(const variant of [{config:cfg},{config:{...cfg,parallelDrafts:true},workerTask:true},{config:{...cfg,parallelDrafts:true},editScope:{nodeIds:[]}}]){const f=fake([ctx=>{const tools=ctx.messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded??[]);assert.ok(!tools.some(t=>t.name==='build_components_parallel'));return '仅回答'}]);const o={...opts(f),...variant};await runModelingAgent(o);}
 });
 await test('failed child never masquerades as merged data and reported token totals are retained',async()=>{
  const items=['成功组件','失败组件'].map((name,i)=>({name,brief:'创建具有明确比例及真实结构细节的独立测试组件',position:[i*2,0,0]}));const f=fake([[{name:'build_components_parallel',args:{style:'统一风格',items}}],'一个子任务尚未完成']);const o=opts(f);o.config={...cfg,parallelDrafts:true};o.captureAvailable=()=>false;o.workerStreamFn=name=>fake([name==='成功组件'?[edit,{name:'submit_data_preview',args:{summary:'数据已完成'}}]:'未生成组件']).fn;const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.activity.parallelRuns[1].status,'failed');assert.equal(r.activity.inputTokens+r.activity.outputTokens,120);assert.equal(r.activity.usageIncomplete,true);assert.ok(r.batch.incomplete);
 });
 await test('stopping parallel generation never merges late child drafts',async()=>{
  const items=['甲','乙'].map((name,i)=>({name,brief:'创建具有明确比例及真实结构细节的独立测试组件',position:[i*2,0,0]}));const f=fake([[{name:'build_components_parallel',args:{style:'统一风格',items}}]]),c=new AbortController();const o=opts(f);o.config={...cfg,parallelDrafts:true};o.signal=c.signal;o.workerStreamFn=()=>fake([[edit,{name:'submit_data_preview',args:{summary:'数据已完成'}}]]).fn;let previews=0;o.onPreview=()=>previews++;o.onActivity=a=>{if(a.parallelRuns?.some(r=>r.status==='running'))c.abort()};await assert.rejects(()=>runModelingAgent(o));assert.equal(previews,0);assert.equal(o.document.nodes.length,0);
 });
 await test('batch detailed placement creates both components in one atomic preview and targeted reads stay compact',async()=>{
 const fs=await import('node:fs'),old=globalThis.fetch;globalThis.fetch=async url=>new Response(fs.readFileSync('public'+url));try{const f=fake([[plan,{name:'add_mesh_components',args:{items:[{key:'vmc',name:'立加',position:[0,0,0]},{key:'production-worker',name:'生产人员',position:[1.45,0,1.5]}]}}],[{name:'find_scene_parts',args:{terms:['pendant','hand'],limit:4}},{name:'submit_data_preview',args:{summary:'已建立两组件，未视觉验收'}}]]);const o=opts(f);o.captureAvailable=()=>false;let previews=0;o.onPreview=()=>previews++;const r=await runModelingAgent(o);assert.equal(previews,1);assert.equal(new Set(r.result.doc.nodes.map(n=>n.assemblyId)).size,2);assert.equal(r.batch.operations.length,2);const context=f.contexts[1];assert.doesNotMatch(JSON.stringify(context),/uvs\\?":\s*\[/);assert.ok(r.batch.incomplete);}finally{globalThis.fetch=old;}
 });
 await test('older large part snapshots keep IDs and transforms while removing redundant descriptions',()=>{
 const nodes=Array.from({length:40},(_,i)=>({id:'part-'+i,name:'part '+i,position:[i,0,0],desc:'geometry '.repeat(100)}));const messages=[{role:'toolResult',toolCallId:'large',toolName:'read_scene',content:[{type:'text',text:JSON.stringify({revision:3,nodes})}],details:{revision:3,scopeKey:'assembly:A',snapshot:true},isError:false,timestamp:0},{role:'toolResult',toolCallId:'small',toolName:'find_scene_parts',content:[{type:'text',text:'latest query'}],details:{revision:3,scopeKey:'parts:B',snapshot:true},isError:false,timestamp:0}];const result=compactAgentContext(messages);const data=JSON.parse(result[0].content[0].text);assert.equal(data.nodes.length,40);assert.equal(data.nodes[30].id,'part-30');assert.deepEqual(data.nodes[30].position,[30,0,0]);assert.ok(data.detailOmitted);assert.ok(JSON.stringify(result).length<JSON.stringify(messages).length*.2);
 });
 await test('unavailable rendering automatically leaves detail checks pending without exposing repetitive unknown-audit calls',async()=>{const f=fake([context=>{const tools=context.messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded??[]);assert.ok(!tools.some(t=>t.name==='audit_model_detail'));return [edit,{name:'submit_data_preview',args:{summary:'数据草稿完成，视觉待检查'}}];}]);const o=opts(f);o.captureAvailable=()=>false;const r=await runModelingAgent(o);assert.equal(f.calls,1);assert.equal(r.activity.detailAcceptance.status,'pending');assert.ok(r.batch.incomplete);});
 await test('typed component movement uses explicit deltas and rejects duplicate group movement atomically',async()=>{const d=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'设备',parts:[{name:'a',geometry:create.geometry,transform:create.transform},{name:'b',geometry:create.geometry,transform:{...create.transform,position:[0,1,0]}}]}]}).doc;const call={name:'move_components',args:{items:[{targetId:d.nodes[0].id,delta:[2,0,0]}]}};const f=fake([[call,{name:'submit_data_preview',args:{summary:'组件平移已完成，位置待视觉核对'}}]]);const o=opts(f,d);o.captureAvailable=()=>false;const r=await runModelingAgent(o);assert.ok(r.result.doc.nodes.every(n=>n.transform.position[0]===2));const duplicate=fake([[{name:'move_components',args:{items:[...call.args.items,{targetId:d.nodes[1].id,delta:[3,0,0]}]}}],'重复组件已拒绝']);const rr=await runModelingAgent(opts(duplicate,d));assert.deepEqual(rr.result.doc,d);assert.equal(rr.batch.operations.length,0);});
 await test('production Pi OpenAI adapter sends native tool schema and returns screenshot for the next request',async()=>{
   let wire=[];globalThis.fetch=async(url,init)=>{if(forceTransportError)throw new Error('本站模型代理响应异常（HTTP 403）。访问会话已失效');const body=JSON.parse(init.body);wire.push(body);const actions=wire.length===1?[plan,edit,capture]:[review,submit];const tc=actions.map((a,i)=>({index:i,id:`wire_${wire.length}_${i}`,type:'function',function:{name:a.name,arguments:JSON.stringify(a.args)}}));const raw='data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:tc},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'test',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:30,completion_tokens:20,total_tokens:50}})+'\n\ndata: [DONE]\n\n';return new Response(raw,{headers:{'content-type':'text/event-stream'}})};
   const o=opts(fake([]));delete o.streamFn;const r=await runModelingAgent(o);assert.equal(wire.length,2);assert.ok(wire[0].tools.some(t=>t.function.name==='edit_scene'));assert.ok(wire.every(body=>body.tools.every(tool=>tool.type==='function')));assert.equal(wire[0].stream,true);assert.equal(wire[0].max_tokens,8192);assert.ok(JSON.stringify(wire[1].messages).includes('data:image/jpeg;base64,YWJj'));assert.equal(r.result.doc.nodes.length,1);assert.equal(r.activity.outputTokens,40);
   const unsupportedKeywords=value=>value!==null&&typeof value==='object'&&Object.entries(value).some(([key,child])=>/^~/.test(key)||key==='oneOf'||key==='uniqueItems'||(key==='items'&&Array.isArray(child))||unsupportedKeywords(child));
   const firstTools=wire[0].tools.map(tool=>tool.function);
   const editScene=firstTools.find(tool=>tool.name==='edit_scene');
   const program=firstTools.find(tool=>tool.name==='build_modeling_program');
   assert.ok(program?.parameters,'build_modeling_program must declare parameters');
   const position=program.parameters.properties.position;
   assert.ok(position,'build_modeling_program must declare position');
   assert.equal(position.items,false);
   assert.deepEqual(position.prefixItems,[{type:'number'},{type:'number'},{type:'number'}]);
   console.log('Pi reference-image tool declarations',JSON.stringify({names:firstTools.map(tool=>tool.name),count:firstTools.length,index25:firstTools[25]?.name??null,editSceneClean:!!editScene?.parameters&&!unsupportedKeywords(editScene.parameters)}));
   for(const body of wire)for(const {function:{name,parameters}} of body.tools){
    assert.ok(parameters,`${name} must declare its parameters`);
    assert.ok(!unsupportedKeywords(parameters),`${name} parameters contain TypeBox metadata, oneOf, uniqueItems, or tuple items arrays`);
   }
   assert.ok(wire.every(body=>!Object.hasOwn(body,'reasoning_effort')),'production default never sends off or an SDK-selected effort');
 });
 await test('draw-workshop wording is normalized only for outbound modeling messages',async()=>{
   const f=fake(['请确认车间的实际宽度']);const fn=f.fn;let seen=0;
   f.fn=async(model,context,options)=>{const users=JSON.stringify(context.messages.filter(m=>m.role==='user'));assert.match(users,/帮我构建一个金刚石选型车间的沙盘/);assert.doesNotMatch(users,/画一/);seen++;return fn(model,context,options);};
   const o=opts(f);o.text='帮我画一个金刚石选型车间的沙盘，车间内有20台金刚石选型器';const original=o.text;
   const r=await runModelingAgent(o);assert.equal(seen,1);assert.equal(o.text,original);assert.equal(r.result.doc.nodes.length,0);assert.equal(r.batch.summary,'请确认车间的实际宽度');
 });
 await test('modeling wording normalization preserves requirements, explicit raster intent and non-user data',()=>{
   const original='帮我画一个三维车间沙盘，20台设备，红色机器人，高度8米';
   const expected='帮我构建一个三维车间沙盘，20台设备，红色机器人，高度8米';
   assert.equal(normalizeModelingRequestText(original),expected);assert.equal(normalizeModelingRequestText(expected),expected);
   assert.equal(normalizeModelingRequestText('Draw a 3D workshop scene with 20 machines'),'build a 3D workshop scene with 20 machines');
   for(const text of ['画一张车间图片','draw an image of a workshop','帮我画一个小猫','把20台设备改成蓝色'])assert.equal(normalizeModelingRequestText(text),text);
   const image={type:'image',data:'original-image-data',mimeType:'image/jpeg'};
   const messages=[{role:'user',content:[{type:'text',text:original},image],timestamp:1},{role:'user',content:original,timestamp:2},{role:'assistant',content:[{type:'text',text:original}],timestamp:3}];
   const before=JSON.stringify(messages);const normalized=normalizeModelingRequestMessages(messages);
   assert.equal(JSON.stringify(messages),before);assert.equal(normalized[0].content[0].text,expected);assert.equal(normalized[0].content[1],image);assert.equal(normalized[1].content,expected);assert.equal(normalized[2],messages[2]);
 });
 await test('real SDK serializes the normalized scene instruction, preserving reference images and original input',async()=>{
   const {stream}=await import('@earendil-works/pi-ai/api/openai-completions');const wire=[];
   const fetch=async(url,init)=>{wire.push(JSON.parse(init.body));const raw='data: '+JSON.stringify({id:'normalized',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'请确认车间实际宽度'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'normalized',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';return new Response(raw,{headers:{'content-type':'text/event-stream'}});};
   const o=opts(fake([]));o.streamFn=(model,context,options)=>stream(model,context,{...options,apiKey:cfg.apiKey,fetch,maxTokens:8192});o.text='帮我画一个金刚石选型车间的沙盘，车间内有20台金刚石选型器';const original=o.text;await runModelingAgent(o);
   assert.equal(wire.length,1);const users=wire[0].messages.filter(m=>m.role==='user');assert.match(JSON.stringify(users),/帮我构建一个金刚石选型车间的沙盘/);assert.doesNotMatch(JSON.stringify(users),/画一/);assert.match(JSON.stringify(users),/20台金刚石选型器/);assert.match(JSON.stringify(users),/data:image\/jpeg;base64,YWJj/);assert.ok(wire[0].tools.some(t=>t.function.name==='edit_scene'));assert.equal(o.text,original);
 });
 await test('real SDK keeps explicit reasoning effort through tool turns and invocation config changes',async()=>{
   const {stream}=await import('@earendil-works/pi-ai/api/openai-completions');
   for(const reasoningEffort of [undefined,'low','medium','high','xhigh']) {
     const wire=[];const live={...cfg,reasoningEffort};
     const fetch=async(_url,init)=>{
       const body=JSON.parse(init.body);wire.push(body);live.reasoningEffort=reasoningEffort==='low'?'high':'low';
       const actions=wire.length===1?[edit]:[{name:'submit_data_preview',args:{summary:'数据完成，视觉检查待做'}}];
       const tool_calls=actions.map((a,i)=>({index:i,id:`effort_${wire.length}_${i}`,type:'function',function:{name:a.name,arguments:JSON.stringify(a.args)}}));
       const raw='data: '+JSON.stringify({id:'effort',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'effort',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n';
       return new Response(raw,{headers:{'content-type':'text/event-stream'}});
     };
     const o=opts(fake([]));o.config=live;o.captureAvailable=()=>false;
     o.streamFn=(model,context,options)=>stream(model,context,{...options,apiKey:cfg.apiKey,fetch,maxTokens:8192,maxRetries:0});
     const r=await runModelingAgent(o);assert.equal(wire.length,2);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.activity.dataDraftSubmitted,true);
     for(const body of wire) {
       assert.equal(body.reasoning_effort,reasoningEffort);assert.equal(Object.hasOwn(body,'reasoning_effort'),reasoningEffort!==undefined);
       assert.equal(body.max_tokens,8192);assert.equal(body.stream,true);assert.equal(body.store,undefined);assert.ok(body.tools.some(t=>t.function.name==='edit_scene'));
       assert.equal(Object.hasOwn(body,'thinking'),false);assert.equal(Object.hasOwn(body,'enable_thinking'),false);assert.equal(Object.hasOwn(body,'reasoning'),false);
     }
     assert.ok(wire[1].messages.some(m=>m.role==='tool'),'the second body is a real tool-result continuation');
   }
 });
 await test('real SDK parallel child bodies inherit the parent reasoning snapshot',async()=>{
   const {stream}=await import('@earendil-works/pi-ai/api/openai-completions');
   for(const reasoningEffort of [undefined,'high','xhigh']) {
     const wire=[],rounds=new Map();const live={...cfg,parallelDrafts:true,reasoningEffort};
     const items=['设备甲','设备乙'].map((name,i)=>({name,brief:'创建一个尺寸准确并且包含真实主体结构的独立测试设备',position:[i*2,0,0]}));
     const sdk=label=>(model,context,options)=>stream(model,context,{...options,apiKey:cfg.apiKey,maxTokens:8192,maxRetries:0,fetch:async(_url,init)=>{
       const body=JSON.parse(init.body);wire.push({label,body});const round=(rounds.get(label)??0)+1;rounds.set(label,round);live.reasoningEffort='low';
       const actions=label==='parent'?(round===1?[{name:'build_components_parallel',args:{style:'统一米制尺度',items}}]:[{name:'submit_data_preview',args:{summary:'两组件数据完成，视觉检查待做'}}]):(round===1?[{name:'edit_scene',args:{summary:'独立部件',operations:[{...create,name:label}]}}]:[{name:'submit_data_preview',args:{summary:'独立数据草稿，视觉检查待做'}}]);
       const tool_calls=actions.map((a,i)=>({index:i,id:`parallel_${label}_${round}_${i}`,type:'function',function:{name:a.name,arguments:JSON.stringify(a.args)}}));
       const raw='data: '+JSON.stringify({id:'parallel-effort',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'parallel-effort',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n';
       return new Response(raw,{headers:{'content-type':'text/event-stream'}});
     }});
     const o=opts(fake([]));o.config=live;o.captureAvailable=()=>false;o.streamFn=sdk('parent');o.workerStreamFn=sdk;
     const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.activity.dataDraftSubmitted,true);assert.equal(wire.length,6);
     assert.deepEqual([...rounds.keys()].sort(),['parent','设备乙','设备甲'].sort());assert.ok([...rounds.values()].every(n=>n===2));
     for(const {body} of wire){assert.equal(body.reasoning_effort,reasoningEffort);assert.equal(Object.hasOwn(body,'reasoning_effort'),reasoningEffort!==undefined);assert.equal(body.max_tokens,8192);}
   }
 });
 await test('reasoning payload overlay preserves existing async mutation and replacement hooks',async()=>{
   const {Agent}=await import('@earendil-works/pi-agent-core');const {stream}=await import('@earendil-works/pi-ai/api/openai-completions');
   const prompt=Agent.prototype.prompt;
   try {
     for(const reasoningEffort of [undefined,'xhigh'])for(const replace of [false,true]) {
       let hooked=0;const wire=[];
       Agent.prototype.prompt=function(...args){
         this.onPayload=async(payload,model)=>{hooked++;assert.equal(model.id,cfg.model);await Promise.resolve();const body=replace?{...payload}:payload;body.temperature=.17;body.reasoning_effort='off';body.hook_marker=replace?'replacement':'mutation';return replace?body:undefined;};
         return prompt.apply(this,args);
       };
       const o=opts(fake([]));o.config={...cfg,reasoningEffort};
       o.streamFn=(model,context,options)=>stream(model,context,{...options,apiKey:cfg.apiKey,maxTokens:8192,maxRetries:0,fetch:async(_url,init)=>{
         wire.push(JSON.parse(init.body));return new Response('data: '+JSON.stringify({id:'hook',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'请确认实际尺寸'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'hook',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
       }});
       await runModelingAgent(o);assert.equal(hooked,1);assert.equal(wire.length,1);assert.equal(wire[0].temperature,.17);assert.equal(wire[0].hook_marker,replace?'replacement':'mutation');assert.equal(wire[0].reasoning_effort,reasoningEffort);assert.equal(Object.hasOwn(wire[0],'reasoning_effort'),reasoningEffort!==undefined);assert.equal(wire[0].max_tokens,8192);
     }
   } finally {Agent.prototype.prompt=prompt;}
 });
 await test('unsupported explicit reasoning effort remains a visible failure without retry or silent downgrade',async()=>{
   const {stream}=await import('@earendil-works/pi-ai/api/openai-completions');let calls=0;
   const o=opts(fake([]));o.config={...cfg,reasoningEffort:'xhigh'};
   o.streamFn=(model,context,options)=>stream(model,context,{...options,apiKey:cfg.apiKey,maxTokens:8192,maxRetries:0,fetch:async(_url,init)=>{calls++;assert.equal(JSON.parse(init.body).reasoning_effort,'xhigh');return new Response(JSON.stringify({error:{message:'reasoning_effort xhigh is not supported'}}),{status:400,headers:{'content-type':'application/json'}});}});
   await assert.rejects(()=>runModelingAgent(o),/reasoning_effort xhigh is not supported/);assert.equal(calls,1);
 });
 await test('Pi preserves actionable transport error instead of generic SDK connection error',async()=>{
   forceTransportError=true;
   const o=opts(fake([]));delete o.streamFn;await assert.rejects(()=>runModelingAgent(o),/HTTP 403.*访问会话已失效/);forceTransportError=false;
 });
 await test('context pruning removes obsolete snapshots and images but preserves current scene, reference and errors',()=>{
   const result=(toolName,content,isError=false)=>({role:'toolResult',toolName,toolCallId:Math.random().toString(),content,isError,timestamp:0});
   const ref={role:'user',content:[{type:'image',data:'original-reference',mimeType:'image/jpeg'}],timestamp:0};
   const oldScene=result('edit_scene',[{type:'text',text:'old'.repeat(10000)}]);const latest=result('read_scene',[{type:'text',text:'current-ids-and-geometry'}]);
   const oldImage=result('capture_view',[{type:'text',text:'revision=1'},{type:'image',data:'old-image'.repeat(10000),mimeType:'image/jpeg'}]);
   const newImage=result('capture_view',[{type:'text',text:'revision=2'},{type:'image',data:'new-image',mimeType:'image/jpeg'}]);const err=result('edit_scene',[{type:'text',text:'important-error'}],true);
   const messages=[ref,oldScene,oldImage,latest,newImage,err];const before=JSON.stringify(messages);const pruned=compactAgentContext(messages);assert.equal(JSON.stringify(messages),before);assert.equal(pruned[0],ref);assert.equal(pruned[3],latest);assert.equal(pruned[4],newImage);assert.equal(pruned[5],err);assert.equal(pruned[1],oldScene);assert.ok(JSON.stringify(pruned).length<before.length/2);
 });
 await test('no-progress pause retains valid work without changing official scene',async()=>{const f=fake([[plan,edit],...Array(5).fill([{name:'read_scene',args:{}}])]);const o=opts(f);let checkpoint;o.onCheckpoint=r=>checkpoint=r;const r=await runModelingAgent(o);assert.equal(f.calls,5);assert.equal(r.batch.incomplete,true);assert.equal(r.batch.operations.length,1);assert.equal(o.document.nodes.length,0);assert.equal(checkpoint.result.doc.nodes.length,1);assert.ok(r.batch.continuation.includes('继续完成原任务'));});
 await test('productive generation continues beyond six rounds and edits past round five',async()=>{
   const edits=Array.from({length:8},(_,i)=>[{name:'edit_scene',args:{summary:'结构细化'+i,operations:[{...create,name:'部件'+i}]}}]);
   const f=fake([[plan,...edits[0]],...edits.slice(1),[capture],[review,submit]]);const r=await runModelingAgent(opts(f));
   assert.equal(f.calls,10);assert.equal(r.result.doc.nodes.length,8);assert.ok(r.activity.detailAcceptance.issues.length);assert.ok(!JSON.stringify(f.contexts[5]).includes('禁止编辑'));
 });
 await test('three failed tool turns pause with exact errors and retain successful draft',async()=>{
   const bad={name:'edit_scene',args:{summary:'bad',operations:[{op:'unsupported'}]}};
   const f=fake([[plan,edit],[bad],[bad],[bad],[edit]]);const r=await runModelingAgent(opts(f));
   assert.equal(f.calls,4);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/连续3轮/);assert.ok(r.activity.events.some(e=>/工具失败：edit_scene：.+/.test(e)),JSON.stringify(r.activity.events));
 });
 await test('more than three captures and eighteen tools remain possible with real progress',async()=>{
   const steps=[[plan,edit,capture]];for(let i=0;i<6;i++)steps.push([review,edit,capture]);steps.push([review,submit]);
   const f=fake(steps);const r=await runModelingAgent(opts(f));assert.equal(f.calls,8);assert.ok(r.activity.toolCalls>18);assert.equal(r.result.doc.nodes.length,7);assert.ok(r.activity.detailAcceptance.issues.length);
 });
 await test('plain text stop ends immediately with an unreviewed draft rather than restarting the model',async()=>{
   const f=fake([[plan,edit],'稍后继续',[capture],[review,submit]]);const r=await runModelingAgent(opts(f));assert.equal(f.calls,2);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/稍后继续/);
 });
 await test('network error after successful edit returns explicitly unfinished checkpoint',async()=>{const f=fake([[plan,edit]]);const o=opts(f);let calls=0;o.streamFn=async(...args)=>{if(calls++)throw new Error('gateway disconnected');return f.fn(...args)};const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/gateway disconnected/);assert.equal(o.document.nodes.length,0);});
 await test('existing legacy assembly context stays compact and detailed read remains editable',async()=>{const doc=applyBatch(createInitialDoc(),{operations:[{op:'createTemplate',templateId:'smt_mounter',parameters:{}}]}).doc;const f=fake([[{name:'read_scene',args:{}}],[{name:'read_scene',args:{assemblyId:doc.nodes[0].assemblyId}}],'现有组件可以继续编辑']);const r=await runModelingAgent(opts(f,doc));assert.equal(r.batch.operations.length,0);assert.equal(JSON.parse(f.contexts[1].messages.find(m=>m.role==='toolResult').content[0].text).nodes.length,1);assert.equal(JSON.parse(f.contexts[2].messages.filter(m=>m.role==='toolResult').at(-1).content[0].text).nodes.length,doc.nodes.length);});
 await test('AI template creation is refused without any scene side effects',async()=>{const f=fake([[plan,{name:'edit_scene',args:{summary:'preset',operations:[{op:'createTemplate',templateId:'smt_workshop',parameters:{}}]}}],'需要按描述规划工艺']);const r=await runModelingAgent(opts(f));assert.equal(r.result.doc.nodes.length,0);assert.equal(r.batch.operations.length,0);assert.ok(f.contexts[1].messages.some(m=>m.role==='toolResult'&&m.isError));});
 await test('generic and machining requests never create an automatic SMT baseline',async()=>{for(const text of ['做一个车间沙盘，有产线有设备操作人员','做一个机加工产线车间沙盘','生成一个 SMT 车间']){const f=fake(['需要按描述规划工艺']);const o=opts(f);o.text=text;o.images=[];let preview;o.onPreview=d=>preview=d;const r=await runModelingAgent(o);assert.equal(preview,undefined);assert.equal(r.result.doc.nodes.length,0);assert.equal(r.batch.operations.length,0);assert.ok(!JSON.stringify(f.contexts[0]).includes('A-04'));}});
 await test('free geometry path still works without injecting any preset',async()=>{const f=fake([[plan,edit,inspect,capture],[review,submit]]);const o=opts(f);o.text='做一个机加工产线车间沙盘';o.images=[];const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,1);assert.equal(r.batch.operations[0].op,'createPrimitive');assert.ok(!r.batch.summary.includes('以 SMT 示意车间为起点'));});
 await test('agent can generate a custom repeated assembly then review it without presets',async()=>{const f=fake([[plan,{name:'edit_scene',args:{summary:'自定义输送支架',operations:[{op:'createAssembly',name:'用户要求的支架',parts:[{name:'立柱',geometry:{type:'box',params:{width:.1,height:1,depth:.1}},transform:{position:[0,.5,0]},repeat:{count:8,step:[.5,0,0]}}]}]}},capture],[review,submit]]);const r=await runModelingAgent(opts(f));assert.equal(r.result.doc.nodes.length,8);assert.equal(r.batch.operations[0].op,'createAssembly');assert.equal(f.calls,2);});
 await test('older successful edit payloads are compacted with paired results, latest edits and failed calls preserved',()=>{
   const assistant=(id)=>({role:'assistant',content:[{type:'toolCall',id,name:'edit_scene',arguments:{summary:'主体细化',operations:Array(100).fill({op:'createPrimitive',name:'历史结构'.repeat(100)})}}],timestamp:0});
   const result=(id,isError=false)=>({role:'toolResult',toolName:'edit_scene',toolCallId:id,isError,content:[{type:'text',text:'真实ID与场景'}],timestamp:0});
   const messages=[assistant('old'),result('old'),assistant('failed'),result('failed',true),assistant('latest'),result('latest')];const before=JSON.stringify(messages),pruned=compactAgentContext(messages);
   assert.equal(JSON.stringify(messages),before);assert.ok(pruned[0].content[0].text.includes('已成功'));assert.ok(!pruned.some(m=>m.role==='toolResult'&&m.toolCallId==='old'));assert.ok(pruned.some(m=>m.role==='toolResult'&&m.toolCallId==='failed'));assert.ok(pruned.some(m=>m.role==='assistant'&&m.content.some(c=>c.type==='toolCall'&&c.id==='latest')));assert.ok(JSON.stringify(pruned).length<before.length*.75);
 });
 await test('overview omits unrelated part materials but scoped reads preserve exact material values',()=>{
 const initial=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'generic equipment',parts:['anchor','inner part'].map(name=>({name,geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_gray',transform:{position:[0,1,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}))}]}).doc;
 const doc={...initial,materials:[...initial.materials,{id:'inner-special',baseColor:'#fe0123',roughness:.73,metalness:.61}],nodes:initial.nodes.map((n,i)=>i?{...n,materialId:'inner-special'}:n)};const before=JSON.stringify(doc),overview=agentSceneContext(doc,[]),detail=agentSceneContext(doc,[],doc.nodes[0].assemblyId);assert.equal(overview.nodes.length,1);assert.ok(!overview.materials.some(m=>m.id==='inner-special'));assert.ok(detail.materials.some(m=>m.id==='inner-special'&&m.roughness===.73));assert.equal(JSON.stringify(doc),before);
 });
 await test('empty optional assembly ID remains a whole-scene capture and does not loop on submission',async()=>{
 const f=fake([[plan,edit,{name:'capture_view',args:{view:'perspective',scope:'scene',assemblyId:''}}],[review,submit]]);const r=await runModelingAgent(opts(f));assert.equal(f.calls,2);assert.ok(r.activity.events.some(e=>e.includes('全场景 / perspective')));assert.ok(!r.activity.events.some(e=>e.includes('工具失败：submit_preview')));
 });
 await test('focused capture uses real assembly IDs and cannot replace final whole-scene review',async()=>{
   const document=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'自定义架体',parts:[{name:'框',geometry:{type:'frame',params:{width:1,height:1,depth:.1,thickness:.05}},transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]}}]}]}).doc;
   const assemblyId=document.nodes[0].assemblyId;let focus;
   const f=fake([[plan,edit,{name:'capture_view',args:{view:'perspective',assemblyId}}],[review,submit,capture],[review,submit]]);const o=opts(f,document);o.capture=async(_d,_v,ids)=>{if(ids)focus=ids;return picture};const r=await runModelingAgent(o);
   assert.deepEqual(focus,[document.nodes[0].id]);assert.ok(r.activity.detailAcceptance.issues.length);assert.ok(f.contexts[2].messages.some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m.content).includes('全场景')));
 });
 await test('fresh view reviews each count as progress, allowing near-to-whole final review and submission',async()=>{
 const d=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'设备',parts:[{name:'body',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]}}]}]}).doc;const assemblyId=d.nodes[0].assemblyId;
 const near={name:'capture_view',args:{view:'perspective',scope:'assembly',assemblyId}},whole={name:'capture_view',args:{view:'perspective',scope:'scene'}},top={name:'capture_view',args:{view:'top',scope:'scene'}};
 const f=fake([[plan,edit,near],[review],[whole],[{name:'read_scene',args:{}}],[{name:'read_scene',args:{assemblyId}}],[review],[{name:'read_scene',args:{}}],[top],[review],[submit]]);const r=await runModelingAgent(opts(f,d));assert.equal(f.calls,10);assert.ok(r.activity.detailAcceptance.issues.length);assert.ok(r.activity.events.some(e=>e.includes('全场景 / perspective')));
 });
 await test('focused-only submit failure gives explicit scene capture recovery and then succeeds',async()=>{
 const d=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'设备',parts:[{name:'body',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]}}]}]}).doc;const assemblyId=d.nodes[0].assemblyId;
 const f=fake([[plan,edit,{name:'capture_view',args:{view:'perspective',assemblyId}}],[review,submit],context=>{const error=context.messages.filter(m=>m.role==='toolResult'&&m.isError).at(-1);assert.match(JSON.stringify(error.content),/scope/);assert.match(JSON.stringify(error.content),/设备近景/);return [{name:'capture_view',args:{view:'top',scope:'scene'}}];},[review,submit]]);const r=await runModelingAgent(opts(f,d));assert.ok(r.activity.detailAcceptance.issues.length);
 });
 await test('repeated reviews of the same version scope and view still stop without progress',async()=>{
 const f=fake([[plan,edit,capture],...Array(10).fill([review])]);const r=await runModelingAgent(opts(f));assert.equal(r.batch.incomplete,true);assert.ok(f.calls<=7);assert.match(r.batch.summary,/连续4轮/);
 });
 await test('whole-scene creation requires a design brief before any edit',async()=>{
   const basic={name:'plan_model',args:{steps:['建立车间'],assumptions:'未规划'}};
   const f=fake([[basic,edit],'需要补全设计方案']);const o=opts(f);o.text='做一个机加工车间';const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,0);assert.ok(f.contexts[1].messages.some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m.content).includes('design')));
 });
 await test('selection scope rejects an entire mixed-target edit batch without leaking partial changes',async()=>{
   const d=applyBatch(createInitialDoc(),{operations:[create,{...create,name:'other'}]}).doc;const wrong={name:'edit_scene',args:{summary:'改色',operations:[{op:'setAppearance',targetId:d.nodes[0].id,baseColor:'#123456'},{op:'setAppearance',targetId:d.nodes[1].id,baseColor:'#123456'}]}};
   const f=fake([[plan,wrong],'请扩大范围']);const o=opts(f,d);o.editScope={nodeIds:[d.nodes[0].id]};const r=await runModelingAgent(o);assert.deepEqual(r.result.doc,d);assert.ok(f.contexts[1].messages.some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m.content).includes('超出修改范围')));
 });
 await test('local color change respects frozen placement and preserves other objects',async()=>{
   const d=applyBatch(createInitialDoc(),{operations:[create,{...create,name:'other'}]}).doc;const f=fake([[plan,{name:'edit_scene',args:{summary:'改选中外壳颜色',operations:[{op:'setAppearance',targetId:d.nodes[0].id,baseColor:'#123456'}]}},capture],[review,submit]]);const o=opts(f,d);o.editScope={nodeIds:[d.nodes[0].id],lockPlacement:true};const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,undefined);assert.deepEqual(r.result.doc.nodes[1],d.nodes[1]);assert.deepEqual(r.result.doc.nodes[0].transform,d.nodes[0].transform);assert.deepEqual(r.batch.editScope,o.editScope);
 });
 await test('representative equipment can be duplicated before consolidated final review',async()=>{
   let preview;const assembly={name:'edit_scene',args:{summary:'代表设备',operations:[{op:'createAssembly',name:'自设计设备',parts:[{name:'结构',geometry:{type:'frame',params:{width:1,height:1,depth:.1,thickness:.05}}}]}]}};
   const f=fake([[plan,assembly],()=>[{name:'edit_scene',args:{summary:'布置同类',operations:[{op:'duplicateAssembly',targetId:preview.nodes[0].id,offset:[2,0,0]}]}},inspect,capture],[review,submit]]);const o=opts(f);o.text='做一个机加工车间';o.onPreview=d=>preview=d;const r=await runModelingAgent(o);assert.equal(r.result.doc.nodes.length,2);assert.ok(r.activity.detailAcceptance.issues.length);assert.equal(f.calls,3);assert.deepEqual(r.activity.design,design);
 });
 await test('whole scene cannot submit without checking the latest composition and shows inspection findings',async()=>{
   const f=fake([[plan,edit,capture],[review,submit,inspect],[submit]]);const o=opts(f);o.text='做一个机加工车间';const r=await runModelingAgent(o);assert.ok(r.activity.detailAcceptance.issues.length);assert.ok(f.contexts[2].messages.some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m.content).includes('inspect_scene')));assert.equal(r.activity.quality.revision,r.result.doc.revision);assert.ok(r.batch.summary.includes('设计清单未满足'));
 });
 await test('selected assembly accepts append then modification of the new part across model turns',async()=>{
  const d=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'基准组件',parts:[{name:'主体',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]}}]}]}).doc;let current;
  const append={name:'edit_scene',args:{summary:'追加部件',operations:[{op:'appendAssemblyParts',targetId:d.nodes[0].id,parts:[{name:'把手',geometry:{type:'capsule',params:{radius:.02,length:.3}},transform:{position:[.4,.7,.6]}}]}]}};
  const f=fake([[plan,append],()=>[{name:'edit_scene',args:{summary:'新部件改色',operations:[{op:'setAppearance',targetId:current.nodes.at(-1).id,baseColor:'#123456'}]}},capture],[review,submit]]);const o=opts(f,d);o.selection=[d.nodes[0].id];o.editScope={nodeIds:o.selection,allowAssemblyAdditions:true,lockPlacement:true};o.onPreview=v=>current=v;const r=await runModelingAgent(o);assert.ok(r.activity.detailAcceptance.issues.length);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.result.doc.nodes[1].assemblyId,d.nodes[0].assemblyId);assert.deepEqual(r.result.doc.nodes[0].transform,d.nodes[0].transform);
 });
 await test('whole-equipment selections stay compact while detailed part reads remain available',async()=>{
  const doc=applyBatch(createInitialDoc(),{operations:[{op:'createTemplate',templateId:'smt_mounter',parameters:{}}]}).doc;
  const f=fake([[{name:'read_scene',args:{}}],[{name:'read_scene',args:{assemblyId:doc.nodes[0].assemblyId}}],'已读取组件']);const o=opts(f,doc);o.selection=doc.nodes.map(n=>n.id);o.editScope={nodeIds:o.selection,allowAssemblyAdditions:true};await runModelingAgent(o);
  const overview=JSON.parse(f.contexts[1].messages.find(m=>m.role==='toolResult').content[0].text);assert.equal(overview.nodes.length,1);assert.equal(overview.selection.length,0);assert.equal(overview.selectedAssemblies.length,1);const detail=JSON.parse(f.contexts[2].messages.filter(m=>m.role==='toolResult').at(-1).content[0].text);assert.equal(detail.nodes.length,doc.nodes.length);
 });
 await test('metadata-only rename submits without mandatory plan or screenshots',async()=>{
  const d=applyBatch(createInitialDoc(),{operations:[create]}).doc;const f=fake([[{name:'edit_scene',args:{summary:'重命名',operations:[{op:'rename',targetId:d.nodes[0].id,name:'新名称'}]}},submit]]);const o=opts(f,d);o.capture=async()=>{throw new Error('unnecessary capture')};const r=await runModelingAgent(o);assert.equal(r.batch.incomplete,undefined);assert.equal(f.calls,1);assert.equal(r.result.doc.nodes[0].name,'新名称');assert.match(r.batch.summary,/非视觉修改/);
 });
 await test('single assembly appearance can submit after a focused review',async()=>{
  const d=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'设备',parts:[{name:'body',geometry:create.geometry,transform:create.transform}]}]}).doc;const f=fake([[{name:'edit_scene',args:{summary:'改色',operations:[{op:'setAppearance',targetId:d.nodes[0].id,baseColor:'#123456'}]}},{name:'capture_view',args:{view:'perspective',assemblyId:d.nodes[0].assemblyId}}],[review,submit]]);const r=await runModelingAgent(opts(f,d));assert.equal(r.batch.incomplete,undefined);assert.equal(f.calls,2);
 });
 await test('metadata after visual review does not invalidate already reviewed pixels',async()=>{
  let current;const f=fake([[plan,edit,capture],()=>[review,{name:'edit_scene',args:{summary:'改名',operations:[{op:'rename',targetId:current.nodes[0].id,name:'最终名称'}]}},submit]]);const o=opts(f);o.onPreview=d=>current=d;const r=await runModelingAgent(o);assert.ok(r.activity.detailAcceptance.issues.length);assert.equal(f.calls,2);assert.equal(r.result.doc.nodes[0].name,'最终名称');
 });
 await test('review policy distinguishes labels, shared materials, metadata and structural changes',async()=>{
  const {reviewRequirement}=await server.ssrLoadModule('/src/domain/reviewPolicy.ts');const d=applyBatch(createInitialDoc(),{operations:['A','B'].map(name=>({op:'createAssembly',name,parts:[{name:'body',geometry:create.geometry,materialId:'mat_white',transform:create.transform}]}))}).doc;
  const metadata=structuredClone(d);metadata.nodes[0].name='new';metadata.nodes[0].zone='zone';assert.equal(reviewRequirement(d,metadata).kind,'none');
  const label=structuredClone(d);label.nodes[0].label='display';assert.equal(reviewRequirement(d,label).kind,'local');
  const shared=structuredClone(d);shared.materials.find(m=>m.id==='mat_white').baseColor='#111111';assert.equal(reviewRequirement(d,shared).kind,'whole');
  const moved=structuredClone(d);moved.nodes[0].transform.position[0]+=1;assert.equal(reviewRequirement(d,moved).kind,'whole');
 });
 await test('normalization preserves exact instructions and quoted labels in user messages',()=>{
 for(const text of ['三维场景，原样保留画一个车间','Draw a workshop scene; keep this verbatim','三维标牌写“画一个车间”','三维标牌写「画一个车间」','三维标牌写`draw a scene`'])assert.equal(normalizeModelingRequestText(text),text);
 assert.equal(normalizeModelingRequestText('画一个三维场景，标牌写“画一个车间”'),'构建一个三维场景，标牌写“画一个车间”');
});
 await test('known unavailable renderer returns edits in one turn without capture review submit retries',async()=>{
 const f=fake([[plan,edit,capture,review,submit],...Array(5).fill([capture,review,submit])]);const o=opts(f);o.captureAvailable=()=>false;let captures=0;o.capture=async()=>{captures++;return picture};const r=await runModelingAgent(o);
 assert.equal(f.calls,1);assert.equal(captures,0);assert.equal(r.batch.incomplete,true);assert.equal(r.batch.operations.length,1);assert.equal(o.document.nodes.length,0);assert.match(r.batch.summary,/未经视觉验收/);assert.doesNotMatch(r.batch.summary,/连续4轮/);assert.ok(!r.activity.events.some(e=>e.startsWith('视觉检查')));
});
await test('unavailable renderer preserves all data edits and stops on a blocked visual attempt',async()=>{
 const f=fake([[edit,{name:'edit_scene',args:{summary:'second',operations:[{...create,name:'second'}]}}],[capture],[review,submit]]);const o=opts(f);o.captureAvailable=()=>false;const r=await runModelingAgent(o);assert.equal(f.calls,2);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.batch.incomplete,true);
});
await test('simple tabletop recolor with unavailable renderer finishes immediately and preserves every transform',async()=>{
 const d=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'工作台',parts:[{name:'台面',geometry:create.geometry,transform:create.transform},{name:'腿',geometry:create.geometry,transform:create.transform}]}]}).doc;
 const f=fake([[{name:'edit_scene',args:{summary:'仅台面改红',operations:[{op:'setAppearance',targetId:d.nodes[0].id,baseColor:'#ff0000'}]}},capture],[review,submit]]);const o=opts(f,d);o.captureAvailable=()=>false;o.text='只把刚才工作台的台面改为红色，保留全部尺寸和位置';const r=await runModelingAgent(o);
 assert.equal(f.calls,1);assert.equal(r.batch.incomplete,true);assert.deepEqual(r.result.doc.nodes.map(n=>n.transform),d.nodes.map(n=>n.transform));assert.deepEqual(r.result.doc.nodes.map(n=>n.geometry),d.nodes.map(n=>n.geometry));assert.equal(r.result.doc.nodes[1].materialId,d.nodes[1].materialId);assert.equal(r.result.doc.materials.find(m=>m.id===r.result.doc.nodes[0].materialId).baseColor,'#ff0000');
});
await test('unexpected renderer failure is latched after one attempt and blocks all following visual tools',async()=>{
 const f=fake([[edit,capture,capture,review,submit],[capture]]);const o=opts(f);let captures=0;o.capture=async()=>{captures++;throw new Error('WebGL context lost')};const r=await runModelingAgent(o);assert.equal(f.calls,1);assert.equal(captures,1);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/WebGL context lost/);assert.ok(!r.activity.events.some(e=>e.startsWith('视觉检查')));
});
await test('plain text without tools after a plan ends without four stagnant rounds or invented work',async()=>{
 const f=fake([[plan],'请先确认尺寸',edit]);const o=opts(f);o.text='创建动画';const r=await runModelingAgent(o);assert.equal(f.calls,2);assert.equal(r.batch.operations.length,0);assert.equal(r.batch.summary,'请先确认尺寸');
});
await test('natural table requirements pass in real tool schema while unavailable preview remains incomplete',async()=>{
 const quote='工作台长1.2米、宽0.8米、总高0.75米';const req={name:'check_requirements',args:{items:['length','width','height'].map((kind,i)=>({quote,target:'工作台',kind,expected:['1.2','.8','.75'][i]}))}};
 const f=fake([[req,{name:'edit_scene',args:{summary:'table',operations:[{op:'createPrimitive',name:'工作台',geometry:{type:'box',params:{width:1.2,depth:.8,height:.75}}}]}},req,capture],[review,submit]]);const o=opts(f);o.text=quote;o.captureAvailable=()=>false;const r=await runModelingAgent(o);assert.equal(f.calls,1);assert.ok(r.activity.requirements.items.every(r=>r.status==='pass'));assert.equal(r.batch.incomplete,true);
});
await test('unavailable visual tools are omitted from provider declarations but data tools remain',async()=>{
 const f=fake(['本轮仅答复']);const o=opts(f);o.captureAvailable=()=>false;await runModelingAgent(o);const names=f.contexts[0].messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded??[]).map(t=>t.name);assert.ok(names.includes('submit_data_preview'));assert.ok(names.includes('edit_scene'));for(const name of ['capture_view','preview_animation','review_model','submit_preview'])assert.ok(!names.includes(name));
});
await test('unavailable renderer completes multiple productive turns before explicit data submission',async()=>{
 const f=fake([[edit],[{name:'edit_scene',args:{summary:'second requested object',operations:[{...create,name:'second'}]}}],[{name:'submit_data_preview',args:{summary:'两个请求对象的数据已完成，待视觉检查'}}]]);const o=opts(f);o.captureAvailable=()=>false;const r=await runModelingAgent(o);assert.equal(f.calls,3);assert.equal(r.result.doc.nodes.length,2);assert.equal(r.batch.incomplete,true);assert.match(r.batch.summary,/两个请求对象/);assert.doesNotMatch(r.batch.summary,/连续4轮/);
});
await test('renderer recovery on the next task restores required capture and later-turn review',async()=>{
 const unavailable=fake([[edit,capture]]);const o=opts(unavailable);o.captureAvailable=()=>false;const stage=await runModelingAgent(o);
 const next=fake([[{name:'edit_scene',args:{summary:'recolor',operations:[{op:'setAppearance',targetId:stage.result.doc.nodes[0].id,baseColor:'#ff0000'}]}},capture],[review,submit]]);const ready=opts(next,stage.result.doc);ready.captureAvailable=()=>true;const r=await runModelingAgent(ready);assert.equal(next.calls,2);assert.equal(r.batch.incomplete,undefined);assert.ok(r.activity.events.some(e=>e.startsWith('视觉检查')));
});

 await test('automatic quality capture provides current whole and closeup evidence before later-turn review',async()=>{
  const f=fake([[edit,{name:'capture_quality_review',args:{}},review],[review,submit]]);const o=opts(f);const frames=[];o.capture=async(d,v,ids)=>{frames.push({revision:d.revision,v,ids});return picture;};const r=await runModelingAgent(o);
  assert.ok(new Set(frames.map(x=>x.v)).size>=2);assert.ok(frames.every(x=>x.ids?.length===r.result.doc.nodes.length));assert.equal(r.activity.generationReview.basicReviewCompleted,true);assert.ok(r.activity.timings.some(t=>t.label==='记录视觉检查'&&t.failed));assert.ok(r.activity.timings.some(t=>t.label==='记录视觉检查'&&!t.failed));assert.equal(r.activity.detailAcceptance.status,'pending');
 });
 await test('failed automatic capture cannot certify partial images as complete evidence',async()=>{
  const f=fake([[edit,{name:'capture_quality_review',args:{}}]]);const o=opts(f);let frames=0;o.capture=async()=>{if(++frames===2)throw Error('renderer failed');return picture;};const r=await runModelingAgent(o);assert.ok(r.batch.incomplete);assert.notEqual(r.activity.detailAcceptance.status,'self_reviewed');assert.ok(!r.activity.events.some(e=>e.startsWith('视觉检查')));
 });
 await test('asset and connection tool groups load only when requested without losing core edit and review',async()=>{
 const f=fake([context=>{const tools=context.messages.find(m=>m.role==='system').toolsAdded;assert.ok(!tools.some(t=>t.name==='add_saved_assets'));assert.ok(!tools.some(t=>t.name==='connect_scene_parts'));assert.ok(tools.some(t=>t.name==='edit_scene'));return [{name:'enable_modeling_tools',args:{groups: ['assets']}},{name:'enable_modeling_tools',args:{groups: ['connections']}}];},context=>{const tools=context.messages.find(m=>m.role==='system').toolsAdded;assert.ok(tools.some(t=>t.name==='add_saved_assets'));assert.ok(tools.some(t=>t.name==='connect_scene_parts'));return 'tools loaded';}]);await runModelingAgent(opts(f));
 });
 await test('request footprint records numeric payload counts and optional tools restore next turn',async()=>{
  const f=fake([context=>{const tools=context.messages.find(m=>m.role==='system').toolsAdded;assert.ok(!tools.some(t=>t.name==='set_surfaces_batch'));return [{name:'enable_modeling_tools',args:{groups: ['surfaces']}}];},context=>{assert.ok(context.messages.find(m=>m.role==='system').toolsAdded.some(t=>t.name==='set_surfaces_batch'));return '工具已准备';}]);const o=opts(f);const r=await runModelingAgent(o);const times=r.activity.timings.filter(t=>t.kind==='model');assert.equal(times.length,2);assert.ok(times.every(t=>t.requestFootprint.totalSerializedChars>0));assert.ok(times[1].requestFootprint.toolSchemaChars>times[0].requestFootprint.toolSchemaChars);
 });
 await test('unavailable renderer never exposes automatic capture or invents captured evidence',async()=>{const f=fake([context=>{assert.ok(!context.messages.find(m=>m.role==='system').toolsAdded.some(t=>t.name==='capture_quality_review'));return 'no capture';}]);const o=opts(f);o.captureAvailable=()=>false;await runModelingAgent(o);});

 await test('review completion submits after fresh evidence without a separate model round and keeps unknown quality',async()=>{
 const f=fake([[edit,capture],[{name:'review_model',args:{observations:'已检查主体外形；材质细节尚未验收',issues:[],completion:{summary:'主体已生成，提交待确认',remainingIssues:['材质待验收']}}}]]);const r=await runModelingAgent(opts(f));assert.equal(f.calls,2);assert.equal(r.batch.taskStatus,'submitted');assert.match(r.batch.summary,/材质待验收/);assert.equal(r.activity.detailAcceptance.status,'pending');
 });
 await test('repeated unchanged screenshots reuse evidence without rendering or claiming new progress',async()=>{
 const f=fake([[edit,capture],[capture],[{name:'review_model',args:{observations:'读取之前当前版本的真实画面',issues:[],completion:{summary:'复核后提交',remainingIssues:[]}}}]]);const o=opts(f);let rendered=0;o.capture=async()=>{rendered++;return picture;};const r=await runModelingAgent(o);assert.equal(rendered,1);assert.equal(r.batch.taskStatus,'submitted');
 });
 await test('combined review cannot bypass same-turn screenshot evidence requirement',async()=>{
 const done={name:'review_model',args:{observations:'不能提前判定刚返回的图片',issues:[],completion:{summary:'提前提交',remainingIssues:[]}}};const f=fake([[edit,capture,done],'保留未完成']);const r=await runModelingAgent(opts(f));assert.equal(r.batch.taskStatus,'partial');assert.ok(r.activity.timings.some(t=>t.failed&&t.label==='记录视觉检查'));
 });

 await test('single visible object component views satisfy whole scene submission but two objects do not',async()=>{
  for(const multiple of [false,true]){const build={name:'edit_scene',args:{summary:'build',operations:multiple?[create,{...create,tempId:'other',name:'other',transform:{...create.transform,position:[4,0,0]}}]:[create]}};
   const f=fake([[build],ctx=>{const node=JSON.parse(ctx.messages.find(m=>m.role==='toolResult'&&m.toolName==='edit_scene').content[0].text).scene.nodes[0];return [{name:'capture_multiview',args:{componentId:node.id,views:['front','side']}}];},[{name:'review_model',args:{observations:'核对当前真实图像后提交；质量仍待验收',issues:[],completion:{summary:'完成本次修改',remainingIssues:[]}}}],'保留未完成']);
   const r=await runModelingAgent(opts(f));assert.equal(r.batch.taskStatus,multiple?'partial':'submitted');if(!multiple){assert.equal(f.calls,3);assert.ok(!r.activity.timings.some(t=>t.failed));}else assert.ok(r.activity.timings.some(t=>t.failed));
  }
 });
 await test('empty scene omits redundant target-detail lookup but restores it after geometry exists',async()=>{const f=fake([ctx=>{assert.ok(!ctx.messages.find(m=>m.role==='system').toolsAdded.some(t=>t.name==='detail_quality_standard'));return [edit];},ctx=>{assert.ok(ctx.messages.find(m=>m.role==='system').toolsAdded.some(t=>t.name==='detail_quality_standard'));return '阶段草稿';}]);await runModelingAgent(opts(f));});
 await test('known defects reject completion and a plain-text stop receives bounded repair continuation',async()=>{
  let current;const bad={name:'review_model',args:{observations:'当前配色不符合明确要求',issues:['主体配色不符合要求'],completion:{summary:'局部诊断已完成',remainingIssues:['主体配色不符合要求']}}};
  const f=fake([[edit,capture],[bad],'暂时提交这个版本',()=>[{name:'edit_scene',args:{summary:'修正配色',operations:[{op:'setAppearance',targetId:current.nodes[0].id,baseColor:'#123456'}]}},capture],[review,submit]]);const o=opts(f);o.onPreview=doc=>current=doc;const r=await runModelingAgent(o);assert.equal(f.calls,5);assert.equal(r.batch.taskStatus,'submitted');assert.ok(r.activity.timings.some(t=>t.failed&&t.detail.includes('不能作为完成预览提交')));assert.equal(r.batch.operations.length,2);assert.equal(o.document.nodes.length,0);
 });
 await test('unimplemented workflow cannot be submitted and repeated refusal ends as an incomplete draft',async()=>{
  const bad={name:'review_model',args:{observations:'当前只有诊断短程运动',issues:[],completion:{summary:'局部诊断完成',remainingIssues:['取货与放货动作尚未恢复','整车同步及穿插尚未完整验证']}}};const f=fake([[edit,capture],[bad],'先交付','先交付','先交付']);const r=await runModelingAgent(opts(f));assert.equal(f.calls,5);assert.equal(r.batch.taskStatus,'partial');assert.equal(r.activity.outcome,'partial');assert.ok(r.batch.qualityIssues.some(issue=>issue.includes('尚未恢复')));assert.match(r.batch.summary,/仍未解决/);assert.ok(!r.activity.events.some(event=>event.includes('预览已提交')));
 });
 await test('clearing issue lists without changed model or evidence cannot erase a known defect',async()=>{
  const bad={name:'review_model',args:{observations:'背面存在明显缺失',issues:['背面未还原']}};const f=fake([[edit,capture],[bad],[review,submit]]);const r=await runModelingAgent(opts(f));assert.equal(r.batch.taskStatus,'partial');assert.ok(r.activity.timings.some(t=>t.failed&&t.detail.includes('不能只清空问题列表')));assert.ok(r.batch.qualityIssues.some(issue=>issue.includes('背面未还原')));
 });
 await test('animation review accepts chosen phase times and a less occluded camera view',async()=>{
  const doc=applyBatch(createInitialDoc(),{operations:[create]}).doc,track={id:'move',name:'phase move',targetIds:[doc.nodes[0].id],channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:10,value:[3,0,0]}]},samples=[];
  const f=fake([[plan,{name:'configure_animation',args:{summary:'生成往返运动检查',name:'move',duration:10,loop:false,tracks:[track]}},{name:'preview_animation',args:{times:[0,2,4,6,8,10],view:'side'}}],[review,submit]]);const o=opts(f,doc);o.text='创建运动动画';o.capture=async(d,view,ids,time)=>{samples.push({view,time});return picture;};const r=await runModelingAgent(o);assert.equal(r.batch.taskStatus,'submitted');assert.deepEqual(samples.map(s=>s.time),[0,2,4,6,8,10]);assert.ok(samples.every(s=>s.view==='side'));
 });
 console.log(`${passed} Pi agent loop checks passed; model and rendering mocked`);
}finally{await server.close()}
