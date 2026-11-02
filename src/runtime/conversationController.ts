import {isReferenceImage,referenceText} from '../domain/referenceAttachments';
import {createStore} from 'zustand/vanilla';
import {buildSceneContext,generateBatch,type ModelConfig} from '../ai/provider';
import type {AgentActivity,AgentResult,AgentControl} from '../ai/modelingAgent';
import type {GenerationProgress} from '../ai/stream';
import {AGENT_LIMITS} from '../ai/agentPolicy';
import {applyBatch,type CommandBatch,type ExecutionResult} from '../domain/commands';
import {checkEditScope,type EditScope} from '../domain/editScope';
import {continueDraft,type DraftBaseline} from '../domain/draftContinuation';
import {userEditScope} from '../domain/conversationScope';
import {evaluateDetailAcceptance} from '../domain/detailAcceptance';
import {makeId} from '../util/ids';
import {useEditorStore,type EditorStore} from '../store';
import {captureIsolatedSceneEvidence,isIsolatedCaptureAvailable} from '../scene/capture';

export const REQUEST_TIMEOUT_MS=180_000;
export const MAX_CONCURRENT_CONVERSATIONS=2;
export const useConversationRuns=createStore<{activeCount:number}>(()=>({activeCount:0}));
const reservations=new Set<EditorStore>();
export const hasActiveConversationRuns=()=>reservations.size>0;
const controllers=new WeakMap<EditorStore,ReturnType<typeof createConversationController>>();
export function conversationController(editor:EditorStore) {
  let controller=controllers.get(editor);
  if(!controller){controller=createConversationController(editor);controllers.set(editor,controller);}
  return controller;
}
export interface SendOptions {scopeMode?:'scene'|'selection';lockPlacement?:boolean;reuseReference?:boolean;config?:ModelConfig|null}
interface RuntimeView {
  removedQueueId:string|null;notice:string;agentActivity:AgentActivity|null;runPi:boolean;canSteer:boolean;
  runMessageId:string|null;started:number;lastRequest:{text:string;images:string[]}|null;running:boolean;
}
function createConversationController(editor:EditorStore) {
  const store=editor.getState;
  const ui=createStore<RuntimeView>(()=>({removedQueueId:null,notice:'',agentActivity:store().lastRun,runPi:false,canSteer:false,runMessageId:null,started:0,lastRequest:null,running:false}));
  const setNotice=(notice:string)=>ui.setState({notice});
  // A buffered SSE read can deliver hundreds of deltas in the same microtask chain.
  // Keep processing every event, but publish the latest complete activity snapshot on
  // a timer so React's external-store subscribers can finish a render between bursts.
  let activityTimer:ReturnType<typeof setTimeout>|undefined;
  let queuedActivity:AgentActivity|undefined;
  const clearActivityTimer=()=>{if(activityTimer!==undefined)clearTimeout(activityTimer);activityTimer=undefined;};
  const setAgentActivity=(value:AgentActivity|null|((prev:AgentActivity|null)=>AgentActivity|null))=>{
    const previous=queuedActivity??ui.getState().agentActivity;
    clearActivityTimer();queuedActivity=undefined;
    ui.setState({agentActivity:typeof value==='function'?value(previous):value});
  };
  const queueAgentActivity=(activity:AgentActivity)=>{
    queuedActivity=activity;
    if(activityTimer!==undefined)return;
    activityTimer=setTimeout(()=>{
      const latest=queuedActivity;activityTimer=undefined;queuedActivity=undefined;
      if(latest)ui.setState({agentActivity:latest});
    },50);
  };
  const setInput=(text:string)=>store().setComposerText(text);
  const setAttachments=(images:string[])=>store().setComposerImages(images);
  const setRunPi=(runPi:boolean)=>ui.setState({runPi});
  const setCanSteer=(canSteer:boolean)=>ui.setState({canSteer});
  const setLastRequest=(lastRequest:RuntimeView['lastRequest'])=>ui.setState({lastRequest});
  const setStarted=(started:number)=>ui.setState({started});
  // Only provider/tool events update progress; there is no simulated backend timer.
  const setProgress=(_progress:GenerationProgress|null)=>{};
  const controlRef:{current:AgentControl|null}={current:null};
  const runMessageId:{current:string|null}={current:null};
  const parentDraft:{current:DraftBaseline|null}={current:null};
  const checkpointRef:{current:AgentResult|null}={current:null};
  const runRef={current:0},runningRef={current:false};
  const abortRef:{current:AbortController|null}={current:null};
  const timeoutRef:{current:ReturnType<typeof setTimeout>|null}={current:null};
  const release=()=>{reservations.delete(editor);ui.setState({running:false});useConversationRuns.setState({activeCount:reservations.size});};
  const markSteering=(id:string,status:'queued'|'received'|'interrupted')=>editor.setState(state=>({messages:state.messages.map(m=>m.id===id?{...m,steering:{runId:runMessageId.current??'',status}}:m)}));
  const clearControl=()=>{controlRef.current=null;setCanSteer(false);editor.setState(state=>({messages:state.messages.map(m=>m.steering?.runId===runMessageId.current&&m.steering.status==='queued'?{...m,steering:{...m.steering,status:'interrupted' as const}}:m)}));};
  const finishRun=(status:'preview'|'completed'|'failed'|'stopped')=>{if(runMessageId.current)store().updateMessageRun(runMessageId.current,{status,endedAt:Date.now(),activity:store().lastRun??undefined});};
  const fail = (msg: string) => { finishRun('failed'); setAgentActivity(a=>a?{...a,timings:a.timings.map(t=>({...t,endedAt:t.endedAt??Date.now()}))}:a); store().setPreviewDoc(null); store().setPendingBatch(null); store().setPendingResult(null); store().setAiError(msg); store().setAiStatus('error'); store().addAssistantMessage(msg, undefined, msg); };
  const finalize = (batch: CommandBatch, prepared?: ExecutionResult) => {
    store().setAiStatus('validating');
    if (store().doc.revision !== batch.baseRevision || store().doc.projectId !== batch.projectId) { fail('场景已变化，本次结果未应用。请重新发送'); return; }
    const result = prepared ?? applyBatch(store().doc, {operations:batch.operations});
    const scopeErrors=checkEditScope(store().doc,result.doc,batch.editScope);if(scopeErrors.length){fail(scopeErrors.join('；'));return;}
    if(result.errors.length) { fail(`结果未通过校验，场景保持不变：${result.errors.map(e=>e.message).join('；')}`); return; }
    store().setAiError(null);
    if (!batch.operations.length) { store().setPreviewDoc(null); store().setAiStatus('idle'); finishRun('completed'); store().addAssistantMessage(batch.summary); return; }
    const detail=evaluateDetailAcceptance(store().doc,result.doc,store().lastRun?.detailAcceptance?.reviews??[]);
    if(detail.issues.length){batch={...batch,qualityIssues:[...new Set([...(batch.qualityIssues??[]),...detail.issues])],continuation:batch.continuation??'继续按通用六项细节标准检查并修正当前模型'};}
    if(parentDraft.current&&batch.requestId!==parentDraft.current.batch.requestId){const priorId=parentDraft.current.batch.requestId;editor.setState(state=>({messages:state.messages.map(m=>m.batch?.requestId===priorId?{...m,outcome:'superseded' as const}:m)}));}
    store().setPendingBatch(batch); store().setPendingResult(result); store().setPreviewDoc(result.doc);
    store().setAiStatus('previewing'); finishRun('preview'); store().addAssistantMessage(batch.summary, batch);
  };
  const preserveCheckpoint = (reason:string) => {
    const cp=checkpointRef.current;
    if(!cp&&parentDraft.current&&parentDraft.current.batch.baseRevision===store().doc.revision&&parentDraft.current.batch.projectId===store().doc.projectId){const parent=parentDraft.current;store().setPendingBatch(parent.batch);store().setPendingResult(parent.result);store().setPreviewDoc(parent.result.doc);store().setAiStatus('previewing');finishRun('stopped');store().addAssistantMessage('本次调整未完成，之前的预览已保留。'+reason);return true;}
    if(!cp || cp.batch.baseRevision!==store().doc.revision || cp.batch.projectId!==store().doc.projectId)return false;
    const batch={...cp.batch,summary:cp.batch.summary+'\n中断原因：'+reason};
    const activity={...cp.activity,timings:cp.activity.timings.map(t=>({...t,endedAt:t.endedAt??Date.now()}))};
    setAgentActivity(activity);store().setLastRun(activity);finalize(batch,cp.result);return true;
  };
  const send = async (sendMode:'guide'|'question'|'later'='guide',options:SendOptions={}) => {
    const {scopeMode='scene',lockPlacement=false,reuseReference=true}=options;
    const {composerText:input,composerImages:attachments,messages}=store();
    const text = input.trim();
    if (!text && !attachments.length) return;
    if(runningRef.current){
      if(sendMode==='later'){const id=store().addUserMessage(text||'请根据参考附件建模',[...attachments]);editor.setState(state=>({messages:state.messages.map(m=>m.id===id?{...m,queuedTask:{status:'waiting' as const}}:m)}));setInput('');setAttachments([]);setNotice('');return;}
      if(!controlRef.current){setNotice('当前请求暂不能接收引导，输入已保留；可停止后继续');return;}
      const id=store().addUserMessage(text||'请根据补充参考附件调整',[...attachments]);markSteering(id,'queued');
      try{if(!controlRef.current.steer(id,referenceText(text||'请根据补充参考附件调整',attachments),attachments.filter(isReferenceImage),sendMode)){editor.setState(state=>({messages:state.messages.filter(m=>m.id!==id)}));setNotice('当前任务已收尾，输入已保留，请直接发送下一条');return;}}catch{markSteering(id,'interrupted');setNotice('补充要求未送达，输入已保留');return;}
      setInput('');setAttachments([]);setNotice('补充要求已排队，当前操作结束后接收');return;
    }
    const sourceConfig = options.config===undefined?useEditorStore.getState().aiConfig:options.config;
    const cfg=sourceConfig?structuredClone(sourceConfig):null;
    if(!cfg || cfg.useMock || !cfg.baseURL.trim() || !cfg.apiKey.trim() || !cfg.model.trim()) {
      setNotice('请先打开顶部“模型配置”，获取并选择模型；指令和附件已保留'); return;
    }
    const usePi = cfg.agentMode !== 'single';
    if(usePi && cfg.stream === false) { setNotice('Pi 分步建模需要流式输出，请在模型配置中开启；也可选择单次生成兼容模式'); return; }
    let requestedScope:EditScope;
    try{requestedScope=userEditScope(text,store().pendingResult?.doc??store().doc,[...store().selection],scopeMode,lockPlacement,messages.filter(m=>m.role==='user'));}
    catch(error){setNotice(error instanceof Error?error.message:'修改范围无效');return;}
    if(reservations.size>=MAX_CONCURRENT_CONVERSATIONS){setNotice('已有 2 个会话正在执行。请等待其中一个结束或停止后再发送；输入已保留，不会自动执行。');return;}
    reservations.add(editor);useConversationRuns.setState({activeCount:reservations.size});ui.setState({running:true});
    let lastActivitySave=0;
    const parent=store().aiStatus==='previewing'&&store().pendingBatch&&store().pendingResult?{batch:store().pendingBatch!,result:store().pendingResult!}:null;
    const referenceRepairs=parent?structuredClone(store().lastRun?.referenceRepairs??[]):[];
    parentDraft.current=parent;
    const original=store().doc,working=parent?.result.doc??original;
    checkpointRef.current=null;store().setPreviewDoc(parent?.result.doc??null);
    if(!parent){store().setPendingBatch(null);store().setPendingResult(null);}
    setRunPi(usePi); setAgentActivity(null);store().setLastRun(null);
    const sentImages = [...attachments];
    // Current reference stays visible in the conversation; a follow-up may reuse the latest references.
    const reference = sentImages.length ? sentImages : reuseReference ? [...messages].reverse().find(m=>m.role==='user' && !m.queuedTask && m.images?.length)?.images ?? [] : [];
    const images = reference.filter(isReferenceImage);
    const modelText = referenceText(text,reference);
    const history = messages.filter(m=>m.role!=='system' && !m.error && !m.queuedTask).map(m=>({role:m.role as 'user'|'assistant',text:m.batch ? `${m.text}\n[${m.outcome==='applied'?'已应用':m.outcome==='discarded'?'已放弃，不要视作已存在':m.outcome==='superseded'?'已合并到后续草稿':'仅预览'}]` : referenceText(m.text,m.images??[])}));
    const myRun = ++runRef.current;
    const alive = () => myRun === runRef.current;
    runningRef.current = true; 
    setInput(''); setAttachments([]); setNotice(''); setLastRequest({text, images:sentImages});
    setStarted(Date.now()); setProgress(null);
    runMessageId.current=store().addUserMessage(text || '请根据参考附件建模', sentImages);
    ui.setState({runMessageId:runMessageId.current});
    store().updateMessageRun(runMessageId.current,{startedAt:Date.now(),status:'running',generationQuality:cfg.generationQuality==='fast'?'fast':'fine',mode:usePi?'pi':'single'});
    store().setAiError(null); store().setAiStatus('capturing');
    const baseRevision = working.revision;
    const projectId = working.projectId;
    const selectedIds = [...store().selection];
    const editScope:EditScope=requestedScope;
    if(lockPlacement&&!editScope.lockPlacement)setNotice('本次指令明确要求移动或旋转，临时按指令解除位置锁；默认开关未修改');
    const controller = new AbortController(); abortRef.current = controller;
    const armTimeout = () => {
      if(timeoutRef.current)clearTimeout(timeoutRef.current);
      timeoutRef.current=setTimeout(()=>{
        if(!alive())return;
        runRef.current++;runningRef.current=false;clearControl();controller.abort();abortRef.current=null;release();
        const reason=usePi?'连续3分钟没有收到模型或工具活动，已暂停；可保留草稿后继续':'等待超过 3 分钟，已停止本次接收';
        if(preserveCheckpoint(reason))return;
        fail(reason+'。场景未修改；服务端可能仍在处理');
      },usePi?AGENT_LIMITS.idleTimeoutMs:REQUEST_TIMEOUT_MS);
    };
    armTimeout();
    try {
      store().setAiStatus('context');
      const ctx = buildSceneContext(working, selectedIds,editScope);
      store().setAiStatus('generating');
      setProgress({phase:'waiting',attempt:1,characters:0,lastEventAt:Date.now(),streaming:cfg.stream !== false});
      let batch: CommandBatch;
      let prepared: ExecutionResult | undefined;
      if(usePi) {
        const {runModelingAgent} = await import('../ai/modelingAgent');
        if(!alive()) return;
        const generated = await runModelingAgent({text:modelText,config:cfg,document:working,qualityBaseline:parent?original:working,referenceRepairs,selection:selectedIds,images,history,signal:controller.signal,editScope,captureAvailable:isIsolatedCaptureAvailable,captureEvidence:captureIsolatedSceneEvidence,
          onControl:control=>{if(alive()){controlRef.current=control;setCanSteer(!!control);if(!control)clearControl();}},
          onSteeringApplied:id=>{if(alive()){markSteering(id,'received');setNotice('补充要求已送入模型上下文');}},
          onCheckpoint:cp=>{if(alive()){const combined=continueDraft(original,parent,cp.batch,cp.result);checkpointRef.current={...cp,...combined};editor.setState({pendingBatch:combined.batch,pendingResult:combined.result});}},
          onActivity:event=>{if(alive()){armTimeout();queueAgentActivity(event);if(Date.now()-lastActivitySave>=1000||/暂停|中断|工具失败/.test(event.title)){store().setLastRun(event);if(runMessageId.current)store().updateMessageRun(runMessageId.current,{activity:event});lastActivitySave=Date.now();}if(checkpointRef.current)checkpointRef.current.activity=event;}},onPreview:document=>{if(alive())store().setPreviewDoc(document);}});
        batch=generated.batch;prepared=generated.result;if(alive()){setAgentActivity(generated.activity);store().setLastRun(generated.activity);}
      } else {
        const generated = await generateBatch(modelText+`\n本次编辑范围约束：${JSON.stringify(editScope)}。${editScope.nodeIds?'只允许修改范围内对象；allowAssemblyAdditions=true时可给完整组件追加部件，不能新增其他组件或改范围外对象。':'允许编辑全场景。高亮对象只是指代参考，不是权限边界，不能因此拒绝其他对象的修改。'}${editScope.lockPlacement?'保留所有已有位置与朝向。':'遵守用户描述中的布局和局部修改要求。'}`, cfg, ctx, controller.signal, images, history, event => { if(alive()) setProgress(event); });
        batch = {requestId:makeId(),projectId,baseRevision,selectedIds,summary:generated.summary,operations:generated.operations};
      }
      batch.editScope=editScope;
      if(alive()&&parent&&!batch.operations.length){store().setPendingBatch(parent.batch);store().setPendingResult(parent.result);store().setPreviewDoc(parent.result.doc);store().setAiStatus('previewing');finishRun('completed');store().addAssistantMessage(batch.summary);parentDraft.current=null;return;}
      if(alive()){const combined=continueDraft(original,parent,batch,prepared);finalize(combined.batch,combined.result);parentDraft.current=null;}
    } catch(e) {
      // An upstream error may echo its Authorization value. Keep the invocation's
      // credential out of messages, retained checkpoint summaries and persistence.
      const raw=e instanceof Error?e.message:String(e);
      const reason=cfg.apiKey.trim()?raw.split(cfg.apiKey.trim()).join('[已隐藏]'):raw;
      if(alive() && !preserveCheckpoint(reason)) fail(e instanceof TypeError && /fetch/i.test(e.message) ? '无法读取接口响应，请检查网络或网关跨域配置。场景未修改' : `生成未完成：${reason}`);
    } finally {
      if(alive()) { clearControl();runningRef.current=false; abortRef.current=null; if(timeoutRef.current) clearTimeout(timeoutRef.current); release(); }
    }
  };
  const cancel = () => {
    if(!runningRef.current)return;
    setAgentActivity(a=>a?{...a,timings:a.timings.map(t=>({...t,endedAt:t.endedAt??Date.now()}))}:a);
    runRef.current++; runningRef.current=false; clearControl();abortRef.current?.abort(); abortRef.current=null;
    if(timeoutRef.current) clearTimeout(timeoutRef.current);release();
    if(preserveCheckpoint('你已停止生成；保留草稿不会继续调用模型')){setNotice('已停止，阶段草稿仍可查看。继续生成需另行发送指令');return;}
    finishRun('stopped');
    { store().setAiStatus('cancelled'); store().setPreviewDoc(null); } store().setAiError(null);
    setNotice('已停止接收，场景未修改。服务端可能仍在处理，取消不保证退还用量');
    
  };
  const promoteQueued=(id:string,mode:'guide'|'question')=>{
    const message=store().messages.find(m=>m.id===id&&m.queuedTask?.status==='waiting');
    if(!message||!controlRef.current||!runningRef.current)return;
    editor.setState(state=>({messages:state.messages.map(item=>{if(item.id!==id)return item;const {queuedTask,...rest}=item;return {...rest,steering:{runId:runMessageId.current??'',status:'queued' as const}};})}));
    try{if(!controlRef.current.steer(id,referenceText(message.text,message.images??[]),(message.images??[]).filter(isReferenceImage),mode))throw Error('当前任务已收尾，请稍后发送');}
    catch(error){editor.setState(state=>({messages:state.messages.map(item=>item.id===id?message:item)}));setNotice(error instanceof Error?error.message:'引导未送达，消息仍在队列中');}
  };
  const removeQueued=(id:string)=>{editor.setState(state=>({messages:state.messages.map(m=>m.id===id&&m.queuedTask?.status==='waiting'?{...m,queuedTask:{status:'cancelled' as const}}:m)}));ui.setState({removedQueueId:id});};
  const restoreQueued=()=>{const id=ui.getState().removedQueueId;if(!id)return;editor.setState(state=>({messages:state.messages.map(m=>m.id===id&&m.queuedTask?.status==='cancelled'?{...m,queuedTask:{status:'waiting' as const}}:m)}));ui.setState({removedQueueId:null});};
  return {ui,send,cancel,setNotice,promoteQueued,removeQueued,restoreQueued,
    commit:()=>{if(runningRef.current)return;store().confirmPending();if(store().aiStatus==='idle')setNotice('修改已应用到当前项目；可撤销。不会继续调用模型。');checkpointRef.current=null;parentDraft.current=null;},
    discard:()=>{if(runningRef.current)return;checkpointRef.current=null;parentDraft.current=null;store().discardPending();setNotice('已放弃预览，原场景保持不变');}
  };
}
