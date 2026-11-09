import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {runModelingAgent}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {DETAIL_CRITERIA}=await server.ssrLoadModule('/src/domain/detailAcceptance.ts');
 const config={baseURL:'https://offline.invalid/v1',apiKey:'mock-only',model:'fixture'};
 const image='data:image/png;base64,YWJj';
 const edit={name:'edit_scene',args:{summary:'body',operations:[{op:'createPrimitive',name:'body',parentId:null,materialId:'mat_gray',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}};
 const fake=steps=>{let i=0;const contexts=[];return {contexts,fn:async(_model,context)=>{contexts.push(structuredClone(context));const raw=steps[i++]??'done';const step=typeof raw==='function'?raw():raw;const content=Array.isArray(step)?step.map((x,j)=>({type:'toolCall',id:`${i}_${j}`,name:x.name,arguments:x.args})):[{type:'text',text:step}];const message={role:'assistant',content,api:'openai-completions',provider:'mock',model:'mock',stopReason:Array.isArray(step)?'toolUse':'stop',timestamp:Date.now(),usage:{input:20,output:10,cacheRead:0,cacheWrite:0,totalTokens:30,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});});return stream;}};};
 const capture={name:'capture_multiview',args:{views:['front','back']}};
 const one=fake([[edit],[capture],'keep unreviewed']);
 const bad=await runModelingAgent({text:'创建主体',document:createInitialDoc(),selection:[],config,streamFn:one.fn,captureEvidence:async(doc,view,targetIds,time)=>({image,backend:'webgl',projectId:'wrong-task',revision:doc.revision,view,targetIds,time})});
 assert.equal(bad.batch.incomplete,true);assert.doesNotMatch(JSON.stringify(one.contexts),/"type":"image"/);console.log('PASS wrong-project capture evidence is rejected before it reaches model context');
 let nodeId='';
 const soft=fake([[edit],[capture],()=>[{name:'audit_model_detail',args:{componentId:nodeId,checks:DETAIL_CRITERIA.map(x=>({criterion:x.key,status:'pass',evidence:'当前两张图包含该对象可见结构和材质的检查依据',nodeIds:[nodeId]}))}}],'keep pending']);
 const gpu=fake([[edit],[capture],'keep pending']);
 const [softResult,gpuResult]=await Promise.all([
  runModelingAgent({text:'创建主体',document:createInitialDoc(),selection:[],config,streamFn:soft.fn,captureEvidence:async(doc,view,targetIds,time)=>{nodeId=doc.nodes[0].id;await new Promise(r=>setTimeout(r,5));return {image,backend:'software',projectId:doc.projectId,revision:doc.revision,view,targetIds,time,softwareInfo:{width:160,height:120,degraded:true}};}}),
  runModelingAgent({text:'创建另一个主体',document:createInitialDoc(),selection:[],config,streamFn:gpu.fn,captureEvidence:async(doc,view,targetIds,time)=>({image,backend:'webgl',projectId:doc.projectId,revision:doc.revision,view,targetIds,time})})
 ]);
 assert.match(JSON.stringify(soft.contexts),/软件几何检查|software几何检查/);assert.match(JSON.stringify(soft.contexts),/材质.*(unknown|验收|通过)/);assert.ok(soft.contexts.some(c=>c.messages.some(m=>m.role==='toolResult'&&m.toolName==='audit_model_detail'&&m.isError)));
 assert.ok(softResult.activity.events.some(x=>x.includes('160×120')));assert.equal(gpuResult.activity.events.some(x=>x.includes('软件')),false);console.log('PASS concurrent software/GPU evidence retains local backend and software cannot pass material audit');
}finally{await server.close();}
