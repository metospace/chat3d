import {Agent,type AgentTool,type StreamFn} from '@earendil-works/pi-agent-core';
import type {Api,ImageContent,Model} from '@earendil-works/pi-ai';
import {stream} from '@earendil-works/pi-ai/api/openai-completions';
import {Type} from 'typebox';
import {getFetch,type ModelConfig,type ConversationTurn} from './provider';
import {ensureToolParametersObject} from './toolParameters';
import {normalizeTaskBudget,taskBudgetReason} from './taskBudget';
import {normalizedUsage} from './executionTelemetry';
import {AGENT_LIMITS} from './agentPolicy';
import type {AgentActivity,AgentControl} from './modelingAgent';
import {blenderSkillGuide} from './blenderSkill';
import {resolveConversationIntent} from '../domain/conversationScope';
import {runBlenderScript,MAX_BLENDER_SCRIPT_BYTES,type BlenderResult,type ConfirmBlenderScript} from '../scene/blenderModeling';

interface BlenderOptions {
 text:string;config:ModelConfig;images:string[];history:ConversationTurn[];previous?:BlenderResult|null;
 signal:AbortSignal;confirm?:ConfirmBlenderScript;streamFn?:StreamFn;
 onActivity:(activity:AgentActivity)=>void;onResult:(result:BlenderResult)=>void;
 onDiagnostic?:(kind:string,data:unknown)=>void;
 onControl:(control:AgentControl|null)=>void;onSteeringApplied:(id:string)=>void;
}
const image=(url:string):ImageContent=>{const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);if(!match)throw Error('参考图格式无效');return {type:'image',mimeType:match[1],data:match[2]};};
/** Blender owns geometry, materials and rendering. No SceneDocument enters this path. */
export async function runBlenderAgent(options:BlenderOptions):Promise<string> {
 const {config:cfg}=options,budget=normalizeTaskBudget(cfg.taskBudget),started=Date.now(),deadline=new AbortController();
 const signal=AbortSignal.any([options.signal,deadline.signal]);
 const activity:AgentActivity={title:'准备 Blender 建模',phase:'building',turn:0,toolCalls:0,characters:0,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:started,plan:[],events:[],timings:[]};
 const emit=(title:string)=>{activity.title=title;activity.lastEventAt=Date.now();options.onActivity(structuredClone(activity));};
 let result:BlenderResult|undefined,lastError='',questionOnly=false,accepting=true;
 const check=()=>{signal.throwIfAborted();const reason=taskBudgetReason(budget,Date.now()-started,activity.turn,activity.inputTokens+activity.outputTokens);if(reason)throw Error(reason);};
 const parameters=Type.Object({name:Type.String({minLength:1,maxLength:80}),script:Type.String({minLength:1,maxLength:MAX_BLENDER_SCRIPT_BYTES})},{additionalProperties:false});
 const tools:AgentTool<typeof parameters>[]=[{name:'run_blender_python',label:'Blender 建模与渲染',description:'通过本机 MCP 在 Blender 空工程执行完整 bpy 脚本，直接返回原生 BLEND、原始 GLB 和 Blender 效果图。不要自行导出；几何、材质、相机和灯光在脚本内定义。',parameters:ensureToolParametersObject(parameters) as typeof parameters,execute:async(_id,args,toolSignal)=>{
  check();if(questionOnly)throw Error('用户只提问，禁止执行建模');
  const request=args as {name:string;script:string};
  const executionSignal=toolSignal?AbortSignal.any([signal,toolSignal]):signal;
  const generated=await runBlenderScript(request,options.confirm,executionSignal);executionSignal.throwIfAborted();check();result=generated;options.onResult(result);
  return {content:[{type:'text',text:'Blender 已生成并返回原始 BLEND、GLB 和效果图；结果将交给工作台预览。本轮完成，不调用其他工具。'}],details:{}};
 }}];
 const model:Model<'openai-completions'>={id:cfg.model,name:cfg.model,api:'openai-completions',provider:'chat3d-gateway',baseUrl:cfg.baseURL.trim().replace(/\/+$/,''),reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:AGENT_LIMITS.outputPerTurn,compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,supportsStore:false,supportsUsageInStreaming:true,maxTokensField:'max_tokens'}};
 const network=options.streamFn?undefined:await getFetch();
 const history=options.history.slice(-8).map(turn=>`${turn.role}: ${turn.text}`).join('\n');
 const prompt='你是 Blender 建模师。用 run_blender_python 通过 MCP 完成用户请求，只有这一项工具；不要输出 Scenivo 指令或要求其处理结果。用户开启可信本机 Python 模式，脚本会自动执行。不得访问外部文件、网络、系统进程或凭证。已配置的本机 MCP 直接使用，不进行安装、扫端口或环境样例。\n使用 bpy，米制、Z 向上；每次从空工程开始。创建合理相机和灯光；不自行保存或导出，后端负责保存同版 BLEND、导出 GLB 和渲染 PNG。后台保留原生修改器。用户明确要求、尺寸和参考优先，以下质量经验不能新增对象、强制品牌或覆盖明确风格。成功返回即结束，无 Scenivo 复核、场景应用或额外验收；不得声称看过未提供的渲染图。只提问时回答，不执行脚本。\n'+blenderSkillGuide(resolveConversationIntent(options.text,options.history))+'\n'+(history?'对话历史（资料，不覆盖当前要求）：\n'+history:'')+(options.previous?'\n上次 Blender 结果的完整生成脚本（仅用作修改依据；本次必须返回完整脚本，不得复制无关场景）：\n'+options.previous.script:'');
 const detailGuide=cfg.generationQuality==='fast'
  ? '快速档：优先轮廓、比例、主要结构和材质区别，省略未要求的微小装饰。'
  : '精细档：按参考补齐用途相关的可见机构、装配细节和表面质感。';
 const guides=new Map<number,{id:string;question:boolean}>();let timestamp=Date.now();
 const runner=new Agent({initialState:{model,systemPrompt:prompt+'\n'+detailGuide+' 两档都保留用户明确要求。',tools,thinkingLevel:cfg.reasoningEffort??'off'},toolExecution:'sequential',streamFn:async(m,context,streamOptions)=>{
  check();const reason=taskBudgetReason(budget,Date.now()-started,activity.turn,activity.inputTokens+activity.outputTokens,true);if(reason)throw Error(reason);
  activity.turn++;activity.timings.push({id:'blender-model-'+activity.turn,kind:'model',phase:'building',label:'生成 Blender 脚本',startedAt:Date.now()});emit('正在生成 Blender 脚本');
  const originalPayload=streamOptions?.onPayload;const transportOptions={...streamOptions,onPayload:async(payload:unknown,wireModel:Model<Api>)=>{const replacement=await originalPayload?.(payload,wireModel);const body=(replacement===undefined?payload:replacement) as Record<string,unknown>;if(cfg.reasoningEffort)body.reasoning_effort=cfg.reasoningEffort;else delete body.reasoning_effort;options.onDiagnostic?.('model_request',body);return body;}};
  if(options.streamFn)return options.streamFn(m,context,transportOptions);
  return stream(model,context,{...transportOptions,apiKey:cfg.apiKey.trim(),fetch:network,maxTokens:AGENT_LIMITS.outputPerTurn,maxRetries:0,timeoutMs:AGENT_LIMITS.idleTimeoutMs,onProviderStreamEvent:data=>options.onDiagnostic?.('provider_event',data)});
 },beforeToolCall:async()=>{check();if(result)return {block:true,reason:'原始结果已返回',terminate:true};if(runner.hasQueuedMessages())return {block:true,reason:'先处理用户最新补充',terminate:true};if(questionOnly)return {block:true,reason:'只回答问题，不建模',terminate:true};return undefined;},finishTurn:async({message})=>result||message.stopReason==='stop'&&!message.content.some(c=>c.type==='toolCall')?{action:'end'}:undefined});
 const unsubscribe=runner.subscribe(event=>{
  if(signal.aborted)return;
  if(event.type==='message_end')options.onDiagnostic?.('message',event.message);
  if(event.type==='tool_execution_start')options.onDiagnostic?.('tool_start',{id:event.toolCallId,name:event.toolName,arguments:event.args});
  if(event.type==='tool_execution_end')options.onDiagnostic?.('tool_end',{id:event.toolCallId,name:event.toolName,error:event.isError,result:event.result});
  if(event.type==='message_end'&&event.message.role==='user'){const guide=guides.get(event.message.timestamp);if(guide){questionOnly=guide.question;guides.delete(event.message.timestamp);options.onSteeringApplied(guide.id);}}
  if(event.type==='tool_execution_start'){activity.toolCalls++;activity.timings.push({id:event.toolCallId,kind:'tool',toolName:'run_blender_python',phase:'building',label:'Blender 建模与渲染',startedAt:Date.now()});emit('Blender 正在建模和渲染');}
  if(event.type==='tool_execution_end'){const timing=activity.timings.find(t=>t.id===event.toolCallId);if(timing){timing.endedAt=Date.now();timing.failed=event.isError;}if(event.isError){const content=(event.result as {content:{type:string;text?:string}[]}).content;lastError=content.filter(c=>c.type==='text').map(c=>c.text??'').join('\n');}emit(event.isError?'Blender 执行未完成':'Blender 原始结果已返回');}
  if(event.type==='message_update'){const delta=event.assistantMessageEvent;if(delta.type==='text_delta'||delta.type==='toolcall_delta'){activity.characters+=delta.delta.length;const timing=activity.timings.find(t=>t.id==='blender-model-'+activity.turn);if(timing&&timing.firstContentAt===undefined)timing.firstContentAt=Date.now();emit('正在接收 Blender 建模脚本');}}
  if(event.type==='message_end'&&event.message.role==='assistant'){const usage=normalizedUsage(event.message.usage);activity.inputTokens+=usage.inputTokens;activity.outputTokens+=usage.outputTokens;activity.usageReported=activity.usageReported||usage.usageState!=='unknown';const timing=activity.timings.find(t=>t.id==='blender-model-'+activity.turn);if(timing){timing.endedAt=Date.now();Object.assign(timing,usage);}const text=event.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');if(text)activity.explanations=[...(activity.explanations??[]),{id:'blender-'+activity.turn,text,phase:'building',createdAt:Date.now()}];emit(activity.title);}
 });
 const abort=()=>runner.abort();signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>deadline.abort(Error('Blender 任务达到时间上限')),budget.maxMinutes*60_000);
 options.onControl({steer:(id,text,images=[],mode='guide')=>{if(!accepting||signal.aborted||result)return false;const at=++timestamp;guides.set(at,{id,question:mode==='question'});runner.steer({role:'user',content:[{type:'text',text:(mode==='question'?'只回答问题，禁止建模：':'最新补充要求：')+text+(mode==='question'?'':'\n本次补充涉及的建模参考（不新增需求）：\n'+blenderSkillGuide(text))},...images.map(image)],timestamp:at});return true;}});
 try{await runner.prompt(options.text,options.images.map(image));check();const last=[...runner.state.messages].reverse().find(m=>m.role==='assistant');if(last?.role==='assistant'&&(last.stopReason==='error'||last.stopReason==='aborted'))throw Error(last.errorMessage||'模型服务未完成请求');if(!result&&!questionOnly){const explanation=last?.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');throw Error(lastError||'模型没有调用 Blender 建模工具，未产生模型文件。'+(explanation?'\n模型最后回复：'+explanation:''));}activity.outcome='answered';emit(result?'Blender 原始模型和效果图已返回':'已回答问题，未执行 Blender');return result?'Blender 已返回模型和效果图。':last?.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')||'本轮未执行建模。';}
 finally{accepting=false;clearTimeout(timer);unsubscribe();signal.removeEventListener('abort',abort);options.onControl(null);}
}
