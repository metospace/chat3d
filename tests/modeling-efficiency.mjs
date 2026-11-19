import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {runModelingAgent,compactAgentContext}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const picture='data:image/png;base64,YWJj',base=createInitialDoc(),config={baseURL:'https://fixture.invalid/v1',apiKey:'not-sent',model:'fixture'};
 const transport=steps=>{let turn=0;return async(_model,context)=>{const step=steps[turn++]??'结束',actions=typeof step==='function'?step(context):step,content=Array.isArray(actions)?actions.map((a,i)=>({type:'toolCall',id:`eff-${turn}-${i}`,name:a.name,arguments:a.args})):[{type:'text',text:actions}];const message={role:'assistant',content,api:'openai-completions',provider:'fixture',model:'fixture',stopReason:Array.isArray(actions)?'toolUse':'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});stream.end();});return stream;};};
 const names=ctx=>ctx.messages.find(m=>m.role==='system').toolsAdded.map(t=>t.name);
 await runModelingAgent({text:'查看能力但不修改',config,document:base,selection:[],images:[picture],captureAvailable:()=>false,streamFn:transport([
  ctx=>{assert.ok(!names(ctx).includes('add_saved_assets'));return [{name:'enable_modeling_tools',args:{groups:['assets','connections']}}];},
  ctx=>{assert.ok(names(ctx).includes('add_saved_assets'));assert.ok(names(ctx).includes('connect_scene_parts'));return [{name:'enable_modeling_tools',args:{groups:[],disableGroups:['assets','connections']}}];},
  ctx=>{assert.ok(!names(ctx).includes('add_saved_assets'));assert.ok(!names(ctx).includes('connect_scene_parts'));return '能力检查结束';}
 ])});console.log('PASS multiple groups enable in one call and explicitly disabled schemas stay hidden');
 const doc=applyBatch(base,{operations:[{op:'createPrimitive',name:'目标',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}).doc;
 await runModelingAgent({text:'检查当前模型',config,document:doc,selection:[],capture:async()=>picture,streamFn:transport([[{name:'capture_multiview',args:{views:['front','side']}}],ctx=>{const result=ctx.messages.find(m=>m.role==='toolResult'&&m.toolName==='capture_multiview');const receipt=result.content.filter(c=>c.type==='text').map(c=>{try{return JSON.parse(c.text).reviewReadiness;}catch{return null;}}).find(Boolean);assert.ok(receipt);assert.equal(receipt.revision,doc.revision);assert.deepEqual(receipt.wholeViews,['front','side']);assert.equal(receipt.targets.length,0,'unchanged scene does not fabricate changed review targets');return '已读取实际截图';}])});console.log('PASS capture returns real evidence scope and readiness without an extra scene query');
 const sourceDoc=structuredClone(doc);sourceDoc.nodes[0].modelingProgram={source:'const width=1;\nreturn new THREE.Group();',createdAt:1,stage:'silhouette'};
 const componentId=sourceDoc.nodes[0].assemblyId??sourceDoc.nodes[0].id;
 await runModelingAgent({text:'检查已有源码',config,document:sourceDoc,selection:[],captureAvailable:()=>false,streamFn:transport([[{name:'read_modeling_program',args:{componentId,selection:{mode:'lines',start:1,end:120}}}],ctx=>{const result=ctx.messages.find(m=>m.role==='toolResult'&&m.toolName==='read_modeling_program');assert.equal(result.isError,false);const read=JSON.parse(result.content[0].text);assert.equal(read.window.text,sourceDoc.nodes[0].modelingProgram.source);assert.equal(read.lineCount,2);return '源码读取成功';}])});
 const blocked=await runModelingAgent({text:'细化当前模型',config,document:sourceDoc,selection:[],capture:async()=>picture,streamFn:transport([[{name:'edit_scene',args:{summary:'只修改颜色',operations:[{op:'setAppearance',targetId:sourceDoc.nodes[0].id,baseColor:'#778899'}]}},{name:'capture_multiview',args:{views:['front','side']}}],[{name:'review_model',args:{observations:'只核对主体剪影，尚未细化',issues:[],completion:{summary:'完成预览',remainingIssues:[]}}}],'保留未完成主体'])});
 assert.equal(blocked.batch.incomplete,true);assert.ok(blocked.activity.timings.some(t=>t.toolName==='review_model'&&t.failed));assert.equal(blocked.result.doc.nodes[0].modelingProgram.stage,'silhouette');
 console.log('PASS real tool clamps source EOF and silhouette cannot be completed by color changes plus review');
 const sourceFixture=applyBatch(sourceDoc,{operations:[{op:'createPrimitive',name:'Other object',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:doc.nodes[0].transform}]}).doc;
 const source=sourceFixture.nodes[0].modelingProgram.source;
 const readSource=selection=>({name:'read_modeling_program',args:{componentId,selection}});
 const chars=(start,end)=>readSource({mode:'characters',start,end});
 const reads=ctx=>ctx.messages.filter(m=>m.role==='toolResult'&&m.toolName==='read_modeling_program');
 await runModelingAgent({text:'读取源码并修改另一对象，然后删除带源码的组件',config,document:sourceFixture,selection:[],captureAvailable:()=>false,streamFn:transport([
  [chars(2,10),chars(10,20),chars(24,32),readSource({mode:'search',query:'width'}),chars(999,1000)],
  [{name:'edit_scene',args:{summary:'移动另一对象',operations:[{op:'translate',targetId:sourceFixture.nodes[1].id,value:[1,0,0]}]}},chars(0,14)],
  ctx=>{
   const [covered,overlap,disjoint,search,error,latest]=reads(ctx);
   assert.doesNotMatch(covered.content[0].text,/"window"/);
   for(const [result,start,end] of [[overlap,10,20],[disjoint,24,32],[latest,0,14]]){
    const data=JSON.parse(result.content[0].text);
    assert.equal(data.componentId,componentId);assert.equal(data.window.text,source.slice(start,end));assert.equal(data.nextChar,end);
   }
   assert.equal(JSON.parse(search.content[0].text).matches[0].matchStartChar,source.indexOf('width'));
   assert.ok(error.isError);assert.match(error.content[0].text,/999/);
   return [{name:'edit_scene',args:{summary:'删除带源码的组件',operations:[{op:'delete',targetId:sourceFixture.nodes[0].id}]}}];
  },
  ctx=>{
   const results=reads(ctx);assert.equal(results.length,6);
   for(const result of results.filter(m=>!m.isError))assert.doesNotMatch(result.content[0].text,/"window"|"matches"/);
   assert.match(results.find(m=>m.isError).content[0].text,/999/);
   return [{name:'submit_data_preview',args:{summary:'保留改动，未视觉验收'}}];
  },
 ])});
 console.log('PASS source context retains partial/disjoint windows, search and errors across unrelated changes; drops covered or deleted source');
 const checksDoc=structuredClone(doc);const target=checksDoc.nodes[0].id;
 const one=(criterion,status='unknown')=>({criterion,status,evidence:'当前真实视图仍需逐项核对',nodeIds:[target]});
 const partial=await runModelingAgent({text:'只检查当前模型，分次核对，不修改模型',config,document:checksDoc,qualityBaseline:base,selection:[],capture:async()=>picture,streamFn:transport([[{name:'capture_multiview',args:{views:['front','side']}}],[{name:'review_model',args:{observations:'外形尚需修正，先记录部分标准',issues:[],detailReviews:[{componentId:target,checks:[one('silhouette','fail')]}]}}],[{name:'review_model',args:{observations:'补充功能结构检查，未修正原外形问题',issues:[],detailReviews:[{componentId:target,checks:[one('structure')]}]}}],'保留未验收结论'])});
 const finalChecks=partial.activity.detailAcceptance.reviews[0].checks;assert.equal(finalChecks.length,6);assert.equal(finalChecks.find(c=>c.criterion==='silhouette').status,'fail');assert.equal(finalChecks.find(c=>c.criterion==='materials').status,'unknown');assert.ok(!partial.activity.timings.some(t=>t.toolName==='review_model'&&t.failed));
 const mixed=await runModelingAgent({text:'读取源码纠错',config,document:sourceDoc,selection:[],captureAvailable:()=>false,streamFn:transport([[{name:'read_modeling_program',args:{componentId,selection:{mode:'lines',start:1,end:24,startChar:0}}}],[{name:'read_modeling_program',args:{componentId,selection:{mode:'characters',start:0,end:3993}}}],ctx=>{const reads=ctx.messages.filter(m=>m.role==='toolResult'&&m.toolName==='read_modeling_program');assert.equal(reads[0].isError,true);assert.equal(reads[1].isError,false);return '纠正为单一模式后读取成功';}])});assert.ok(mixed.activity.timings.some(t=>t.toolName==='read_modeling_program'&&!t.failed));
 console.log('PASS partial review retains failures and unknowns; mixed source selectors reject before execution and recover with one explicit mode');
 let failedId;const repairedEdit=await runModelingAgent({text:'修正现有模型外观，执行工具纠错验收',config,document:doc,selection:[],captureAvailable:()=>false,streamFn:transport([[{name:'edit_scene',args:{summary:'改色',operations:[{targetId:doc.nodes[0].id,baseColor:'#3979aa'}]}}],ctx=>{const failure=ctx.messages.find(m=>m.role==='toolResult'&&m.toolName==='edit_scene');assert.equal(failure.isError,true);failedId=failure.toolCallId;assert.ok(JSON.stringify(failure.content).includes('operations[0].op'));return [{name:'retry_scene_edit',args:{failedId,patches:[{path:['operations',0,'op'],value:'setAppearance'}]}}];},[{name:'submit_data_preview',args:{summary:'按明确命令纠正后保留数据预览'}}]])});
 assert.equal(doc.materials.find(m=>m.id===doc.nodes[0].materialId).baseColor=== '#3979aa',false);assert.equal(repairedEdit.result.doc.materials.find(m=>m.id===repairedEdit.result.doc.nodes[0].materialId).baseColor,'#3979aa');assert.equal(repairedEdit.batch.operations.length,1);
 const formPlan={key:'new-body',name:'自定义主体',purpose:'按图建模',detailLevel:'closeup',detailReason:'检查主体比例',silhouette:'矩形连续主体',features:[{key:'body',name:'主体',role:'form',geometryApproach:'primitive',referenceObservation:'矩形主轮廓'}],negativeSpaces:[],views:['front','side'],referenceProportions:[{key:'height-width',name:'高宽比',numerator:{featureKey:'new-body',axis:'y'},denominator:{featureKey:'body',axis:'x'},expected:1,source:'estimated',relativeTolerance:.1,view:'front',observation:'可见主轮廓高宽接近'}]};
 const missingBuild={name:'build_modeling_program',args:{name:'自定义主体',summary:'按图构建主体',blueprintKey:'new-body',stage:'detailed',source:'throw new Error("must not execute before valid plan");',features:[{key:'body',partNames:['主体']}]}};
 const recoveredPlan=structuredClone(formPlan);recoveredPlan.referenceProportions[0].numerator.featureKey='body';
 const planned=await runModelingAgent({text:'根据参考构建主体',config,document:base,selection:[],images:[picture],captureAvailable:()=>false,streamFn:transport([[missingBuild],ctx=>{const fail=ctx.messages.find(m=>m.role==='toolResult'&&m.toolName==='build_modeling_program');assert.equal(fail.isError,true);assert.ok(JSON.stringify(fail.content).includes('blueprintKey=new-body'));return [{name:'plan_object_structure',args:{objects:[formPlan]}}];},ctx=>{const fail=ctx.messages.find(m=>m.role==='toolResult'&&m.toolName==='plan_object_structure');assert.equal(fail.isError,true);assert.ok(JSON.stringify(fail.content).includes('numerator.featureKey'));assert.ok(JSON.stringify(fail.content).includes('body'));return [{name:'plan_object_structure',args:{objects:[recoveredPlan]}},{name:'build_structured_component',args:{blueprintKey:'new-body',definition:{name:'自定义主体',parts:[{name:'主体',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]},features:[{key:'body',partNames:['主体']}]}}];},[{name:'submit_data_preview',args:{summary:'结构方案纠正后完成数据构建，仍待视觉核对'}}]])});
 assert.equal(planned.result.doc.nodes.length,1);assert.equal(planned.result.doc.nodes[0].geometry.params.height,1);assert.equal(planned.activity.objectBlueprints[0].referenceProportions[0].expected,1);assert.ok(planned.activity.timings.some(t=>t.toolName==='build_structured_component'&&!t.failed));
 console.log('PASS missing op retries atomically; missing blueprint then invalid feature reference recover without executing unplanned code or dropping ratio constraints');
 const image=data=>({type:'image',mimeType:'image/png',data});
 const packet=(id,views)=>({role:'toolResult',toolCallId:id,toolName:'capture_multiview',isError:false,content:views.flatMap(v=>[{type:'text',text:`revision=2 scope=whole view=${v}`},image(id+'-'+v)])});
 const messages=[{role:'user',content:[{type:'text',text:'原参考'},image('reference')]},packet('old',['front','side']),packet('new',['front','back'])];
 const compact=compactAgentContext(messages);assert.deepEqual(compact.filter(m=>m.role==='toolResult').flatMap(m=>m.content.filter(c=>c.type==='image').map(c=>c.data)),['old-side','new-front','new-back']);assert.equal(compact[0].content[1].data,'reference');assert.equal(messages[1].content.filter(c=>c.type==='image').length,2);console.log('PASS mixed screenshot packets discard only superseded views and keep reference and unseen views');
 const subjects=applyBatch(base,{operations:['Subject','Neighbor'].map((name,i)=>({op:'createAssembly',name,position:[i*4,0,0],parts:[{name:name+' body',geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_white',transform:doc.nodes[0].transform}]}))}).doc;
 const subject=subjects.nodes[0],subjectId=subject.assemblyId,reference='data:image/png;base64,cmVmZXJlbmNl';
 const overview={name:'capture_quality_review',args:{overviewOnly:true}};
 const focus={name:'capture_quality_review',args:{componentIds:[subjectId]}};
 const difference={id:'depth-gap',featureKey:'body-depth',nodeIds:[subject.id],observed:'主体纵深明显过短',expected:'与参考相同的长宽比例',action:'仅增加主体实际纵深',view:'front'};
 for(const hasCurrentOverview of [true,false]){
  const rendered=[];
  const result=await runModelingAgent({text:'按参考图仅修正主体纵深，保留相邻对象',document:subjects,selection:[],config,images:[reference],capture:async(d,view,ids)=>{rendered.push({revision:d.revision,view,ids});return picture;},streamFn:transport([
   [overview],
   [{name:'review_model',args:{observations:'参考图显示主体纵深明显不足',issues:[],referenceDifferences:[difference]}},{name:'edit_scene',args:{summary:'增加实际纵深',operations:[{op:'updateParameters',targetId:subject.id,geometry:{type:'box',params:{width:1,height:1,depth:2}}}]}},...(hasCurrentOverview?[overview]:[]),focus,focus],
   ctx=>{
    const toolResults=ctx.messages.filter(m=>m.role==='toolResult');
    assert.ok(ctx.messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(c=>c.type==='image'&&c.data==='cmVmZXJlbmNl')));
    assert.ok(toolResults.some(m=>m.toolName==='review_model'&&!m.isError&&m.content.some(c=>c.type==='text'&&c.text.includes(difference.id))));
    assert.ok(toolResults.some(m=>m.toolName==='edit_scene'&&!m.isError));
    const requestState=ctx.messages.at(-1).content[0].text;
    for(const detail of [difference.observed,difference.expected,difference.action])assert.equal(requestState.split(detail).length-1,1,'each active difference is sent once in runtime state');
    assert.ok(requestState.includes(subject.id)&&requestState.includes(difference.id),'the difference keeps its real part and review IDs');
    return [{name:'review_model',args:{observations:'当前全景与局部画面确认真实纵深已修正且相邻件保持',issues:[],resolvedDifferenceIds:[difference.id],completion:{summary:'局部形体修复完成',remainingIssues:[]}}}];
   }
  ])});
  assert.equal(result.activity.outcome,'preview-ready');assert.equal(result.batch.incomplete,undefined);assert.equal(result.activity.referenceRepairs.length,0);
  assert.equal(result.result.doc.nodes[0].geometry.params.depth,2);assert.deepEqual(result.result.doc.nodes[1],subjects.nodes[1]);
  const wholeViews=rendered.filter(r=>r.revision===result.result.doc.revision&&!r.ids).map(r=>r.view);
  assert.deepEqual(wholeViews,['perspective','top'],hasCurrentOverview?'reuse the current overview':'capture the newly required overview');
  assert.deepEqual(rendered.filter(r=>r.revision===result.result.doc.revision&&r.ids).map(r=>[r.view,r.ids]),[['front',[subject.id]],['back',[subject.id]]]);
  assert.ok(!result.activity.timings.some(t=>t.kind==='tool'&&t.failed));
 }
 console.log('PASS registered reference gap is edited and closed with one current overview, one focused capture and a combined review');
}finally{await server.close();}
