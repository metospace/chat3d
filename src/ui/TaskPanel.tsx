import {downloadDiagnosticBlob} from '../util/downloadJson';
import {RequirementList} from './RequirementList';
import {prepareDiagnosticExport} from '../util/diagnosticExport';
import {sanitizeDiagnostic} from '../ai/runTraceLog';
import {conversationController} from '../runtime/conversationController';
import type {ActivityTiming} from '../ai/modelingAgent';
import {activityProgress,customerText,progressSteps} from '../domain/customerProgress';
import {RunTrace} from './RunTrace';
import {useEffect,useRef,useState} from 'react';
import {useEditorStore,type EditorStore} from '../store';
import {useStore} from 'zustand';
import {ActivityLogIcon} from '@radix-ui/react-icons';
import './task-progress.css';
export function TaskPanel({onConversation,editor}:{onConversation:()=>void;editor?:EditorStore}){
 const targetEditor=editor??useEditorStore;
 const {lastRun,aiStatus,aiError,pendingBatch,pendingResult,doc,messages,past,future}=useStore(targetEditor);
 const busy=['capturing','context','generating','validating','applying'].includes(aiStatus);
 const [exportNotice,setExportNotice]=useState(''),[exporting,setExporting]=useState(false),[preparing,setPreparing]=useState(false),[diagnosticSummary,setDiagnosticSummary]=useState('');
 const exportController=useRef<AbortController|null>(null);
 useEffect(()=>()=>{exportController.current?.abort();exportController.current=null;},[targetEditor]);
 const [now,setNow]=useState(Date.now());useEffect(()=>{if(!busy)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[busy]);
 const runs=messages.filter(m=>m.run).slice().reverse(),latest=runs[0]?.run;
 const outcomes=messages.filter(m=>m.batch).slice().reverse(),outcome=outcomes[0];
 const steps=progressSteps(lastRun,busy),done=steps.reduce((n,s)=>n+s.completed,0),failed=steps.reduce((n,s)=>n+s.failed,0);
 const manualHistory=[...past.map(entry=>({entry,undone:false})),...future.map(entry=>({entry,undone:true}))].filter(r=>r.entry.source!=='ai').reverse().sort((a,b)=>(b.entry.createdAt??0)-(a.entry.createdAt??0));
 const start=latest?.startedAt??lastRun?.timings[0]?.startedAt;
 const elapsed=start===undefined?'—':`${Math.max(0,Math.floor(((busy?now:latest?.endedAt??lastRun?.lastEventAt??start)-start)/1000))} 秒`;
 const pending=!!pendingBatch||!!pendingResult;
 const progress=activityProgress(lastRun,busy,now);
 const failureActivity=latest?(busy&&lastRun&&lastRun.lastEventAt>=latest.startedAt?lastRun:latest.activity):lastRun;
 const failureTiming=failureActivity?.timings.reduce<ActivityTiming|undefined>((current,timing)=>
   timing.failed&&(!current||(timing.endedAt??timing.startedAt)>=(current.endedAt??current.startedAt))?timing:current,undefined);
 const hasFailureDetail=!!aiError||!!failureTiming||failureActivity?.outcome==='failed'||(!busy&&latest?.status==='failed');
 const title=busy?(lastRun?.phase?progress.label:customerText(lastRun?.title)):pending?(pendingBatch?.taskStatus==='partial'?'未完成，已保留阶段草稿':pendingBatch?.incomplete||pendingBatch?.qualityIssues?.length?'预览已生成，仍需核对':'模型已生成，请检查预览'):aiStatus==='error'||latest?.status==='failed'?'这次处理未完成':aiStatus==='cancelled'||latest?.status==='stopped'?'已停止，已生成的内容保留':outcome?.outcome==='applied'?'修改已应用到场景':outcome?.outcome==='discarded'?'这次预览已放弃':latest?.mode==='demo'?'历史模拟记录已结束 · 当前无运行任务':lastRun||latest?'本次处理已结束':manualHistory.length?(past.some(e=>e.source!=='ai')?'修改记录已更新':'修改已撤销'):'还没有建模任务';
 const next=busy?'正在继续处理，可返回对话补充要求或停止。':pending?(pendingBatch?.taskStatus==='partial'?'当前任务尚未完成，可继续处理剩余问题；也可保留或放弃阶段结果。':'检查模型后选择应用或放弃。应用不等于质量验收通过。'):aiStatus==='error'?'回到对话查看提示，确认后再继续。不会自动重试。':'可以继续提出修改要求，或保存当前模型。';
 const cancelDiagnosticExport=()=>{exportController.current?.abort();exportController.current=null;setPreparing(false);setExporting(false);setExportNotice('已取消诊断准备；模型任务不受影响。');};
 const exportDiagnostics=async()=>{
  if(exportController.current)return;
  const controller=new AbortController();exportController.current=controller;setExporting(true);setPreparing(true);setExportNotice('正在准备排障记录…');setDiagnosticSummary('');
  try{
   const state=targetEditor.getState();
   // Pick only task data: never clone Zustand actions, config, or unrelated UI state.
   const snapshot={aiStatus:state.aiStatus,lastRun:state.lastRun,aiError:state.aiError,messages:state.messages,doc:state.doc,pendingBatch:state.pendingBatch,pendingResult:state.pendingResult,past:state.past,future:state.future,diagnosticApiKey:state.aiConfig?.apiKey};
   const result=await prepareDiagnosticExport(snapshot,conversationController(targetEditor).getDiagnosticEntries(),{signal:controller.signal,onProgress:message=>{if(exportController.current===controller)setExportNotice(message);}});
   if(controller.signal.aborted)return;
   setPreparing(false);setDiagnosticSummary(result.summary);setExportNotice('正在发起保存…');
   const notice=await downloadDiagnosticBlob(result.blob);
   if(exportController.current===controller)setExportNotice(notice);
  }catch(error){
   if(exportController.current===controller)setExportNotice(controller.signal.aborted?'已取消诊断准备；模型任务不受影响。':'诊断下载失败：'+String(error)+'。请重试。');
  }finally{if(exportController.current===controller){exportController.current=null;setPreparing(false);setExporting(false);}}
 };
 return <section className="task-panel customer-task-panel" aria-label="任务记录">
 <header className="task-panel-intro"><ActivityLogIcon/><h2>任务与执行记录</h2><p>当前进展、处理结果和接下来要做的事。</p></header>
 <section className={`customer-current ${busy?'is-running':''}`} aria-label="当前任务状态" data-phase={progress.phase} data-model-state={progress.modelState}><span className="customer-status">{busy?progress.label:pending?'等待应用':'当前状态'}</span><h3>{title}</h3>{progress.modelEditAgeSeconds!==undefined&&<p aria-label="距上次模型修改">距上次模型修改 {progress.modelEditAgeSeconds} 秒</p>}{progress.reviewNote&&<p>{progress.reviewNote}</p>}<p>{next}</p><button onClick={onConversation}>{pending?'查看预览':busy?'返回对话':'前往对话'}</button></section>
 {(lastRun||latest)&&<div className="customer-facts"><div><strong>{elapsed}</strong><span>本次用时</span></div><div><strong>{done}</strong><span>已完成步骤</span></div></div>}
 {(aiError||failed>0)&&<section className="customer-notice" aria-label="需要留意"><h3>需要留意</h3><p>{aiError?customerText(aiError,'处理遇到问题，请返回对话查看'): `${failed} 个处理步骤没有完成${busy?'，当前仍在继续处理':'，请检查保留结果'}。`}</p></section>}
 {hasFailureDetail&&<details className="customer-section"><summary>技术失败详情</summary><p className="task-footnote">界面仅显示错误与最近 4 条事件摘要（各最多 500 字）；完整结构化记录请下载诊断文件，可能包含模型内容或脚本。</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{sanitizeDiagnostic([aiError?.slice(0,500),failureTiming?.detail?.slice(0,500),...(failureActivity?.events??[]).slice(-4).map(event=>event.slice(0,500))].filter(Boolean).join('\n'),targetEditor.getState().aiConfig?.apiKey)}</pre></details>}
 {pending&&<p className="task-footnote">当前展示的是预览；尚未写入正式场景。</p>}
 {lastRun?.requirements&&<section className="customer-section"><RequirementList report={lastRun.requirements}/></section>}
 {!!steps.length&&<section className="customer-section"><h3>处理进展</h3><ol className="customer-steps">{steps.slice(-8).map((s,i)=><li key={i} data-state={s.failed?'failed':s.running?'running':s.completed===s.count?'done':'unfinished'}><span aria-hidden="true">{s.failed?'!':s.running?'◌':s.completed===s.count?'✓':'—'}</span><div><strong>{s.label}</strong><small>{s.failed?'有步骤未完成':s.running?'正在处理':s.completed===s.count?'已完成':'未完成'}{s.count>1?` · ${s.count} 次`:''}</small></div></li>)}</ol>{steps.length>8&&<p className="task-footnote">展示最近 8 类步骤，完整记录见下方历史。</p>}</section>}
 {!!lastRun?.plan.length&&<details className="customer-section"><summary>本次安排</summary><ol>{lastRun.plan.map((step,i)=><li key={i}>{customerText(step)}</li>)}</ol><p className="task-footnote">计划不等于完成结果，实际状态以执行记录和预览为准</p></details>}
 {(lastRun?.detailAcceptance||lastRun?.quality)&&<details className="customer-section"><summary>模型检查结果</summary>{lastRun.detailAcceptance&&<><p>{{not_required:'本轮无需重新检查',pending:'仍有项目待检查',needs_work:'仍有问题需要修正',self_reviewed:'已完成自动检查，仍需查看实际模型'}[lastRun.detailAcceptance.status]}</p>{(pendingResult?.doc.revision??doc.revision)!==lastRun.detailAcceptance.revision&&<p>模型已变化，这份检查结果需要更新。</p>}{lastRun.detailAcceptance.issues.map((issue,i)=><p key={i}>{customerText(issue)}</p>)}</>}{lastRun.quality?.issues.map((issue,i)=><p key={i}>{customerText(issue)}</p>)}<p className="task-footnote">自动检查不等于实际效果验收。</p></details>}
 {lastRun?.generationReview&&<details className="customer-section"><summary>本次检查范围</summary><p>{String(lastRun.generationReview.coverage)==='basic-overview'?'基础全景检查':String(lastRun.generationReview.coverage)==='component-multiview'?'组件多视角检查':'未记录检查范围'} · 已取 {lastRun.generationReview.staticImages} 张检查图</p><p>{lastRun.generationReview.basicReviewCompleted?'基础复核已完成，仍需确认实际效果。':'基础复核尚未完成。'}</p></details>}
 {!!manualHistory.length&&<section className="customer-section" aria-label="手动修改记录"><h3>手动与历史修改 <span>{manualHistory.length}</span></h3>{manualHistory.map(({entry,undone},i)=><article className="customer-outcome" key={entry.id??i}><div><strong>{undone?'已撤销':'已应用'} · {entry.source==='manual'?'手动操作':'历史操作'}</strong><time>{entry.createdAt?new Date(entry.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'时间未记录'}</time></div><p>{customerText(entry.summary,'模型修改')}</p></article>)}<p className="task-footnote">这里显示当前保留的可撤销操作。导出的工作区备份不包含撤销历史。</p></section>}
 <section className="customer-section"><h3>AI 修改结果 <span>{outcomes.length}</span></h3>{outcomes.length?outcomes.map(m=><article className="customer-outcome" key={m.id}><div><strong>{m.outcome==='applied'?'已应用':m.outcome==='discarded'?'已放弃':m.outcome==='superseded'?'已保留到后续预览':pendingBatch?.requestId===m.batch?.requestId?'等待应用':'预览已结束'}</strong><time>{new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div><p>{customerText(m.batch?.summary||m.text,'模型修改')}</p></article>):<p className="task-footnote">{manualHistory.length?'还没有 AI 生成的修改结果；其他操作见上方记录。':'完成一次 AI 生成后，这里会显示预览和应用结果。'}</p>}</section>
 {!!runs.length&&<details className="customer-section"><summary>历史任务 · {runs.length} 次</summary>{runs.map(m=><details className="customer-history" key={m.id}><summary>{customerText(m.text,'建模请求').slice(0,90)}</summary><RunTrace run={m.run!} now={now}/></details>)}</details>}
 <details className="customer-section" onToggle={event=>{if(!event.currentTarget.open&&preparing&&exportController.current)cancelDiagnosticExport();}}><summary>问题排查</summary><p className="task-footnote">下载排障必需的完整记录：保留模型消息、请求复盘、参考资料、脚本、错误、当前与最终场景及操作命令；重复资料仅保存一次，逐步与撤销场景快照改为摘要，文件内记录全部省略原因。连接凭据已排除；内容仍可能包含敏感信息，请确认后再分享。后台准备可取消，不影响模型任务。</p><button className="customer-diagnostics" disabled={exporting} onClick={()=>void exportDiagnostics()}>{preparing?'正在准备…':exporting?'正在保存…':'下载完整诊断记录'}</button>{preparing&&<button onClick={cancelDiagnosticExport}>取消准备</button>}{exportNotice&&<p role="status">{exportNotice}</p>}{diagnosticSummary&&<p aria-label="诊断导出摘要" className="task-footnote">{diagnosticSummary}</p>}</details>
 </section>;
}
