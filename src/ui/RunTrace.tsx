import {RequirementList} from './RequirementList';
import type {MessageRun} from '../store';
import type {AgentActivity} from '../ai/modelingAgent';
import {activityProgress,customerText,progressSteps} from '../domain/customerProgress';
import {runStatusLabel} from '../domain/runStatusLabel';
import {Think,ThoughtChain} from '@ant-design/x';
import {ConversationActions} from './chat/ConversationActions';
export function RunTrace({run,activity,title,now,onStop}:{run:MessageRun;activity?:AgentActivity|null;title?:string;now:number;onStop?:()=>void;characters?:number}){
 const a=activity??run.activity,active=run.status==='running',steps=progressSteps(a,active);
 const status=runStatusLabel(run,a);
 const end=active?now:run.endedAt??a?.lastEventAt??run.startedAt;
 const progress=activityProgress(a,active,now);
 return <section aria-label="本轮执行过程" className="customer-run" data-phase={progress.phase} data-model-state={progress.modelState}>
  <div className="customer-run-heading"><strong>{active&&a?.phase?status:active?customerText(title??a?.title):status}</strong><span>{Math.max(0,Math.floor((end-run.startedAt)/1000))} 秒</span>{active&&onStop&&<ConversationActions items={[{key:'stop',label:'停止生成',onClick:onStop}]}/>}</div>
  {active&&<div role="status" aria-label="当前模型处理状态">{!a?.phase&&progress.modelState&&<p>{status}</p>}{progress.modelEditAgeSeconds!==undefined&&<p aria-label="距上次模型修改">距上次模型修改 {progress.modelEditAgeSeconds} 秒</p>}{progress.reviewNote&&<p>{progress.reviewNote}</p>}</div>}
  {run.mode==='single'&&<p className="task-footnote">本次为单次生成，没有多轮画面复核。</p>}
  {!!steps.length&&<ThoughtChain items={steps.map((step,index)=>({key:String(index),title:step.label,
   status:step.failed?'error':step.running?'loading':step.completed===step.count?'success':'abort',
   description:(step.failed?'有步骤未完成':step.running?'正在处理':step.completed===step.count?'已完成':'未完成')+(step.count>1?` · ${step.count} 次`:'')}))}/>}
  {a?.requirements&&<RequirementList report={a.requirements}/>}
  {!!a?.plan.length&&<Think title="查看本次安排" defaultExpanded={false}><ul>{a.plan.map((step,i)=><li key={i}>{customerText(step,'处理模型')}</li>)}</ul><p className="task-footnote">计划不等于完成结果，实际状态以执行记录和预览为准</p></Think>}
 </section>;
}
