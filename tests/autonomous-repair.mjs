import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {runModelingAgent}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const base=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',name:'主体',geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_white',transform:{position:[0,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}).doc;
 const id=base.nodes[0].id,picture='data:image/png;base64,YWJj',config={baseURL:'https://fixture.invalid/v1',apiKey:'not-sent',model:'fixture'};
 const capture={name:'capture_view',args:{view:'perspective'}};
 const defect={name:'review_model',args:{observations:'主体的深度与明确要求不符',issues:['主体深度不符合要求']}};
 const unknown={name:'review_model',args:{observations:'参考图没有清晰背面信息，无法判断内部结构',issues:['参考图未提供背面，内部结构无法确认']}};
 const review={name:'review_model',args:{observations:'已查看修后当前版本，主体深度已调整',issues:[],completion:{summary:'修正主体深度，保留其他内容',remainingIssues:[]}}};
 const repair={name:'edit_scene',args:{summary:'按明确差异修改主体深度',operations:[{op:'updateParameters',targetId:id,geometry:{type:'box',params:{width:1,height:1,depth:1.5}}}]}};
 function transport(steps){let turn=0;const contexts=[];return {contexts,fn:async(_m,context)=>{contexts.push(structuredClone(context));const actions=steps[turn++]??'等待用户再次发指令';const content=Array.isArray(actions)?actions.map((a,i)=>({type:'toolCall',id:`repair-${turn}-${i}`,name:a.name,arguments:a.args})):[{type:'text',text:actions}];const message={role:'assistant',content,api:'openai-completions',provider:'fixture',model:'fixture',stopReason:Array.isArray(actions)?'toolUse':'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});stream.end();});return stream;}};}
 const options=f=>({text:'完善当前模型并修复发现的问题',document:base,selection:[],config,capture:async()=>picture,streamFn:f.fn});
 const f=transport([[capture],[defect],'已识别深度问题，请再发送修复指令',[repair,capture],[review]]);
 const result=await runModelingAgent(options(f));assert.equal(result.batch.taskStatus,'submitted');assert.equal(result.result.doc.nodes[0].geometry.params.depth,1.5);assert.equal(base.nodes[0].geometry.params.depth,1);assert.equal(result.batch.operations.length,1);assert.equal(f.contexts.length,5);
 console.log('PASS defects found by inspection continue into actual geometry repair without requiring a prior edit or another user message');
 const continueRepair=transport([[capture],[defect],'需要用户再发指令',[repair,capture],[review]]);const continued=await runModelingAgent({...options(continueRepair),text:'请继续完善，不要只检查后原样结束，发现已确认问题直接修复'});assert.equal(continued.batch.taskStatus,'submitted');assert.equal(continued.result.doc.nodes[0].geometry.params.depth,1.5);
 console.log('PASS a request not to merely inspect retains explicit repair authority');
 const inspect=transport([[capture],[defect],'只报告检查结果']);const inspected=await runModelingAgent({...options(inspect),text:'只检查当前模型，不修改模型'});assert.equal(inspect.contexts.length,3);assert.equal(inspected.batch.operations.length,0);assert.equal(inspected.result.doc.revision,base.revision);
 console.log('PASS explicit inspect-only authorization never becomes an automatic model mutation');
 const missing=transport([[capture],[unknown],'缺少背面资料，保留未知']);const unverified=await runModelingAgent(options(missing));assert.equal(missing.contexts.length,3);assert.equal(unverified.batch.operations.length,0);
 console.log('PASS missing source evidence does not cause guessed geometry or an unbounded repair loop');
}finally{await server.close();}
