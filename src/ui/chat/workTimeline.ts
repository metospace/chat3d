import type {AgentActivity,ActivityTiming} from '../../ai/modelingAgent';
import type {MessageRun} from '../../store';
import {customerText} from '../../domain/customerProgress';
import {sanitizeGenerationText} from '../../domain/generationFailure';

type WorkPhase=NonNullable<AgentActivity['phase']>;
export type WorkTimelineStatus='running'|'ended'|'interrupted'|'recorded';
export interface WorkTimelineEntry {
 id:string;
 kind:'explanation';
 title:string;
 text:string;
 startedAt?:number;
 /** Timestamp of the last public explanation, not evidence of execution completing. */
 endedAt?:number;
 status:WorkTimelineStatus;
 phase?:WorkPhase;
}
const timestamp=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&!Number.isNaN(new Date(value).getTime())?value:undefined;
const phaseTitle:Record<WorkPhase,string>={planning:'设计',building:'构建与编辑',reviewing:'复核',repairing:'细化与修正'};

/** Only public prose belongs in the work record, never tool payloads or private reasoning. */
function publicText(value:string|undefined):string|undefined{
 if(!value)return undefined;
 const text=value.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi,'').replace(/```[\s\S]*?(?:```|$)/g,'').trim();
 if(!text||/^[\[{]/.test(text))return undefined;
 return customerText(sanitizeGenerationText(text,{fallback:'本次处理未完成，你可以继续描述要修改的地方。'}));
}

/** Older records may identify their model response, or fall inside an unambiguous timed phase. */
function legacyPhase(explanation:{id:string;createdAt?:number},timings:ActivityTiming[]):WorkPhase|undefined{
 const response=/^explanation-(\d+)$/.exec(explanation.id);
 if(response){
  const associated=timings.find(step=>step.kind==='model'&&step.id===`model-${response[1]}`);
  if(associated?.phase)return associated.phase;
 }
 const at=timestamp(explanation.createdAt);
 if(at===undefined)return undefined;
 let phase:WorkPhase|undefined;
 for(const step of timings){
  const start=timestamp(step.startedAt),end=timestamp(step.endedAt);
  if(start===undefined||end===undefined||at<start||at>end)continue;
  if(!step.phase||(phase!==undefined&&phase!==step.phase))return undefined;
  phase=step.phase;
 }
 return phase;
}

/** Group consecutive public explanations; execution diagnostics never become visible events. */
export function workTimeline(run:Pick<MessageRun,'status'>,activity:AgentActivity|undefined|null):WorkTimelineEntry[]{
 const timings=activity?.timings??[];
 const explanations=(activity?.explanations??[]).map(explanation=>({explanation,text:publicText(explanation.text),at:timestamp(explanation.createdAt)}))
  .filter((item):item is typeof item&{text:string}=>item.text!==undefined)
  .sort((a,b)=>a.at===undefined?(b.at===undefined?0:1):b.at===undefined?-1:a.at-b.at);
 const entries:WorkTimelineEntry[]=[];
 let distinct=new Set<string>();
 for(const {explanation,text,at} of explanations){
  const phase=explanation.phase??legacyPhase(explanation,timings);
  let entry=entries[entries.length-1];
  if(!entry||entry.phase!==phase){
   entry={id:`explanation-${explanation.id??entries.length}`,kind:'explanation',title:phase?phaseTitle[phase]:'工作进展',phase,text:'',startedAt:at,endedAt:at,status:'recorded'};
   entries.push(entry);distinct=new Set();
  }
  if(!distinct.has(text)){entry.text+=`${entry.text?'\n\n':''}${text}`;distinct.add(text);}
  if(at!==undefined){entry.startedAt??=at;entry.endedAt=at;}
 }
 let lastDated=entries.length-1;
 while(lastDated>=0&&entries[lastDated].startedAt===undefined)lastDated--;
 for(let index=0;index<entries.length;index++){
  const entry=entries[index];
  if(entry.startedAt===undefined)continue;
  const last=index===lastDated;
  // An explanation records what was said, never whether a tool or the model succeeded.
  entry.status=!last?'ended':run.status==='running'
   ?activity?.phase&&entry.phase&&activity.phase!==entry.phase?'ended':'running'
   :run.status==='stopped'||run.status==='failed'?'interrupted':'ended';
 }
 return entries;
}
export function workTimelineTime(value:number|undefined):string{
 const time=timestamp(value);
 if(time===undefined)return '时间未记录';
 const date=new Date(time),pad=(part:number)=>String(part).padStart(2,'0');
 return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export const WORK_TIMELINE_STATUS:Record<WorkTimelineStatus,string>={running:'进行中',ended:'已结束',interrupted:'已中断',recorded:'已记录'};
