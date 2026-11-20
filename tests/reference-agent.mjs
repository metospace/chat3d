import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name)};
try{
 const {runModelingAgent}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const picture='data:image/png;base64,YWJj',config={baseURL:'https://fixture.invalid/v1',apiKey:'not-sent',model:'fixture',reasoningEffort:'high'};
 const transport=steps=>{let turn=0;const contexts=[];return {contexts,fn:async(_model,context)=>{contexts.push(structuredClone(context));const step=steps[turn++]??'停止并保留草稿',actions=typeof step==='function'?step(context):step,content=Array.isArray(actions)?actions.map((a,i)=>({type:'toolCall',id:`call-${turn}-${i}`,name:a.name,arguments:a.args})):[{type:'text',text:actions}],message={role:'assistant',content,api:'openai-completions',provider:'fixture',model:'fixture',stopReason:Array.isArray(actions)?'toolUse':'stop',timestamp:Date.now(),usage:{input:10,output:10,cacheRead:0,cacheWrite:0,totalTokens:20,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}},stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});});return stream;}}};
 const transform={position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]},geometry={type:'box',params:{width:1,height:1,depth:1}},create={op:'createPrimitive',name:'主体',geometry,transform};
 const options=(f,document=createInitialDoc())=>({text:'根据参考图创建独立模型',document,config,selection:[],images:[picture],streamFn:f.fn,capture:async()=>picture});
 const plan={key:'object',name:'通用对象',purpose:'参考重建',detailLevel:'closeup',detailReason:'按图比对',silhouette:'主体与长形构件',features:[{key:'body',name:'主体',referenceObservation:'主要矩形轮廓',role:'form',geometryApproach:'primitive'},{key:'reach',name:'长形构件',referenceObservation:'长度约主体宽度两倍',role:'function',geometryApproach:'primitive'}],negativeSpaces:[],views:['side','perspective'],referenceProportions:[{key:'reach-width',name:'长度/主体宽度',numerator:{featureKey:'reach',axis:'z'},denominator:{featureKey:'body',axis:'x'},expected:2,source:'estimated',relativeTolerance:.1,view:'side',observation:'侧向关系可估计，深度透视未知'}]};
 const build={name:'build_structured_component',args:{blueprintKey:plan.key,definition:{name:'对象',parts:[{name:'主体',geometry,transform},{name:'长形构件',geometry:{type:'box',params:{width:.1,height:.1,depth:1}},transform}]},features:[{key:'body',partNames:['主体']},{key:'reach',partNames:['长形构件']}]}};
 const capture={name:'capture_view',args:{view:'side'}},review={name:'review_model',args:{observations:'按当前侧视检查轮廓和主体关系',issues:[]}},submit={name:'submit_preview',args:{summary:'待确认预览',remainingIssues:[]}};
 await test('four numbered reference photos are sent in order and the overview uses the matching directions',async()=>{
  const images=['front-quarter','rear-quarter','rear','side'].map(name=>'data:image/png;base64,'+Buffer.from(name).toString('base64'));
  const views=['side','back','front'],seen=[];
  const f=transport([context=>{
   const refs=context.messages.find(message=>message.role==='user').content.slice(1);
   assert.deepEqual(refs.filter(item=>item.type==='text').map(item=>item.text),['参考图 1','参考图 2','参考图 3','参考图 4']);
   assert.deepEqual(refs.filter(item=>item.type==='image').map(item=>item.data),images.map(image=>image.split(',')[1]));
   return [{name:'capture_quality_review',args:{overviewOnly:true,views}}];
  },context=>{
   const result=context.messages.find(message=>message.role==='toolResult'&&message.toolName==='capture_quality_review');
   assert.equal(result.isError,false);
   assert.equal(result.content.filter(item=>item.type==='image').length,3);
   return '已取得对应画面';
  }]);
  const doc=applyBatch(createInitialDoc(),{operations:[create]}).doc;
  await runModelingAgent({...options(f,doc),images,capture:async(_doc,view,ids)=>{assert.equal(ids,undefined);seen.push(view);return picture;}});
  assert.deepEqual(seen,views);
 });
 await test('new reference structured builds require ratios before creating geometry',async()=>{const missing=structuredClone(plan);delete missing.referenceProportions;const f=transport([[{name:'plan_object_structure',args:{objects:[missing]}},build],'缺少观察比例']);const r=await runModelingAgent(options(f));assert.equal(r.result.doc.nodes.length,0);assert.ok(r.activity.timings.some(t=>t.toolName==='build_structured_component'&&t.failed));assert.ok(r.activity.events.some(e=>e.includes('主比例')));});
 await test('reference proportion mismatch blocks completion and geometry repair allows a fresh submission',async()=>{
  let target,current;
  const f=transport([[{name:'plan_object_structure',args:{objects:[plan]}},build,capture],[review,submit],ctx=>{
   assert.ok(ctx.messages.some(m=>m.role==='toolResult'&&m.isError&&JSON.stringify(m.content).includes('参考比例')));
   target=current.nodes.find(n=>n.modelStructure?.featureKeys.includes('reach')).id;
   return [{name:'edit_scene',args:{summary:'按比例延长主体构件',operations:[{op:'updateParameters',targetId:target,geometry:{type:'box',params:{width:.1,height:.1,depth:2}}}]}},{name:'capture_multiview',args:{views:['side','front']}}];
  },()=>[{name:'review_model',args:{...review.args,detailReviews:[{componentId:current.nodes[0].assemblyId,checks:[{criterion:'silhouette',status:'pass',evidence:'互补画面下已核对整体比例',nodeIds:[current.nodes[0].id]},{criterion:'structure',status:'pass',evidence:'互补画面下已核对长形构件',nodeIds:[target]}]}]}},submit]]);
  const r=await runModelingAgent({...options(f),onPreview:doc=>current=doc});
  assert.equal(r.activity.outcome,'preview-ready',JSON.stringify(r.activity.events));assert.equal(r.result.doc.nodes.find(n=>n.id===target).geometry.params.depth,2);assert.equal(r.activity.blueprintCoverage.objects[0].referenceProportions.items[0].status,'matches_declaration');
 });
 await test('shape defects cannot disappear after omitted fields or material-only edits and survive continuation',async()=>{const doc=applyBatch(createInitialDoc(),{operations:[create]}).doc,id=doc.nodes[0].id,difference={id:'shape',featureKey:'body',nodeIds:[id],observed:'纵向明显过短',expected:'长宽比例更大',action:'重建主体深度',view:'side'};const f=transport([[capture],[{name:'review_model',args:{...review.args,referenceDifferences:[difference]}},{name:'edit_scene',args:{summary:'仅改材质',operations:[{op:'setAppearance',targetId:id,baseColor:'#ffffff'}]}},capture],[{name:'review_model',args:{...review.args,resolvedDifferenceIds:['shape']}},submit],'保留未完成']);const r=await runModelingAgent(options(f,doc));assert.equal(r.batch.incomplete,true);assert.equal(r.activity.referenceRepairs.length,1);const next=transport([[{name:'edit_scene',args:{summary:'修正深度',operations:[{op:'updateParameters',targetId:id,geometry:{type:'box',params:{width:1,height:1,depth:2}}}]}},capture],[{name:'review_model',args:{...review.args,resolvedDifferenceIds:['shape']}},submit]]);const fixed=await runModelingAgent({...options(next,r.result.doc),referenceRepairs:r.activity.referenceRepairs});assert.equal(fixed.activity.referenceRepairs.length,0);assert.equal(fixed.activity.outcome,'preview-ready');});
 await test('a visible reference shape difference reported in prose blocks completion, while missing source material does not',async()=>{
  const edit={name:'edit_scene',args:{summary:'生成参考主体',operations:[create]}};
  const limitation='无实车测量及内饰、底盘参考，未做工程级校验';
  const cases=[
   ['尾肩与尾盖的过渡并非完全与照片一致',[limitation],true],
   ['已比较当前模型与参考图',['尾盖亮带和尾肩局部曲率与参考图仍有细微差别',limitation],true],
   ['修复前主体曲面和参考图有明显差异，当前版本已修正',[limitation],false],
  ];
  for(const [observations,remainingIssues,blocked] of cases){
   const result=await runModelingAgent(options(transport([[edit,capture],[{name:'review_model',args:{
    observations,issues:[],completion:{summary:'完成模型预览',remainingIssues},
   }}],'保留当前结果'])));
   assert.equal(result.activity.outcome,blocked?'partial':'preview-ready',observations);
   assert.equal(result.result.doc.nodes.length,1);
   if(blocked)assert.match(result.batch.qualityIssues.join('\n'),/过渡并非完全与照片一致|曲率与参考图仍有细微差别/);
  }
 });
 await test('reference task omits unrelated catalogs until enabled and records safe configuration',async()=>{const f=transport([[{name:'enable_modeling_tools',args:{groups: ['catalog']}}],'仅检查发现能力']);const r=await runModelingAgent(options(f));const names=i=>f.contexts[i].messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded??[]).map(t=>t.name);assert.ok(!names(0).includes('read_component_recipe'));assert.ok(names(1).includes('read_component_recipe'));assert.equal(r.activity.executionMeta.reasoningEffort,'high');assert.equal(r.activity.executionMeta.referenceImages.count,1);});
 await test('continuation without reference images cannot bypass shape repairs through local quick edits',async()=>{const {updateReferenceRepairs,referenceRepairReport}=await server.ssrLoadModule('/src/domain/referenceRepairs.ts');const doc=applyBatch(createInitialDoc(),{operations:[create]}).doc,id=doc.nodes[0].id;const repairs=referenceRepairReport(updateReferenceRepairs(doc,[],[{id:'shape',featureKey:'body',nodeIds:[id],observed:'主体外形过短',expected:'需要延长',action:'替换主体深度',view:'side'}],[]));const f=transport(['缺陷仍未解决']);let latest;await assert.rejects(runModelingAgent({...options(f,doc),images:[],text:'把主体改成红色',referenceRepairs:repairs,onActivity:activity=>{latest=activity;}}));assert.ok(f.contexts.length<=3);assert.equal(latest.referenceRepairs.length,1);assert.ok(!latest.timings.some(t=>t.kind==='tool'&&t.toolName==='edit_scene'));});
 await test('independent primary-form mismatch and unknown verdict block build and patch before execution',async()=>{
  const shapePlan={...plan,features:[{...plan.features[0],geometryApproach:'mesh'},
   ...['trim','label','screws'].map(key=>({key,name:key,role:'surface',geometryApproach:'primitive',referenceObservation:'后续细节'}))],
   referenceProportions:[{...plan.referenceProportions[0],numerator:{featureKey:'body',axis:'x'},denominator:{featureKey:'body',axis:'y'},expected:null}]};
  const {sourceVersion}=await server.ssrLoadModule('/src/ai/modelingProgramSource.ts');
  for(const status of ['mismatch','unknown'])for(const toolName of ['build_modeling_program','patch_modeling_program']){
   const doc=applyBatch(createInitialDoc(),{operations:[create]}).doc,node=doc.nodes[0],source='throw new Error("SOURCE_MUST_NOT_RUN");';
   node.assemblyId='shape-component';node.assemblyName='主形';
   node.modelStructure={blueprintKey:shapePlan.key,featureKeys:['body'],blueprint:shapePlan,localTransform:structuredClone(node.transform)};
   node.modelingProgram={source,stage:'silhouette',createdAt:1};
   let current,comparisons=0,turn=0;
   const patch={componentId:node.assemblyId,expectedVersion:sourceVersion(source),stage:'detailed',summary:'升级细节',patches:[{find:'SOURCE_MUST_NOT_RUN',replace:'ALSO_MUST_NOT_RUN'}]};
   const buildArgs={replaceComponentId:node.assemblyId,blueprintKey:shapePlan.key,name:'主形',summary:'升级细节',source,stage:'detailed',features:[{key:'body',partNames:[node.name]}]};
   const f=transport([
    [{name:'edit_scene',args:{summary:'移动主体以核对新形体',operations:[{op:'translate',targetId:node.id,space:'world',mode:'delta',value:[.1,0,0]}]}},{name:'capture_multiview',args:{views:['front','side']}}],
    ()=>[{name:'review_model',args:{observations:'已观察互补方向主体',issues:[],detailReviews:[{componentId:node.assemblyId,checks:[{criterion:'silhouette',status:'pass',evidence:'正侧向主体形体已核对',nodeIds:[node.id]}]}]}},{name:toolName,args:toolName==='build_modeling_program'?buildArgs:patch}],
    context=>{const failure=context.messages.filter(m=>m.role==='toolResult'&&m.toolName===toolName).at(-1);assert.equal(failure.isError,true);assert.match(JSON.stringify(failure.content),/独立参考对照/);assert.doesNotMatch(JSON.stringify(failure.content),/SOURCE_MUST_NOT_RUN/);return [{name:toolName,args:{...(toolName==='build_modeling_program'?buildArgs:patch),summary:'重新申请细化但没有修复'}}];},
    ()=>{assert.equal(comparisons,1,'same current shape reuses failed independent verdict');return [{name:'edit_scene',args:{summary:'修正主体相对位置',operations:[{op:'translate',targetId:node.id,space:'world',mode:'delta',value:[.1,0,0]}]}},{name:'capture_multiview',args:{views:['front','side']}}];},
    ()=>[{name:'review_model',args:{observations:'新版本已重新核对主体',issues:[],detailReviews:[{componentId:node.assemblyId,checks:[{criterion:'silhouette',status:'pass',evidence:'当前正侧形体重新核对',nodeIds:[node.id]}]}]}},{name:toolName,args:{...(toolName==='build_modeling_program'?buildArgs:patch),summary:'新版本申请细化'}}],
    ()=>{assert.equal(comparisons,2,'changed current shape must get new independent verdict');return '保留未完成主体';},
   ]);
   const fn=async(model,context)=>{
    if(context.messages.find(m=>m.role==='system')?.content.includes('独立审核参考图还原度')){
     comparisons++;const input=context.messages.find(m=>m.role==='user').content,request=JSON.parse(input[0].text);
     assert.equal(request.phase,'silhouette');assert.deepEqual(request.features.map(f=>f.key),['','body']);
     assert.equal(input.filter(p=>p.type==='image').length,4);
     assert.match(context.messages[0].content,/忽略尚未制作/);
     const rows=request.features.map(f=>({key:f.key,reference:1,frame:1,status,difference:'主体肩部曲面与参考不一致',repair:'调整主体横向截面曲线'}));
     return {result:async()=>({role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[{type:'text',text:JSON.stringify(rows)}],stopReason:'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})};
    }
    turn++;return f.fn(model,context);
   };
   const result=await runModelingAgent({...options(f,doc),images:[picture,picture],streamFn:fn,onPreview:d=>{current=d;}});
   assert.equal(comparisons,2,status+' '+toolName);assert.ok(turn>=6);assert.equal(result.activity.outcome,'partial');
   assert.equal(current.nodes.length,1);assert.equal(current.nodes[0].modelingProgram.stage,'silhouette');assert.equal(current.nodes[0].modelingProgram.source,source);
  }
 });
 console.log(passed+' reference agent behavior checks passed; synthetic images/model, no fidelity claim');
}finally{await server.close();}
