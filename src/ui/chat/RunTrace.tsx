import {useEffect,useId,useState} from 'react';
import {ConversationActions} from './ConversationActions';
import {activityProgress} from '../../domain/customerProgress';
import {runStatusLabel} from '../../domain/runStatusLabel';
import type {MessageRun} from '../../store';
import type {AgentActivity} from '../../ai/modelingAgent';
import type {BlenderActivityProgress} from '../../ai/blenderProgress';
import {progressFeed,workTimelineTime,type ProgressEntry} from './workTimeline';
import {BLENDER_STAGE_LABELS,liveProgress} from './liveProgress';

function ProgressRecord({entry}:{entry:ProgressEntry}){
 const status={recorded:'',running:'进行中',completed:'已完成',failed:'未成功',interrupted:'未完成'}[entry.status];
 return <li className={`adx-progress-entry is-${entry.kind} is-${entry.status}`} data-kind={entry.kind} data-status={entry.status}>
  {entry.kind==='explanation'?<p className="adx-run-text">{entry.text}</p>:<>
   <div className="adx-progress-action"><span className="adx-progress-mark" aria-hidden="true">{entry.status==='completed'?'✓':entry.status==='failed'?'!':'·'}</span><span>{entry.text}{(entry.count??1)>1?` ×${entry.count}`:''}</span><span className="adx-progress-action-status">{status}</span></div>
   {entry.summary&&<p className="adx-progress-summary">{entry.summary}</p>}
  </>}
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

/** One visible progress stream: public explanations and actual execution, not hidden reasoning. */
export function RunTrace({run,activity,onStop,blender=false}:{run:MessageRun;activity?:AgentActivity|null;onStop?:()=>void;blender?:boolean}){
 const active=run.status==='running',a=activity??run.activity;
 const entries=progressFeed(run,a);
 const [now,setNow]=useState(Date.now()),[expanded,setExpanded]=useState(false);
 const detailsId=useId();
 useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active,run.startedAt]);
 const elapsed=Number.isFinite(run.startedAt)?Math.max(0,Math.floor(((active?now:run.endedAt??now)-run.startedAt)/1000)):undefined;
 const progress=activityProgress(a,active,now),live=liveProgress(a,blender),label=runStatusLabel(run,a);
 const currentAction=[...(a?.timings??[])].reverse().find(step=>step.kind==='tool'&&step.endedAt===undefined);
 const history=active&&currentAction?entries.filter(entry=>entry.id!=='action-'+currentAction.id):entries;
 return <section className={`conversation-process adx-run ${active?'is-active':''}`} aria-label="工作时间线" data-phase={progress.phase} data-model-state={progress.modelState}>
  <button type="button" className="adx-progress-header" aria-expanded={expanded} aria-controls={detailsId} onClick={()=>setExpanded(value=>!value)}>
   <span className={`adx-progress-chevron ${expanded?'is-open':''}`} aria-hidden="true">›</span>
   {active&&<span className="adx-live-dot" aria-hidden="true"/>}<strong>{active?live.label:label}</strong>{elapsed!==undefined&&<span className="adx-run-elapsed" aria-live="off">{elapsed} 秒</span>}
  </button>
  <div id={detailsId} hidden={!expanded} className="adx-progress-details">
   {history.length>0&&<ol className="adx-progress-feed" aria-label="建模进展">{history.map(entry=><ProgressRecord key={entry.id} entry={entry}/>)}</ol>}
   {active&&<div className="adx-progress-current"><span className="adx-progress-current-label">{currentAction?'正在执行':progress.modelState==='responding'?'正在接收':'等待响应'}</span><p>{live.note}</p></div>}
   {a?.blenderProgress&&<BlenderProgressPanel progress={a.blenderProgress} status={run.status} now={now}/>}
  </div>
  {active&&onStop&&<ConversationActions className="adx-run-actions" items={[{key:'stop',label:'停止生成',onClick:onStop}]}/>}
 </section>;
}
