import {Agent,type AgentTool,type AgentToolResult,type StreamFn} from '@earendil-works/pi-agent-core';
import type {Api,ImageContent,Model} from '@earendil-works/pi-ai';
import {stream} from '@earendil-works/pi-ai/api/openai-completions';
import {Type,type TSchema} from 'typebox';
import {getFetch,type ModelConfig,type ConversationTurn} from './provider';
import {ensureToolParametersObject} from './toolParameters';
import {normalizeTaskBudget,taskBudgetReason} from './taskBudget';
import {normalizedUsage} from './executionTelemetry';
import {AGENT_LIMITS} from './agentPolicy';
import type {AgentActivity,AgentControl} from './modelingAgent';
import type {BlenderActivityProgress} from './blenderProgress';
import {blenderSkillGuide} from './blenderSkill';
import {readSource,editSource} from './modelingProgramSource';
import {resolveConversationIntent} from '../domain/conversationScope';
import {runBlenderScript,MAX_BLENDER_SCRIPT_BYTES,type BlenderResult,type ConfirmBlenderScript} from '../scene/blenderModeling';

interface BlenderOptions {
 text:string;config:ModelConfig;images:string[];history:ConversationTurn[];previous?:BlenderResult|null;questionOnly?:boolean;
 signal:AbortSignal;confirm?:ConfirmBlenderScript;streamFn?:StreamFn;
 onActivity:(activity:AgentActivity)=>void;onResult:(result:BlenderResult)=>void;
 onDiagnostic?:(kind:string,data:unknown)=>void;
 onControl:(control:AgentControl|null)=>void;onSteeringApplied:(id:string)=>void;
}
const image=(url:string):ImageContent=>{const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);if(!match)throw Error('参考图格式无效');return {type:'image',mimeType:match[1],data:match[2]};};
async function renderImage(blob:Blob):Promise<ImageContent>{
 const bytes=new Uint8Array(await blob.arrayBuffer()),chunks:string[]=[];
 for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
 return {type:'image',mimeType:'image/png',data:btoa(chunks.join(''))};
}
const textResult=(value:unknown):AgentToolResult<unknown>=>({content:[{type:'text',text:JSON.stringify(value)}],details:{}});
/** Blender owns geometry, materials and rendering. No SceneDocument enters this path. */
export async function runBlenderAgent(options:BlenderOptions):Promise<string> {
 const {config:cfg}=options,budget=normalizeTaskBudget(cfg.taskBudget),started=Date.now(),deadline=new AbortController();
 const signal=AbortSignal.any([options.signal,deadline.signal]);
 const activity:AgentActivity={title:'准备 Blender 建模',phase:'building',turn:0,toolCalls:0,characters:0,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:started,plan:[],events:[],timings:[]};
 const emit=(title:string)=>{activity.title=title;activity.lastEventAt=Date.now();options.onActivity(structuredClone(activity));};
 const updateProgress=(stage:BlenderActivityProgress['stage'],instruction:string,script?:string)=>{
  if(signal.aborted)return;
  const previous=activity.blenderProgress,at=Date.now(),events=previous?.events??[],last=events[events.length-1];
  activity.blenderProgress={stage,instruction,script:script===undefined?previous?.script??'':script.slice(-24000),receivedChars:script===undefined?previous?.receivedChars??0:script.length,updatedAt:at,events:last?.stage===stage&&last?.message===instruction?events:[...events,{stage,message:instruction,at}].slice(-30)};
  emit(instruction);
 };
 let result:BlenderResult|undefined,current=options.previous??undefined,lastError='',questionOnly=options.questionOnly===true,accepting=true,resultTurn=-1,reviewedTurn=-1;
 const check=()=>{signal.throwIfAborted();const reason=taskBudgetReason(budget,Date.now()-started,activity.turn,activity.inputTokens+activity.outputTokens);if(reason)throw Error(reason);};
 const source=()=>{if(!current)throw Error('尚无 Blender 脚本，请先生成模型');return current.script;};
 // Character reads reuse the language-independent source windows, not the JavaScript navigation index.
 const metadata=()=>{const {version,chars,lineCount}=readSource(source(),{startChar:0,endChar:0});return {version,chars,lineCount};};
 const assertVersion=(expectedVersion:string|undefined)=>{if(expectedVersion!==metadata().version)throw Error('Stale expectedVersion：请先读取当前 Blender 脚本版本，未执行修改');};
 const execute=async(name:string,script:string,toolSignal?:AbortSignal):Promise<AgentToolResult<unknown>>=>{
  check();if(questionOnly)throw Error('用户只提问，禁止执行建模');
  if(current?.script===script)throw Error('脚本未发生变化，请修正具体参数或代码后再生成');
  const executionSignal=toolSignal?AbortSignal.any([signal,toolSignal]):signal;
  updateProgress('starting','执行完整 Blender Python 脚本：'+name,script);
  const generated=await runBlenderScript({name,script},options.confirm,executionSignal,progress=>updateProgress(progress.stage,progress.message));executionSignal.throwIfAborted();
  const version=readSource(script,{startChar:0,endChar:0}).version;
  current=result={...generated,review:{version,status:'pending',observations:'',issues:[]}};resultTurn=activity.turn;reviewedTurn=-1;
  options.onResult(result);check();
  const picture=await renderImage(result.render);check();
  const receipt={...metadata(),name,status:'pending',next:'下一轮读取这张真实渲染，对照用户要求和参考图；用 review_blender_result 记录可见观察与具体问题。发现问题后局部修复，不把导出成功当作验收。'};
  return {content:[{type:'text',text:JSON.stringify(receipt)},picture],details:{version}};
 };
 const tool=<T extends TSchema>(name:string,label:string,description:string,parameters:T,executeTool:(args:Parameters<AgentTool<T>['execute']>[1],signal?:AbortSignal)=>Promise<AgentToolResult<unknown>>):AgentTool<T>=>({name,label,description,parameters:ensureToolParametersObject(parameters) as T,execute:async(_id,args,toolSignal)=>{check();return executeTool(args,toolSignal);}});
 const tools:AgentTool[]=[
  tool('run_blender_python','Blender 建模与渲染','在空工程执行完整 bpy 脚本并返回原始 BLEND、GLB 和真实 PNG。首次创建或明确整体重建用此工具；已有脚本必须传当前 expectedVersion。局部修改优先 patch_blender_script。不要自行导出。',Type.Object({name:Type.String({minLength:1,maxLength:80}),script:Type.String({minLength:1,maxLength:MAX_BLENDER_SCRIPT_BYTES}),expectedVersion:Type.Optional(Type.String())},{additionalProperties:false}),async(args,s)=>{
   if(current)assertVersion(args.expectedVersion);
   return execute(args.name,args.script,s);
  }),
  tool('read_blender_script','读取 Blender 脚本','读取当前脚本版本及有界字符窗口。零基 UTF-16，endChar 不含；省略返回前 12000 字符，用 nextChar 续读。不会执行 Python。',Type.Object({startChar:Type.Optional(Type.Integer({minimum:0})),endChar:Type.Optional(Type.Integer({minimum:0}))},{additionalProperties:false}),async args=>textResult(readSource(source(),{startChar:args.startChar??0,...(args.endChar===undefined?{}:{endChar:args.endChar})}))),
  tool('patch_blender_script','局部修改 Blender 脚本','基于当前 expectedVersion 应用 1–8 个唯一匹配、不重叠的字面 find/replace，再执行完整脚本。未涉及源码原样保留；失败不覆盖上次成功结果。不是几何范围隔离，也不包含工作台手动编辑。',Type.Object({expectedVersion:Type.String(),name:Type.Optional(Type.String({minLength:1,maxLength:80})),patches:Type.Array(Type.Object({find:Type.String({minLength:1}),replace:Type.String()},{additionalProperties:false}),{minItems:1,maxItems:8})},{additionalProperties:false}),async(args,s)=>{
   const edited=editSource(source(),{expectedVersion:args.expectedVersion,patches:args.patches},MAX_BLENDER_SCRIPT_BYTES);
   return execute(args.name??current!.name,edited.source,s);
  }),
  tool('review_blender_result','记录 Blender 看图复核','仅在下一轮看过最新返回的 PNG 后记录具体观察、问题及当前 expectedVersion；issues 空只表示该图未发现明确问题，不是工程验收。存在问题继续局部修复，不能清空已知问题而不改脚本。',Type.Object({expectedVersion:Type.String(),observations:Type.String({minLength:1,maxLength:2000}),issues:Type.Array(Type.String({minLength:1,maxLength:500}),{maxItems:20})},{additionalProperties:false}),async args=>{
   if(!result)throw Error('本轮尚未生成并返回渲染图');assertVersion(args.expectedVersion);
   if(activity.turn<=resultTurn)throw Error('必须在下一轮读取实际渲染图后复核，不能在生成同轮声明已看图');
   if(!args.observations.trim()||args.issues.some(issue=>!issue.trim()))throw Error('观察和问题不能只含空白');
   if(result.review?.issues.length&&args.issues.length===0)throw Error('已记录的问题尚未修复，请先修改脚本并获取新渲染');
   result=current={...result,review:{version:args.expectedVersion,status:args.issues.length?'issues':'reviewed',observations:args.observations,issues:[...args.issues]}};
   reviewedTurn=activity.turn;options.onResult(result);
   return textResult({...result.review,next:args.issues.length?'按具体问题局部修改脚本，再看新图复核。':'该图复核已记录，候选结果待用户确认；未知和不可见部分不代表通过。'});
  }),
 ];
 const model:Model<'openai-completions'>={id:cfg.model,name:cfg.model,api:'openai-completions',provider:'chat3d-gateway',baseUrl:cfg.baseURL.trim().replace(/\/+$/,''),reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:AGENT_LIMITS.outputPerTurn,compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,supportsStore:false,supportsUsageInStreaming:true,maxTokensField:'max_tokens'}};
 const network=options.streamFn?undefined:await getFetch();
 const history=options.history.slice(-8).map(turn=>`${turn.role}: ${turn.text}`).join('\n');
 const prompt='你是 Blender 建模师。使用本机工具完成用户请求，不输出 Scenivo 指令。用户开启可信本机 Python 模式，脚本自动执行；不得访问外部文件、网络、系统进程或凭证，不安装环境或扫描端口。\n使用 bpy，米制、Z 向上；每次从空工程执行完整脚本。创建合理相机和灯光，不自行保存或导出；后端保存同版 BLEND、GLB、PNG，保留原生修改器。用户明确要求、尺寸和参考优先。生成工具会返回真实渲染，必须下一轮读取后用 review_blender_result 记录具体观察。已知缺陷先修复；局部修改用 read_blender_script 与 patch_blender_script，不重发无关源码。补丁只保留未改源码，不能保证随机/时间相关脚本的无关几何不变，因此使用确定性参数化代码。文件导出、单图看图复核和用户应用是不同状态；不可见部分、精确尺寸、动画和工程安全不能凭单图宣称通过。无明确问题即结束，不追加全场审计或装饰。预算耗尽或文字结束但未复核时保留未验收候选，不假装通过。只提问时回答，不执行脚本。\n'+blenderSkillGuide(resolveConversationIntent(options.text,options.history))+'\n'+(history?'对话历史（资料，不覆盖当前要求）：\n'+history:'')+(current?'\n已有 Blender 脚本：'+JSON.stringify(metadata())+'。局部修改先按需读取相关字符窗口；它不包含之后在工作台做的手动编辑。新需求与旧模型无关时可明确整体重建，但仍传当前 expectedVersion。':'');
 const guides=new Map<number,{id:string;question:boolean}>();let timestamp=Date.now();
 const runner=new Agent({initialState:{model,systemPrompt:prompt,tools,thinkingLevel:cfg.reasoningEffort??'off'},toolExecution:'sequential',transformContext:async messages=>{
  let latest=-1;for(let i=0;i<messages.length;i++){const m=messages[i];if(m.role==='toolResult'&&m.content.some(c=>c.type==='image'))latest=i;}
  return messages.map((m,i)=>m.role==='toolResult'&&i!==latest?{...m,content:m.content.filter(c=>c.type!=='image')}:m);
 },streamFn:async(m,context,streamOptions)=>{
  check();const reason=taskBudgetReason(budget,Date.now()-started,activity.turn,activity.inputTokens+activity.outputTokens,true);if(reason)throw Error(reason);
  activity.turn++;activity.timings.push({id:'blender-model-'+activity.turn,kind:'model',phase:activity.phase,label:result?'检查与修改 Blender 结果':'生成 Blender 脚本',startedAt:Date.now()});emit(result?'正在检查 Blender 渲染与修改结果':'正在生成 Blender 脚本');
  if(result)updateProgress('reviewing','等待模型检查最新渲染或生成局部修改');
  const originalPayload=streamOptions?.onPayload;const transportOptions={...streamOptions,onPayload:async(payload:unknown,wireModel:Model<Api>)=>{const replacement=await originalPayload?.(payload,wireModel);const body=(replacement===undefined?payload:replacement) as Record<string,unknown>;if(cfg.reasoningEffort)body.reasoning_effort=cfg.reasoningEffort;else delete body.reasoning_effort;options.onDiagnostic?.('model_request',body);return body;}};
  if(options.streamFn)return options.streamFn(m,context,transportOptions);
  return stream(model,context,{...transportOptions,apiKey:cfg.apiKey.trim(),fetch:network,maxTokens:AGENT_LIMITS.outputPerTurn,maxRetries:0,timeoutMs:AGENT_LIMITS.idleTimeoutMs,onProviderStreamEvent:data=>options.onDiagnostic?.('provider_event',data)});
 },beforeToolCall:async({toolCall})=>{
  check();if(runner.hasQueuedMessages())return {block:true,reason:'先处理用户最新补充'};
  if(questionOnly&&toolCall.name!=='read_blender_script')return {block:true,reason:'只回答问题，不建模或改写复核结论'};
  if(result&&resultTurn===activity.turn&&toolCall.name!=='read_blender_script')return {block:true,reason:'新渲染已返回，先在下一轮看图，再复核或修改'};
  return undefined;
 },finishTurn:async({message})=>{
  if(runner.hasQueuedMessages())return {action:'continue'};
  if(reviewedTurn===activity.turn&&result?.review?.status==='reviewed')return {action:'end'};
  if(message.stopReason==='stop'&&!message.content.some(c=>c.type==='toolCall'))return {action:'end'};
  return undefined;
 }});
 const unsubscribe=runner.subscribe(event=>{
  if(signal.aborted)return;
  if(event.type==='message_end')options.onDiagnostic?.('message',event.message);
  if(event.type==='tool_execution_start')options.onDiagnostic?.('tool_start',{id:event.toolCallId,name:event.toolName,arguments:event.args});
  if(event.type==='tool_execution_end')options.onDiagnostic?.('tool_end',{id:event.toolCallId,name:event.toolName,error:event.isError,result:event.result});
  if(event.type==='message_end'&&event.message.role==='user'){const guide=guides.get(event.message.timestamp);if(guide){questionOnly=guide.question;guides.delete(event.message.timestamp);reviewedTurn=-1;if(!questionOnly&&result){result=current={...result,review:{version:metadata().version,status:'pending',observations:'',issues:result.review?.issues??[]}};options.onResult(result);}options.onSteeringApplied(guide.id);}}
  if(event.type==='tool_execution_start'){const entry=tools.find(t=>t.name===event.toolName)!;activity.phase=event.toolName==='review_blender_result'?'reviewing':event.toolName==='patch_blender_script'?'repairing':'building';activity.toolCalls++;activity.timings.push({id:event.toolCallId,kind:'tool',toolName:event.toolName,phase:activity.phase,label:entry?.label??event.toolName,startedAt:Date.now()});if(event.toolName==='review_blender_result')updateProgress('reviewing','正在记录最新效果图的可见问题与复核结论');emit(entry?.label??event.toolName);}
  if(event.type==='tool_execution_end'){const timing=activity.timings.find(t=>t.id===event.toolCallId);if(timing){timing.endedAt=Date.now();timing.failed=event.isError;}if(event.isError){const failure:AgentToolResult<unknown>=event.result;lastError=failure.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');updateProgress('failed','当前 Blender 操作失败，已保留上次成功结果；具体原因见失败详情');}emit(event.isError?'Blender 操作未完成':result?.review?.status==='pending'?'Blender 渲染已返回，待看图复核':'Blender 操作已完成');}
  if(event.type==='message_update'){
   const delta=event.assistantMessageEvent;
   if(delta.type==='text_delta'){
    const id='blender-'+activity.turn,previous=activity.explanations?.find(e=>e.id===id);
    activity.explanations=[...(activity.explanations??[]).filter(e=>e.id!==id),{id,text:((previous?.text??'')+delta.delta).slice(0,4000),createdAt:previous?.createdAt??Date.now(),phase:activity.phase}];
   }
   if(delta.type==='toolcall_start'||delta.type==='toolcall_delta'||delta.type==='toolcall_end'){
    const call=delta.partial.content[delta.contentIndex];
    if(call?.type==='toolCall'){
     const args=call.arguments;
     if(args&&typeof args==='object'&&'script' in args&&typeof args.script==='string')updateProgress('receiving','正在生成 Python 脚本（尚未执行）',args.script);
     else if(call.name==='patch_blender_script'&&args&&typeof args==='object'&&'patches' in args&&Array.isArray(args.patches))updateProgress('receiving','正在生成局部脚本修改（尚未执行）',JSON.stringify(args.patches,null,2));
     else updateProgress(call.name==='review_blender_result'?'reviewing':'receiving',tools.find(t=>t.name===call.name)?.label??'正在接收 Blender 操作');
    }
   }
   if(delta.type==='text_delta'||delta.type==='toolcall_delta'){activity.characters+=delta.delta.length;const timing=activity.timings.find(t=>t.id==='blender-model-'+activity.turn);if(timing&&timing.firstContentAt===undefined)timing.firstContentAt=Date.now();emit(activity.blenderProgress?.instruction??'正在接收 Blender 建模或复核回复');}
  }
  if(event.type==='message_end'&&event.message.role==='assistant'){const usage=normalizedUsage(event.message.usage);activity.inputTokens+=usage.inputTokens;activity.outputTokens+=usage.outputTokens;activity.usageReported=activity.usageReported||usage.usageState!=='unknown';const timing=activity.timings.find(t=>t.id==='blender-model-'+activity.turn);if(timing){timing.endedAt=Date.now();Object.assign(timing,usage);}const text=event.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');if(text){const id='blender-'+activity.turn,previous=activity.explanations?.find(e=>e.id===id);activity.explanations=[...(activity.explanations??[]).filter(e=>e.id!==id),{id,text:text.slice(0,4000),phase:activity.phase,createdAt:previous?.createdAt??Date.now()}];}emit(activity.title);}
 });
 const abort=()=>runner.abort();signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>deadline.abort(Error('Blender 任务达到时间上限')),budget.maxMinutes*60_000);
 options.onControl({steer:(id,text,images=[],mode='guide')=>{if(!accepting||signal.aborted)return false;const at=++timestamp;guides.set(at,{id,question:mode==='question'});runner.steer({role:'user',content:[{type:'text',text:(mode==='question'?'只回答问题，禁止建模：':'最新补充要求：')+text+(mode==='question'?'':'\n本次补充涉及的建模参考（不新增需求）：\n'+blenderSkillGuide(text))},...images.map(image)],timestamp:at});return true;}});
 try{
  await runner.prompt(options.text,options.images.map(image));check();const last=[...runner.state.messages].reverse().find(m=>m.role==='assistant');
  if(last?.role==='assistant'&&(last.stopReason==='error'||last.stopReason==='aborted'))throw Error(last.errorMessage||'模型服务未完成请求');
  const explanation=last?.role==='assistant'?last.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):'';
  if(!result){if(questionOnly){activity.outcome='answered';emit('已回答问题，未执行 Blender');return explanation||'本轮未执行建模。';}throw Error(lastError||'模型没有调用 Blender 建模工具，未产生模型文件。'+(explanation?'\n模型最后回复：'+explanation:''));}
  const review=result.review!,reviewed=review.status==='reviewed';activity.outcome=reviewed?'answered':'partial';
  const summary=reviewed?'Blender 模型已生成，已对返回渲染进行看图复核；仍待用户确认，不代表工程验收。':review.status==='issues'?'Blender 候选模型已保留，仍有已知问题：'+review.issues.join('；'):'Blender 候选模型已生成，尚未完成看图复核。';
  emit(summary);return summary+(review.observations?'\n看图记录：'+review.observations:'')+(questionOnly&&explanation?'\n'+explanation:'');
 }finally{accepting=false;clearTimeout(timer);unsubscribe();signal.removeEventListener('abort',abort);options.onControl(null);}
}
