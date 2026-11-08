import {useEffect,useId,useState} from 'react';
import {ConversationActions} from './ConversationActions';
import {activityProgress} from '../../domain/customerProgress';
import {runStatusLabel} from '../../domain/runStatusLabel';
import type {MessageRun} from '../../store';
import type {AgentActivity} from '../../ai/modelingAgent';
import type {BlenderActivityProgress} from '../../ai/blenderProgress';
import {workTimeline,workTimelineTime,WORK_TIMELINE_STATUS,type WorkTimelineEntry} from './workTimeline';
import {BLENDER_STAGE_LABELS,liveProgress} from './liveProgress';

function TimelineRecord({entry}:{entry:WorkTimelineEntry}){
 return <li className={`adx-work-entry is-${entry.status}`} data-status={entry.status} data-kind={entry.kind} data-phase={entry.phase}>
  <div className="adx-work-time">{entry.startedAt===undefined?<span>时间未记录</span>:<time dateTime={new Date(entry.startedAt).toISOString()}>{workTimelineTime(entry.startedAt)}</time>}
   {entry.endedAt!==undefined&&entry.endedAt!==entry.startedAt&&<><span aria-hidden="true"> — </span><time dateTime={new Date(entry.endedAt).toISOString()}>{workTimelineTime(entry.endedAt)}</time></>}</div>
  <div className="adx-work-content"><div className="adx-work-heading"><span>{entry.title}</span><span className="adx-work-status">{WORK_TIMELINE_STATUS[entry.status]}</span></div>
   {entry.text&&<p className="adx-run-text">{entry.text}</p>}</div>
 </li>;
}

/** Script content is public generated code; stage rows are recorded execution events only. */
function BlenderProgressPanel({progress,status,now}:{progress:BlenderActivityProgress;status:MessageRun['status'];now:number}){
 const active=status==='running';
 const lines=progress.script?progress.script.split(/\r\n|\n|\r/):[];
 const preview=lines.slice(-8).join('\n');
 const truncated=progress.receivedChars>progress.script.length;
 const age=active&&Number.isFinite(progress.updatedAt)?Math.max(0,Math.floor((now-progress.updatedAt)/1000)):undefined;
 const moving=active&&progress.stage!=='failed'&&progress.stage!=='completed';
 const stage=BLENDER_STAGE_LABELS[progress.stage];
 return <section className="adx-blender-progress" aria-label="Blender 脚本与执行阶段" data-stage={progress.stage}>
  <div className="adx-blender-heading"><strong>Blender 脚本与执行</strong><span className="adx-blender-stage">{moving&&<span className="adx-live-dot" aria-hidden="true"/>}{status==='stopped'?'已停止 · 最后记录：':status==='failed'?'已失败 · 最后记录：':!active?'最后记录：':''}{stage}</span></div>
  <p className="adx-blender-instruction"><span>当前指令：</span>{progress.instruction||'尚未收到脚本指令。'}</p>
  <div className="adx-blender-meta"><span>已接收 {progress.receivedChars} 字符</span><span>{truncated?'保留片段':'当前脚本'} {lines.length} 行</span>{age!==undefined&&<span>最近更新：{age} 秒前</span>}</div>
  {progress.stage==='receiving'&&<p className="adx-blender-note">{active?'正在接收脚本，尚未执行；收到完整脚本后才会启动 Blender。':'此阶段仅接收脚本，不表示 Blender 已执行。'}</p>}
  {progress.stage==='completed'&&<p className="adx-blender-note">输出已返回，不代表模型复核通过或工程验收通过。</p>}
  {progress.stage==='reviewing'&&<p className="adx-blender-note">{active?'模型正在复核返回的效果图':'此阶段记录模型对返回效果图的复核'}；复核本身不执行 Blender 脚本，也不代表工程验收。</p>}
  {progress.script?<>
   <div className="adx-blender-script-preview"><span className="adx-blender-caption">脚本末尾（最多 8 行；不是正在执行的代码行）</span><pre className="adx-blender-code" tabIndex={0} aria-label="脚本末尾预览"><code>{preview}</code></pre></div>
   <details className="adx-blender-script-details"><summary>查看完整保留脚本{truncated?'（较早内容已截断）':''}</summary>
    <p className="adx-blender-note">{truncated?'仅保留最近的脚本片段（最多 24K 字符），行数仅统计当前保留内容。':'显示当前收到并保留的完整脚本。'}{progress.stage==='receiving'?' 当前内容尚不完整，未执行。':' 以下内容是生成的脚本，不标示当前执行行。'}</p>
    <pre className="adx-blender-code adx-blender-code-full" tabIndex={0} aria-label="完整保留的 Blender 脚本"><code>{progress.script}</code></pre>
   </details>
  </>:<p className="adx-blender-note">尚未收到脚本代码。</p>}
  {progress.events.length>0&&<ol className="adx-blender-events" aria-label="实际记录的 Blender 阶段">{progress.events.map((event,index)=><li key={`${event.at}-${index}`}>
   <time dateTime={new Date(event.at).toISOString()}>{workTimelineTime(event.at)}</time><div><strong>{BLENDER_STAGE_LABELS[event.stage]}</strong>{event.message&&<span>{event.message}</span>}</div>
  </li>)}</ol>}
 </section>;
}

/** Recorded public explanations, grouped by phase and ordered by their own timestamps. */
export function RunTrace({run,activity,onStop,blender=false}:{run:MessageRun;activity?:AgentActivity|null;onStop?:()=>void;blender?:boolean}){
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
 const live=liveProgress(a,blender);
 const heading=<button type="button" className="adx-run-heading" aria-expanded={expanded} aria-controls={timelineId} onClick={()=>setExpanded(value=>!value)}>
  <span>{active?'工作说明':label}</span>
 </button>;
 return <section className={`conversation-process adx-run ${active?'is-active':''}`} aria-label="工作时间线" data-phase={progress.phase} data-model-state={progress.modelState}>
  {active&&<div className="adx-live-progress" role="status" aria-live="polite" aria-label="生成进度">
   <div className="adx-live-progress-title"><span className="adx-live-dot" aria-hidden="true"/><strong>{live.label}</strong>{elapsed!==undefined&&<span className="adx-run-elapsed" aria-live="off">{elapsed} 秒</span>}</div>
   <p>{live.note}</p>
   <span className="adx-live-progress-help">可在下方补充要求，或停止生成。</span>
  </div>}
  {a?.blenderProgress&&<BlenderProgressPanel progress={a.blenderProgress} status={run.status} now={now}/>}
  {entries.length>0?<>{heading}<div id={timelineId} hidden={!expanded}>
   <ol className="adx-work-timeline" aria-label="按时间排列的工作记录">{entries.map(entry=><TimelineRecord key={entry.id} entry={entry}/>)}</ol>
  </div></>:!active&&<span className="adx-run-heading">{label}</span>}
  {active&&onStop&&<ConversationActions className="adx-run-actions" items={[{key:'stop',label:'停止生成',onClick:onStop}]}/>}
 </section>;
}
