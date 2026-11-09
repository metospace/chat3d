import type {AgentActivity} from '../../ai/modelingAgent';
import type {MessageRun} from '../../store';
import {customerText} from '../../domain/customerProgress';
import {sanitizeGenerationText} from '../../domain/generationFailure';
import {actionLabel} from './liveProgress';

const timestamp=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&!Number.isNaN(new Date(value).getTime())?value:undefined;
/** Display only public prose; never raw payloads or private reasoning. */
function publicText(value:string|undefined):string|undefined{
 if(!value)return undefined;
 const text=value.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi,'').replace(/```[\s\S]*?(?:```|$)/g,'').trim();
 if(!text||/^[\[{]/.test(text))return undefined;
 const empty='__no_public_progress__',safe=sanitizeGenerationText(text,{fallback:empty});
 return safe!==empty?customerText(safe):undefined;
}
export interface ProgressEntry {id:string;kind:'explanation'|'action';text:string;at?:number;status:'recorded'|'running'|'completed'|'failed'|'interrupted';summary?:string;count?:number}
/** Flat public prose and observed actions, ordered by recorded timestamps. */
export function progressFeed(run:Pick<MessageRun,'status'>,activity:AgentActivity|undefined|null):ProgressEntry[]{
 const entries:ProgressEntry[]=[];
 for(const explanation of activity?.explanations??[]){const text=publicText(explanation.text);if(text)entries.push({id:'prose-'+explanation.id,kind:'explanation',text,at:timestamp(explanation.createdAt),status:'recorded'});}
 for(const timing of activity?.timings??[]){
  if(timing.kind!=='tool'||timing.repeatedInput)continue;
  const text=actionLabel(timing.toolName);if(!text)continue;
  const summary=publicText(timing.summary);
  entries.push({id:'action-'+timing.id,kind:'action',text,at:timestamp(timing.startedAt),status:timing.failed?(run.status==='stopped'&&/用户停止|已停止生成|操作未完成/.test(timing.detail??'')?'interrupted':'failed'):timing.endedAt!==undefined?'completed':run.status==='running'?'running':'interrupted',...(summary&&summary!==text?{summary}:{}),count:1});
 }
 entries.sort((a,b)=>a.at===undefined?(b.at===undefined?0:1):b.at===undefined?-1:a.at-b.at);
 const condensed:ProgressEntry[]=[];
 for(const entry of entries){const previous=condensed[condensed.length-1];
  if(previous&&entry.kind==='action'&&previous.kind==='action'&&previous.text===entry.text&&previous.status==='completed'&&entry.status==='completed'&&previous.summary===entry.summary){previous.count=(previous.count??1)+1;continue;}
  if(previous?.kind==='explanation'&&entry.kind==='explanation'&&previous.text===entry.text)continue;
  condensed.push({...entry});
 }
 return condensed;
}
export function workTimelineTime(value:number|undefined):string{
 const time=timestamp(value);if(time===undefined)return '时间未记录';
 const date=new Date(time),pad=(part:number)=>String(part).padStart(2,'0');
 return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
