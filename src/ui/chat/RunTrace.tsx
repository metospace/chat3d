import {useEffect,useState} from 'react';
import {ThoughtChain,type ThoughtChainItemType} from '@ant-design/x';
import {customerText} from '../../domain/customerProgress';
import type {MessageRun} from '../../store';
import type {AgentActivity} from '../../ai/modelingAgent';

/** Agent process summary: the same user-facing text as before, laid out as an Ant Design X thought chain. */
export function RunTrace({run,activity,onStop}:{run:MessageRun;activity?:AgentActivity|null;onStop?:()=>void}){
 const active=run.status==='running';
 const [expanded,setExpanded]=useState(active);
 useEffect(()=>setExpanded(active),[active]);
 const a=activity??run.activity;
 const explanations=(a?.explanations??[]).filter(v=>v.text.trim());
 const tools=a?.timings.filter(t=>t.kind==='tool')??[];
 const runningTool=tools.filter(t=>!t.endedAt).slice(-1)[0];
 const recentTools=tools.filter(t=>t.endedAt).slice(-3);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active]);
 const modelStarted=a?.timings.filter(t=>t.kind==='model').slice(-1)[0]?.startedAt??run.startedAt;
 const elapsed=Math.max(0,Math.floor((now-(runningTool?.startedAt??modelStarted))/1000));
 const liveStage=runningTool?`正在${customerText(runningTool.label)}`:a?.title==='正在接收建模工具参数'?'正在接收建模参数':a?.title==='正在接收模型回复'?'正在接收模型说明':'正在等待模型下一步回复';
 const label=active?liveStage:run.status==='failed'?'处理未完成':run.status==='stopped'?'已停止':run.status==='preview'?'修改已生成，等待应用':'处理已结束';
 const hasProcess=explanations.length>0||recentTools.length>0;
 const items:ThoughtChainItemType[]=[];
 if(hasProcess){
  explanations.forEach((e,i)=>items.push({key:`note-${i}`,title:'模型说明',content:<p className="adx-run-text">{customerText(e.text)}</p>,status:'success'}));
  recentTools.forEach((t,i)=>items.push({key:`tool-${i}`,title:customerText(t.label),description:t.failed?'未完成':'已完成',status:t.failed?'error':'success'}));
 }
 if(!active&&!hasProcess)return null;
 const heading=<>
  <span aria-hidden="true" className={`adx-run-dot ${active?'is-live':''}`}/>
  <span><span role="status">{label}</span>{active&&<span aria-hidden="true" className="adx-run-elapsed">{elapsed} 秒</span>}</span>
  {hasProcess&&<span className="adx-run-affordance">{expanded?'收起摘要':'查看摘要'}</span>}
  {hasProcess&&<span aria-hidden="true" className="adx-run-chevron">{expanded?'⌃':'⌄'}</span>}
 </>;
 return <section className={`conversation-process adx-run ${active?'is-active':''}`} aria-label="思考与执行摘要">
  <div className="adx-run-heading">
   {hasProcess?<button type="button" className="adx-run-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{heading}</button>:<div className="adx-run-toggle">{heading}</div>}
   {active&&onStop&&<button type="button" className="adx-run-stop" onClick={onStop}>停止生成</button>}
  </div>

  {expanded&&hasProcess&&<div className="adx-run-body"><ThoughtChain items={items}/></div>}
 </section>;
}
