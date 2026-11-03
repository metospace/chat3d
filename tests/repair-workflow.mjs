import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {runModelingAgent}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const base=createInitialDoc(),transform={position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]};
 const operations=Array.from({length:5},(_,i)=>({op:'createAssembly',name:'设备'+i,parts:[{name:'设备主体'+i,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{...transform,position:[i*3,0,0]}}]}));
 const doc=applyBatch(base,{operations}).doc,ids=doc.nodes.map(n=>n.assemblyId),contexts=[];let turn=0,captures=0;
 const target=doc.nodes[0].id,reference='data:image/png;base64,cmVmZXJlbmNl';
 const difference={id:'body-depth',featureKey:'body',nodeIds:[target],observed:'设备主体纵向过短',expected:'保持宽度并增加纵深',action:'只重建设备0主体深度',view:'side'};
 const steps=[
  [{name:'read_scene_contract',args:{}},{name:'capture_quality_review',args:{overviewOnly:true}}],
  [{name:'review_model',args:{observations:'全景已找到主体深度差异，应先修改目标',issues:[],referenceDifferences:[difference]}},{name:'edit_scene',args:{summary:'仅修改设备0主体深度',operations:[{op:'updateParameters',targetId:target,geometry:{type:'box',params:{width:1,height:1,depth:2}}}]}},{name:'capture_quality_review',args:{componentIds:[ids[0]]}}],
  [{name:'review_model',args:{observations:'根据当前侧视设备0深度已改，其他设备保留',issues:[],resolvedDifferenceIds:['body-depth']}},...ids.slice(1).map(id=>({name:'capture_multiview',args:{componentId:id,views:['front','side','back']}}))],
  [{name:'recall_evidence',args:{mode:'list'}}],
  context=>{const list=context.messages.filter(m=>m.role==='toolResult'&&m.toolName==='recall_evidence').at(-1),catalog=JSON.parse(list.content[0].text);const packet=catalog.captures.find(c=>c.revision===doc.revision+1&&c.scopes.includes(ids[1]));assert.ok(packet);return [{name:'recall_evidence',args:{mode:'images',captureId:packet.captureId,count:2}}];},
  '保留实际修改和仍待人工核对的项目'
 ];
 const streamFn=async(_model,context)=>{contexts.push(structuredClone(context));const step=steps[turn++]??'结束',actions=typeof step==='function'?step(context):step,content=Array.isArray(actions)?actions.map((a,i)=>({type:'toolCall',id:`repair-${turn}-${i}`,name:a.name,arguments:a.args})):[{type:'text',text:actions}];const message={role:'assistant',content,api:'openai-completions',provider:'fixture',model:'fixture',stopReason:Array.isArray(actions)?'toolUse':'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});stream.end();});return stream;};
 const result=await runModelingAgent({text:'按参考图仅修主体深度，其他设备布局和材质保持',config:{baseURL:'https://fixture.invalid/v1',apiKey:'not-sent',model:'fixture',taskBudget:{maxRounds:8}},document:doc,qualityBaseline:base,images:[reference],selection:[],streamFn,capture:async(d,view,targetIds)=>{captures++;return 'data:image/png;base64,'+Buffer.from(JSON.stringify([d.revision,view,targetIds])).toString('base64');}});
 const failures=result.activity.timings.filter(t=>t.kind==='tool'&&t.failed);assert.deepEqual(failures.map(t=>({tool:t.toolName,detail:t.detail})),[]);
 assert.equal(result.result.doc.nodes[0].geometry.params.depth,2);assert.deepEqual(result.result.doc.nodes.slice(1),doc.nodes.slice(1));assert.deepEqual(result.result.doc.materials,doc.materials);assert.equal(result.activity.referenceRepairs.length,0);
 for(const context of contexts){const generated=context.messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content.filter(c=>c.type==='image'));assert.ok(generated.length<=6);const refs=context.messages.filter(m=>m.role==='user').flatMap(m=>m.content.filter(c=>c.type==='image'));assert.ok(refs.some(i=>i.data==='cmVmZXJlbmNl'));}
 assert.ok(captures>=16);assert.ok(contexts.at(-1).messages.some(m=>m.role==='toolResult'&&m.toolName==='recall_evidence'&&m.content.some(c=>c.type==='image')));
 console.log('PASS overview -> explicit difference -> actual local edit -> focused recheck -> archived recall; references, other components and original evidence limits preserved');
}finally{await server.close();}
