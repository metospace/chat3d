import packageInfo from '../../package.json';
import {normalizeTaskBudget,type TaskBudget} from './taskBudget';
export type UsageState='reported'|'reported-zero'|'unknown';
export function normalizedUsage(value:unknown,providerReported=false){
 const u=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const count=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
 const uncachedInputTokens=count(u.input),cacheReadTokens=count(u.cacheRead),cacheWriteTokens=count(u.cacheWrite),outputTokens=count(u.output);
 const inputTokens=uncachedInputTokens+cacheReadTokens+cacheWriteTokens;
 const usageState:UsageState=inputTokens+outputTokens>0?'reported':providerReported?'reported-zero':'unknown';
 return {inputTokens,uncachedInputTokens,cacheReadTokens,cacheWriteTokens,outputTokens,usageState};
}
export function providerHasUsage(data:unknown){
 if(!data||typeof data!=='object')return false;const d=data as Record<string,any>;const u=d.usage??d.response?.usage;
 return !!u&&typeof u==='object'&&[['prompt_tokens','completion_tokens'],['input_tokens','output_tokens']].some(keys=>keys.every(k=>typeof u[k]==='number'&&Number.isFinite(u[k])&&u[k]>=0));
}
export interface ExecutionConfiguration {
 model?:unknown;apiKey?:unknown;reasoningEffort?:unknown;taskBudget?:unknown;
}
export interface ReferenceImageMetadata {count?:unknown;dimensions?:readonly {width?:unknown;height?:unknown}[]}
export type SafeReasoningEffort='default'|'low'|'medium'|'high'|'xhigh';
export interface SafeReferenceImages {readonly count:number;readonly dimensions?:readonly (Readonly<{width:number;height:number}>|undefined)[]}
export interface ExecutionMetadata {
 readonly appVersion:string;readonly model?:string;readonly initialRevision?:number;readonly buildCommit:string;
 readonly contextPolicy:'edit-delta-v1';readonly executionMode:'pi';
 readonly reasoningEffort:SafeReasoningEffort;readonly taskBudget:Readonly<TaskBudget>;readonly referenceImages?:SafeReferenceImages;
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;
const safeModel=(value:unknown,secret:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)&&!/^sk-|bearer|token-/i.test(value)&&!value.includes('://')&&!(typeof secret==='string'&&secret&&value.includes(secret))?value:undefined;
const reasoningEffort=(value:unknown):SafeReasoningEffort=>value==='low'||value==='medium'||value==='high'||value==='xhigh'?value:'default';
function safeBudget(value:unknown):Readonly<TaskBudget>{
 const source=record(value),budget:Partial<TaskBudget>={};
 for(const key of ['maxMinutes','maxRounds','maxReportedTokens'] as const){const v=source[key];if(typeof v==='number'&&Number.isFinite(v))budget[key]=v;}
 return Object.freeze(normalizeTaskBudget(budget));
}
function safeReferenceImages(value:unknown):SafeReferenceImages|undefined{
 const source=record(value),imageCount=count(source.count);
 if(imageCount===undefined)return undefined;
 const dimensions=Array.isArray(source.dimensions)?source.dimensions.slice(0,imageCount).map(image=>{
  const item=record(image),width=typeof item.width==='number'&&Number.isSafeInteger(item.width)&&item.width>0?item.width:undefined,height=typeof item.height==='number'&&Number.isSafeInteger(item.height)&&item.height>0?item.height:undefined;
  return width!==undefined&&height!==undefined?Object.freeze({width,height}):undefined;
 }):undefined;
 return Object.freeze({count:imageCount,dimensions:dimensions?Object.freeze(dimensions):undefined});
}
/** Copy only operational values at launch; never retain the mutable config or image data. */
export function executionMetadata(config:ExecutionConfiguration,revision:number,referenceImages?:ReferenceImageMetadata):ExecutionMetadata{
 return Object.freeze({appVersion:packageInfo.version,model:safeModel(config.model,config.apiKey),initialRevision:count(revision),buildCommit:typeof __APP_BUILD_COMMIT__==='string'&&/^[a-f0-9]{40}$/.test(__APP_BUILD_COMMIT__)?__APP_BUILD_COMMIT__:'local',contextPolicy:'edit-delta-v1' as const,executionMode:'pi' as const,reasoningEffort:reasoningEffort(config.reasoningEffort),taskBudget:safeBudget(config.taskBudget),referenceImages:safeReferenceImages(referenceImages)});
}
/** Reapply the v1 allowlist to persisted/untrusted activity before diagnostic export. */
export function safeExecutionMetadata(value:unknown):Partial<ExecutionMetadata>{
 const source=record(value);
 return {appVersion:source.appVersion===packageInfo.version?packageInfo.version:undefined,model:safeModel(source.model,undefined),initialRevision:count(source.initialRevision),buildCommit:source.buildCommit==='local'||typeof source.buildCommit==='string'&&/^[a-f0-9]{40}$/.test(source.buildCommit)?source.buildCommit:undefined,contextPolicy:source.contextPolicy==='edit-delta-v1'?'edit-delta-v1':undefined,executionMode:source.executionMode==='pi'?'pi':undefined,reasoningEffort:source.reasoningEffort===undefined?undefined:reasoningEffort(source.reasoningEffort),taskBudget:source.taskBudget===undefined?undefined:safeBudget(source.taskBudget),referenceImages:safeReferenceImages(source.referenceImages)};
}
export const TOOL_FAILURE_CATEGORIES=['schema','geometry','scope','review-evidence','reference-mismatch','transport','other'] as const;
export type ToolFailureCategory=typeof TOOL_FAILURE_CATEGORIES[number];
export function safeToolFailureCategory(value:unknown):ToolFailureCategory|undefined{
 return TOOL_FAILURE_CATEGORIES.find(category=>category===value);
}
/** Inspect locally, returning only a fixed enum; never stringify errors, arguments or tool results. */
export function classifyToolFailure(error:unknown,toolName?:string):ToolFailureCategory{
 const message=typeof error==='string'?error:error instanceof Error&&typeof error.message==='string'?error.message:'';
 if(/schema|invalid (?:arguments|parameters)|validation failed|参数|命令字段|不支持或无效的操作|JSON/i.test(message))return 'schema';
 if(/fetch|network|connection|transport|HTTP\s+\d{3}|timeout|timed out|网络|连接失败|超时/i.test(message))return 'transport';
 if(/参考图.{0,30}(?:不符|不匹配|差异|禁止|不能)|reference.{0,30}(?:mismatch|differ|disallow)/i.test(message))return 'reference-mismatch';
 if(/编辑范围|作用范围|修改范围|选中范围|当前范围|未选中对象|位置锁|锁定|越界|scope|只能替换指定|其他组件/i.test(message))return 'scope';
 if(/截图|检查图|验收|证据|视觉|下一轮|evidence|review/i.test(message))return 'review-evidence';
 if(/geometry|mesh|topology|manifold|几何|网格|拓扑|三角|自相交|截面|轮廓|曲面|倒角/i.test(message))return 'geometry';
 if(toolName==='capture_view'||toolName==='capture_multiview'||toolName==='capture_component_intrinsic'||toolName==='capture_quality_review'||toolName==='capture_detail_diagnostic'||toolName==='review_model'||toolName==='audit_model_detail'||toolName==='audit_model_details_batch')return 'review-evidence';
 return 'other';
}
