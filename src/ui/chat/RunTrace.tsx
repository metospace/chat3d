import {useEffect,useState} from 'react';
import {Think} from '@ant-design/x';
import {ConversationActions} from './ConversationActions';
import {activityProgress,customerText} from '../../domain/customerProgress';
import {runStatusLabel} from '../../domain/runStatusLabel';
import type {MessageRun} from '../../store';
import type {AgentActivity} from '../../ai/modelingAgent';

/** Public model explanations use Think's native reading layout. Tool nodes live in TaskPanel. */
export function RunTrace({run,activity,onStop}:{run:MessageRun;activity?:AgentActivity|null;onStop?:()=>void}){
 const active=run.status==='running';
 const [expanded,setExpanded]=useState(active);
 useEffect(()=>setExpanded(active),[active]);
 const a=activity??run.activity;
 const explanations=(a?.explanations??[]).filter(v=>v.text.trim());
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active,run.startedAt]);
 const elapsed=Math.max(0,Math.floor((now-run.startedAt)/1000));
 const label=runStatusLabel(run,a);
 const progress=activityProgress(a,active,now);
 if(!active&&!explanations.length)return null;
 const heading=<span role="button" tabIndex={0} aria-expanded={expanded}
  aria-label={`${label} · ${expanded?'收起摘要':'查看摘要'}`}
  onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();setExpanded(value=>!value);}}}>
  <span role="status">{label}</span>{active&&<span className="adx-run-elapsed">{elapsed} 秒</span>}
 </span>;
 return <section className={`conversation-process adx-run ${active?'is-active':''}`} aria-label="思考与执行摘要" data-phase={progress.phase} data-model-state={progress.modelState}>
  <Think className="adx-run-think" title={heading} loading={active} expanded={expanded} onExpand={setExpanded}
   styles={{status:{color:'var(--sc-ink)'},content:{color:'var(--sc-ink-muted)',fontSize:14,lineHeight:1.85}}}>
   {active&&<div className="adx-run-text" role="status" aria-label="当前模型处理状态">{progress.modelEditAgeSeconds!==undefined&&<p aria-label="距上次模型修改">距上次模型修改 {progress.modelEditAgeSeconds} 秒</p>}{progress.reviewNote&&<p>{progress.reviewNote}</p>}</div>}
   {explanations.length?explanations.map((explanation,index)=><p className="adx-run-text" key={explanation.id??index}>{customerText(explanation.text)}</p>):<p className="adx-run-text">正在处理你的请求，模型返回说明后会在这里显示。</p>}
  </Think>
  {active&&onStop&&<ConversationActions className="adx-run-actions" items={[{key:'stop',label:'停止生成',onClick:onStop}]}/>}
 </section>;
}
