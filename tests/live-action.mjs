import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {runModelingAgent}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {liveProgress,actionLabel}=await server.ssrLoadModule('/src/ui/chat/liveProgress.ts');
 const {runDiagnostics}=await server.ssrLoadModule('/src/domain/runDiagnostics.ts');
 const snapshots=[];let turn=0;
 const streamFn=async()=>{
  const message={role:'assistant',content:[{type:'toolCall',id:'current-action',name:'read_scene',arguments:{}}],api:'openai-completions',provider:'fixture',model:'fixture',stopReason:'toolUse',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  const stream=createAssistantMessageEventStream();
  if(turn++){const done={...message,content:[{type:'text',text:'已查看当前场景'}],stopReason:'stop'};queueMicrotask(()=>{stream.push({type:'start',partial:done});stream.push({type:'done',reason:'stop',message:done});stream.end();});return stream;}
  queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'toolcall_start',contentIndex:0,partial:message});stream.push({type:'toolcall_delta',contentIndex:0,delta:'{}',partial:message});stream.push({type:'done',reason:'toolUse',message});stream.end();});return stream;
 };
 await runModelingAgent({text:'检查当前场景',document:createInitialDoc(),selection:[],config:{baseURL:'https://fixture.invalid/v1',apiKey:'not-sent',model:'fixture'},streamFn,onActivity:a=>snapshots.push(structuredClone(a)),captureAvailable:()=>false});
 const receiving=snapshots.find(a=>a.timings.some(t=>t.kind==='model'&&t.pendingToolName==='read_scene'&&t.firstContentAt!==undefined&&t.endedAt===undefined));
 assert.ok(receiving);const live=liveProgress(receiving);assert.ok(live.label.includes(actionLabel('read_scene')));assert.equal(receiving.timings.some(t=>t.kind==='tool'&&t.endedAt===undefined),false);
 const executing=snapshots.find(a=>a.timings.some(t=>t.kind==='tool'&&t.toolName==='read_scene'&&t.endedAt===undefined));assert.ok(executing);assert.equal(liveProgress(executing).label,actionLabel('read_scene'));
 const diagnostic=runDiagnostics('generating',receiving,null);assert.equal(diagnostic.run.timings.find(t=>t.kind==='model').pendingToolName,'read_scene');
 const malicious=structuredClone(receiving);malicious.timings[0].pendingToolName='Bearer private-secret';assert.equal(runDiagnostics('generating',malicious,null).run.timings[0].pendingToolName,undefined);
 assert.equal(actionLabel('constructor'),undefined);assert.equal(actionLabel('private_tool'),undefined);
 console.log('PASS streamed action identity is visible before execution, actual execution stays distinct, and diagnostics accept only known names');
}finally{await server.close();}
