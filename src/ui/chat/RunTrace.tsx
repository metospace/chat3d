import {useEffect,useId,useState} from 'react';
import {ConversationActions} from './ConversationActions';
import {activityProgress} from '../../domain/customerProgress';
import {runStatusLabel} from '../../domain/runStatusLabel';
import type {MessageRun} from '../../store';
import type {AgentActivity} from '../../ai/modelingAgent';
import {workTimeline,workTimelineTime,WORK_TIMELINE_STATUS,type WorkTimelineEntry} from './workTimeline';

function TimelineRecord({entry}:{entry:WorkTimelineEntry}){
 return <li className={`adx-work-entry is-${entry.status}`} data-status={entry.status} data-kind={entry.kind} data-phase={entry.phase}>
  <div className="adx-work-time">{entry.startedAt===undefined?<span>时间未记录</span>:<time dateTime={new Date(entry.startedAt).toISOString()}>{workTimelineTime(entry.startedAt)}</time>}
   {entry.endedAt!==undefined&&entry.endedAt!==entry.startedAt&&<><span aria-hidden="true"> — </span><time dateTime={new Date(entry.endedAt).toISOString()}>{workTimelineTime(entry.endedAt)}</time></>}</div>
  <div className="adx-work-content"><div className="adx-work-heading"><span>{entry.title}</span><span className="adx-work-status">{WORK_TIMELINE_STATUS[entry.status]}</span></div>
   {entry.text&&<p className="adx-run-text">{entry.text}</p>}</div>
 </li>;
}

/** Recorded public explanations, grouped by phase and ordered by their own timestamps. */
export function RunTrace({run,activity,onStop}:{run:MessageRun;activity?:AgentActivity|null;onStop?:()=>void}){
 const active=run.status==='running';
 const a=activity??run.activity;
 const entries=workTimeline(run,a);
 const [now,setNow]=useState(Date.now());
 const [expanded,setExpanded]=useState(true);
 const timelineId=useId();
 useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active,run.startedAt]);
 const elapsed=Number.isFinite(run.startedAt)?Math.max(0,Math.floor((now-run.startedAt)/1000)):undefined;
 const label=runStatusLabel(run,a);
 const progress=activityProgress(a,active,now);
 const heading=<button type="button" className="adx-run-heading" aria-expanded={expanded} aria-controls={timelineId} onClick={()=>setExpanded(value=>!value)}>
  <span role="status">{label}</span>{active&&elapsed!==undefined&&<span className="adx-run-elapsed">{elapsed} 秒</span>}
 </button>;
 return <section className={`conversation-process adx-run ${active?'is-active':''}`} aria-label="工作时间线" data-phase={progress.phase} data-model-state={progress.modelState}>
  {heading}
  <div id={timelineId} hidden={!expanded}>
   {entries.length?<ol className="adx-work-timeline" aria-label="按时间排列的工作记录">{entries.map(entry=><TimelineRecord key={entry.id} entry={entry}/>)}</ol>:<p className="adx-run-text">{active?'等待公开工作说明。':'本轮未保存公开工作说明。'}</p>}
  </div>
  {active&&onStop&&<ConversationActions className="adx-run-actions" items={[{key:'stop',label:'停止生成',onClick:onStop}]}/>}
 </section>;
}
