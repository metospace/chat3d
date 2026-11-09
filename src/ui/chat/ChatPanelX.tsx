import {handleDashboardCommand} from '../../runtime/dashboardCommands';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type ComponentRef} from 'react';
import {createPortal} from 'react-dom';
import {PreviewDecision} from './PreviewDecision';
import {DashboardCommandPicker,dashboardPickerCommand,type DashboardCommandPickerRef} from './DashboardCommandPicker';
import {BlenderResult} from './BlenderResult';
import {FailureReason} from './FailureReason';
import {blenderPythonStatus,connectBlenderPython} from '../../scene/blenderModeling';
import {focusSceneObjects} from '../../scene/focus';
import {prepareReference,MAX_ATTACHMENT_BYTES,isReferenceImage} from '../../domain/referenceAttachments';
import {OperationProgress,nextProgressPaint} from '../OperationProgress';
import type {DashboardItem} from '../../domain/dashboard';
import {REFERENCE_IMAGE_JPEG_QUALITY,REFERENCE_IMAGE_MAX_SIDE} from '../../domain/referenceImageLimits';
import {PlusIcon,DotsHorizontalIcon,Pencil1Icon,TrashIcon,EnterIcon,ListBulletIcon} from '@radix-ui/react-icons';
import {Button,Dropdown,Select,Checkbox} from 'antd';
import {Attachments,Bubble,Sender} from '@ant-design/x';
import {ReferenceAttachments,MessageAttachments} from './ReferenceAttachments';
import {useSenderLabel} from './useSenderLabel';
import {useStore} from 'zustand';
import {useEditorStore,type ChatMessage} from '../../store';
import {activeConversationStore} from '../../conversationStores';
import {conversationController} from '../../runtime/conversationController';
import {sceneChanges} from '../../domain/editScope';
import {activityProgress} from '../../domain/customerProgress';
import {generationFailureMessage,sanitizeGenerationText} from '../../domain/generationFailure';
import {useAppearance} from '../Appearance';
import {SiteAccessRecovery} from '../SiteAccessRecovery';
import {MessageText} from '../MessageText';
import {ResultMessage} from '../ResultMessage';
import {ModelPicker} from '../ModelPicker';
import {GenerationMethodPicker} from '../GenerationMethodPicker';
import {AppTheme} from '../theme/AppTheme';
import {RunTrace} from './RunTrace';
import './adx-chat.css';
import './conversation.css';

export {REQUEST_TIMEOUT_MS} from '../../runtime/conversationController';

export async function compressImage(file: File | Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxSide = REFERENCE_IMAGE_MAX_SIDE;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法处理图片（浏览器不支持 canvas）');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', REFERENCE_IMAGE_JPEG_QUALITY);
}

function QueueRowMenu({text,busy,canSteer,onQuestion,onEdit,onRemove}:{text:string;busy:boolean;canSteer:boolean;onQuestion:()=>void;onEdit:()=>void;onRemove:()=>void}){
 return <Dropdown trigger={['click']} menu={{items:[
  ...(busy?[{key:'question',label:'只提问，不修改模型',disabled:!canSteer,onClick:onQuestion}]:[]),
  {key:'edit',label:'编辑消息',icon:<Pencil1Icon/>,onClick:onEdit},
  {key:'remove',label:'移出队列',icon:<TrashIcon/>,onClick:onRemove}
 ]}}><Button type="text" size="small" aria-label={`消息选项 ${text}`} icon={<DotsHorizontalIcon/>}
  onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.click();}}}/></Dropdown>;
}

const MESSAGE_LIST_CLASSES={scroll:'chat-transcript adx-transcript'};
const MESSAGE_ROLES={
  user:{placement:'end',variant:'borderless'},
  assistant:{placement:'start',variant:'borderless'},
  process:{placement:'start',variant:'borderless',style:{width:'100%'},styles:{content:{padding:0,width:'100%'}}},
  notice:{placement:'start',variant:'borderless',style:{width:'100%'},styles:{content:{padding:0,width:'100%'}}}
} as const;

export type ChatPanelProps={autoStartRequest?:{id:string;projectId:string;blenderModeling?:boolean}|null;onAutoStartConsumed?:(id:string)=>void;executionDetails?:boolean;onConfigure?:()=>void;onDashboardOpen?:()=>void;canvasMode?:boolean;expanded?:boolean;onExpand?:()=>void};

export function ChatPanelX(props:ChatPanelProps){
  return <AppTheme><ChatSurface {...props}/></AppTheme>;
}

function ChatSurface({onConfigure,onDashboardOpen,canvasMode=false,expanded=true,onExpand,autoStartRequest,onAutoStartConsumed}:ChatPanelProps){
  const {resolved}=useAppearance();
  const { messages, aiStatus, aiError, pendingBatch, pendingResult, aiConfig, selection, doc } = useEditorStore();
  const editor=activeConversationStore();
  const store = editor.getState;
  const runtime=conversationController(editor);
  const {notice,agentActivity,canSteer,started,lastRequest,removedQueueId,runMessageId:currentRunId,blenderResult}=useStore(runtime.ui);
  const runMessageId={current:currentRunId};
  const setNotice=runtime.setNotice;
  const input=useEditorStore(s=>s.composerText);
  const setInput=(text:string)=>store().setComposerText(text);
  const attachments=useEditorStore(s=>s.composerImages);
  const setAttachments=(value:string[]|((previous:string[])=>string[]))=>store().setComposerImages(typeof value==='function'?value(store().composerImages):value);
  const [lockPlacement,setLockPlacement]=useState(false);
  const [dashboardDismissed,setDashboardDismissed]=useState<{editor:typeof editor;text:string}|null>(null);
  const [dashboardWorking,setDashboardWorking]=useState<typeof editor|null>(null);
  const dashboardFlight=useRef(false);
  const dashboardPickerRef=useRef<DashboardCommandPickerRef>(null);
  const dashboardCommand=dashboardPickerCommand(input);
  const dashboardPickerOpen=!!dashboardCommand&&!(dashboardDismissed?.editor===editor&&dashboardDismissed.text===input);
  const dashboardBusy=dashboardWorking===editor;
  useEffect(()=>{setDashboardDismissed(null);},[editor,input]);
  const [blenderModeling,setBlenderModeling]=useState(autoStartRequest?.projectId===doc.projectId&&autoStartRequest.blenderModeling===true);
  const [blenderStatus,setBlenderStatus]=useState<'checking'|'online'|'offline'>('checking');
  const [blenderConnecting,setBlenderConnecting]=useState(false);
  const [blenderReason,setBlenderReason]=useState('');
  useEffect(()=>{
    if(!blenderModeling||blenderConnecting)return;
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]);
    void blenderPythonStatus(signal).then(({available,reason})=>{if(!controller.signal.aborted){setBlenderReason(reason??'');setBlenderStatus(available?'online':'offline');}},()=>{if(!controller.signal.aborted){setBlenderReason('');setBlenderStatus('offline');}});
    return()=>controller.abort();
  },[blenderModeling,blenderConnecting]);
  const connectBlender=async()=>{
    if(blenderConnecting)return;
    setBlenderConnecting(true);setBlenderStatus('checking');
    try{const {available,reason}=await connectBlenderPython();if(aliveRef.current){setBlenderReason(reason??'');setBlenderStatus(available?'online':'offline');}}
    catch(error){if(aliveRef.current){setBlenderReason(error instanceof Error?error.message:String(error));setBlenderStatus('offline');}}
    finally{if(aliveRef.current)setBlenderConnecting(false);}
  };
  const [scopeMode,setScopeMode]=useState<'scene'|'selection'>('scene');
  const [reviewHost,setReviewHost]=useState<HTMLElement|null>(null);
  useEffect(()=>{setReviewHost(canvasMode?document.querySelector<HTMLElement>('.workbench-review-slot'):null);},[canvasMode,doc.projectId]);
  useEffect(()=>{setScopeMode('scene');setLockPlacement(false);},[doc.projectId]);
  const [compareBefore,setCompareBefore]=useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [attachmentProgress,setAttachmentProgress]=useState({completed:0,total:0,name:''});
  const [now, setNow] = useState(Date.now());
  const [newMessages, setNewMessages] = useState(false);
  const imageBusyRef = useRef(false);
  const aliveRef = useRef(true);
  const listRef=useRef<ComponentRef<typeof Bubble.List>>(null);
  const stickRef = useRef(true);
  const scrollAfterSend=useRef(false);
  const scrollToLatest=()=>{if(listRef.current?.scrollBoxNativeElement)listRef.current.scrollTo({top:'bottom',behavior:'instant'});};
  const senderRef = useRef<ComponentRef<typeof Sender>>(null);
  const attachmentsRef=useRef<ComponentRef<typeof Attachments>>(null);
  useSenderLabel(senderRef,'建模描述');
  const focusComposer=()=>senderRef.current?.focus({cursor:'end',preventScroll:true});
  const busy = ['capturing','context','generating','validating','applying'].includes(aiStatus);
  const viewportStatus=useEditorStore(s=>s.viewportStatus);
  const previewing = aiStatus === 'previewing';
  const contextDoc=pendingResult?.doc??doc;
  const selectedNames=contextDoc.nodes.filter(node=>selection.includes(node.id)).map(node=>node.name);

  const changes=useMemo(()=>previewing&&pendingResult?sceneChanges(doc,pendingResult.doc):[],[previewing,doc,pendingResult]);
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const progress=activityProgress(agentActivity,busy,now);

  useEffect(() => {
    aliveRef.current=true;
    return()=>{aliveRef.current=false;const state=store();if(state.aiStatus==='previewing'&&state.pendingResult)state.setPreviewDoc(state.pendingResult.doc);};
  },[editor]);
  useEffect(()=>{if(busy)setCompareBefore(false);},[busy]);
  useEffect(() => { if (!busy) return; setNow(Date.now());const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [busy,started]);
  useLayoutEffect(() => {
    if(scrollAfterSend.current&&listRef.current?.scrollBoxNativeElement){scrollAfterSend.current=false;scrollToLatest();}
    if(!stickRef.current)setNewMessages(true);
  }, [messages, aiStatus, agentActivity, blenderResult]);

  const addImages = async (files: (File | Blob)[]) => {
    if (imageBusyRef.current||!files.length) return;
    imageBusyRef.current = true; setImageBusy(true);setAttachmentProgress({completed:0,total:files.length,name:''});setNotice('');
    const imgs: string[] = [];
    try {
      for (const [index,f] of files.entries()) {
        setAttachmentProgress({completed:index,total:files.length,name:f instanceof File?f.name:'粘贴附件'});await nextProgressPaint();
        if (f.size > MAX_ATTACHMENT_BYTES) { setNotice('单个附件不能超过 100 MB'); continue; }
        try { imgs.push(await prepareReference(f,compressImage)); } catch { setNotice('附件处理失败，请重新选择'); }
      }
      if (aliveRef.current) setAttachments(prev => [...prev, ...imgs]);
    } catch { if(aliveRef.current) setNotice('附件处理失败，请重新选择'); }
    finally { imageBusyRef.current = false; if(aliveRef.current) setImageBusy(false); }
  };
  const applyDashboardCommand=async(openResult=false,selection?:{templateId:string;version:number})=>{
    if(dashboardFlight.current||imageBusyRef.current)return;
    const capturedEditor=editor,capturedRuntime=runtime;
    dashboardFlight.current=true;setDashboardWorking(()=>capturedEditor);capturedRuntime.setNotice('');
    try{
      const handled=await handleDashboardCommand(capturedEditor,selection);
      if(!handled)capturedRuntime.setNotice('看板指令未识别，请在 /看板 后加空格选择模板，或输入 /看板 移除。输入已保留。');
      if(aliveRef.current&&activeConversationStore()===capturedEditor){
        focusComposer();
        if(handled&&openResult&&capturedEditor.getState().doc.dashboard)onDashboardOpen?.();
      }
    }catch(error){capturedRuntime.setNotice(error instanceof Error?error.message:String(error));}
    finally{dashboardFlight.current=false;if(aliveRef.current)setDashboardWorking(null);}
  };
  const selectDashboardSkill=()=>{
    if(dashboardFlight.current||imageBusyRef.current||activeConversationStore()!==editor||!['idle','error','cancelled'].includes(store().aiStatus))return;
    store().setComposerText('/看板 ');
    setDashboardDismissed(null);
    focusComposer();
  };
  const selectDashboard=(item:DashboardItem)=>{
    if(dashboardFlight.current||imageBusyRef.current||activeConversationStore()!==editor||!['idle','error','cancelled'].includes(store().aiStatus))return;
    const mode=dashboardCommand?.mode??'嵌入';
    store().setComposerText(`/看板 ${mode} ${item.name}`);
    setDashboardDismissed(null);
    void applyDashboardCommand(true,{templateId:item.id,version:item.version});
  };
  const send=async(mode:'guide'|'question'|'later'='guide')=>{
    if(imageBusyRef.current||dashboardFlight.current)return;
    if(dashboardPickerCommand(store().composerText)){setDashboardDismissed(null);focusComposer();return;}
    if(/^\s*\/看板/.test(store().composerText)){await applyDashboardCommand();return;}
    const previousMessages=store().messages;
    if(!busy&&blenderModeling&&blenderStatus!=='online'){setNotice('本机 Blender 尚未就绪，请点击“连接 Blender”，或在生成方式菜单中选择“直接生成”。输入已保留。');return;}
    stickRef.current=true;scrollAfterSend.current=true;setNewMessages(false);await runtime.send(mode,{scopeMode:blenderModeling?'scene':scopeMode,lockPlacement:!blenderModeling&&lockPlacement,reuseReference:true,blenderModeling});
    if(store().messages===previousMessages)scrollAfterSend.current=false;
    if(aliveRef.current)focusComposer();
  };
  const cancel=()=>{runtime.cancel();focusComposer();};
  const autoStarted=useRef<string|null>(null);
  useEffect(()=>{
    if(!autoStartRequest||autoStartRequest.projectId!==doc.projectId||autoStarted.current===autoStartRequest.id)return;
    if(blenderModeling!==(autoStartRequest.blenderModeling===true)){setBlenderStatus('checking');setBlenderModeling(autoStartRequest.blenderModeling===true);return;}
    if(blenderModeling&&blenderStatus==='checking')return;
    // Deferred past StrictMode's setup/cleanup replay. The request is transient and consumed before sending.
    const timer=setTimeout(()=>{if(!aliveRef.current||autoStarted.current===autoStartRequest.id)return;autoStarted.current=autoStartRequest.id;onAutoStartConsumed?.(autoStartRequest.id);void send();},0);
    return()=>clearTimeout(timer);
  },[autoStartRequest?.id,doc.projectId,blenderModeling,blenderStatus]);

  const pendingMessages=messages.filter(m=>m.queuedTask?.status==='waiting');
  const prepareQueued=(id:string)=>{const m=store().messages.find(m=>m.id===id&&m.queuedTask?.status==='waiting');if(!m)return;if(store().composerText.trim()||store().composerImages.length){setNotice('请先处理输入框中的内容');return;}setInput(m.text);setAttachments(m.images??[]);editor.setState(state=>({messages:state.messages.map(item=>item.id===id?{...item,queuedTask:{status:'prepared' as const}}:item)}));focusComposer();};
  const promoteQueued=runtime.promoteQueued;
  const {removeQueued,restoreQueued}=runtime;

  const restore = () => {
    if(!lastRequest) return;
    if(input.trim() || attachments.length) { setNotice('请先处理当前草稿，再恢复上一条输入'); return; }
    setInput(lastRequest.text); setAttachments(lastRequest.images); setNotice('已恢复，请按需修改后发送'); focusComposer();
  };

  const commit = () => {runtime.commit();focusComposer();};
  const discard = () => {runtime.discard();focusComposer();};

  const previewCard=(previewing&&pendingBatch&&<PreviewDecision activity={agentActivity??store().lastRun} batch={pendingBatch} changes={changes} document={pendingResult?.doc??doc} before={compareBefore} viewportReady={viewportStatus==='ready'} referenceImages={([...messages].reverse().find(message=>message.role==='user'&&message.images?.some(isReferenceImage))?.images??[]).filter(isReferenceImage)} onCompare={()=>{if(!pendingResult)return;const before=!compareBefore;setCompareBefore(before);store().setPreviewDoc(before?doc:pendingResult.doc);}} onApply={commit} onDiscard={discard} onContinue={()=>{if(!input.trim()&&pendingBatch.continuation)setInput(sanitizeGenerationText(pendingBatch.continuation,{fallback:'请继续调整当前预览，保留已完成的部分。'}));focusComposer();}} onLocate={ids=>{if(compareBefore&&pendingResult){setCompareBefore(false);store().setPreviewDoc(pendingResult.doc);}store().select(ids);requestAnimationFrame(()=>{focusSceneObjects(ids);});}} onPrepareChecks={text=>{if(store().composerText.trim()||store().composerImages.length){setNotice('输入框已有内容，请先处理当前草稿，再生成核对要求');focusComposer();return;}setInput(text);setNotice('核对要求已放入输入框，发送后才会生成；当前预览仍保留');focusComposer();}}/>);

  const messageFooter=(m:ChatMessage)=>{
    if(!m.steering&&!(m.run&&['failed','stopped'].includes(m.run.status)&&!busy))return null;
    return <>
    {m.steering&&<p className="adx-bubble-note">{m.steering.status==='queued'?'补充要求 · 等待接收':m.steering.status==='received'?'补充要求 · 已送入模型上下文':'补充要求 · 未送达，可重新发送'}{m.steering.status==='interrupted'&&<button type="button" className="adx-link" onClick={()=>{if(input.trim()||attachments.length){setNotice('请先处理输入框中的内容，再恢复补充要求');return;}setInput(m.text);setAttachments(m.images??[]);focusComposer();}}>恢复补充要求</button>}</p>}
    {m.run&&['failed','stopped'].includes(m.run.status)&&!busy&&<button type="button" className="adx-link" onClick={()=>{if(input.trim()||attachments.length){setNotice('请先处理输入框中的内容');return;}setInput(m.text);setAttachments(m.images??[]);focusComposer();}}>恢复本轮输入</button>}
  </>;
  };

  const bubbleContent=(m:ChatMessage)=><div className="adx-bubble-body">
    {!!m.images?.length&&<MessageAttachments values={m.images}/>}
    {m.role==='assistant'?m.batch?<ResultMessage text={sanitizeGenerationText(m.text,{previewRetained:true,failed:!!m.error&&m.text===m.error})}/>:<MessageText text={sanitizeGenerationText(m.text,{failed:!!m.error&&m.text===m.error})}/>:<MessageText text={m.text}/>}
    {m.error&&<FailureReason reason={typeof m.error==='string'?m.error:m.text} apiKey={aiConfig?.apiKey}/>}
  </div>;

  const configured=!!aiConfig?.baseURL&&!!aiConfig.apiKey&&!aiConfig.useMock;
  const exampleTarget=selectedNames[0]??contextDoc.nodes[0]?.name;
  const examples=exampleTarget?[
    {label:`调整“${exampleTarget}”的配色`,text:`将“${exampleTarget}”改为深灰色，保留尺寸和位置`},
    {label:`了解“${exampleTarget}”的尺寸`,text:`说明“${exampleTarget}”的尺寸和结构，先不要修改`}
  ]:[
    {label:'创建带尺寸的工作台',text:'创建一个长 1.2 米、宽 0.8 米、高 0.75 米的工作台'},
    {label:'规划小型仓储场景',text:'创建一个小型仓储场景，包含货架、周转箱和通道'}
  ];
  const emptyState=!messages.length&&<div className="adx-empty-state">
    <p>{contextDoc.nodes.length?'描述要调整的地方，修改会先预览。':'描述要创建的模型或场景，也可以添加参考附件。'}</p>
    <div className="adx-examples" role="group" aria-label="描述示例">
      {examples.map(example=><button type="button" key={example.text} title={example.text} onClick={()=>{setInput(example.text);focusComposer();}}>{example.label}</button>)}
    </div>
  </div>;
  const errorNotice=(aiStatus==='error' || aiStatus==='cancelled') && <div className="adx-chat-alert" role="status"><span>{aiStatus==='error'?generationFailureMessage(aiError):'已停止生成，场景未修改。'}</span>{lastRequest && <button type="button" className="adx-link" onClick={restore}>恢复输入</button>}</div>;
  const messageItems=messages.filter(m=>!m.queuedTask).flatMap(m=>{
    const hasContent=!!(m.text.trim()||m.images?.length||m.batch);
    const footer=messageFooter(m);
    const inlinePreview=!canvasMode&&previewing&&m.batch?.requestId===pendingBatch?.requestId?previewCard:null;
    const messageItem={key:m.id,role:m.role,className:`adx-bubble ${m.role==='user'?'is-user':'is-assistant'} ${m.error?'is-error':''}`,
      content:hasContent?bubbleContent(m):null,
      streaming:m.role==='assistant'&&busy&&m.id===runMessageId.current,status:m.error?'error' as const:busy&&m.id===runMessageId.current?'updating' as const:'success' as const,
      footer:footer||inlinePreview?<>{footer}{inlinePreview}</>:null,
      footerPlacement:m.role==='user'?'outer-end' as const:'outer-start' as const,
      ...(!hasContent?{styles:{content:{display:'none'}}}:{})};
    const activity=busy&&m.id===runMessageId.current?agentActivity:m.run?.activity;
    const showProcess=!!m.run;
    const processItems=showProcess?[{key:`${m.id}-process`,role:'process',className:'adx-process-message',streaming:busy&&m.id===runMessageId.current,
      content:<RunTrace run={m.run!} activity={activity} blender={busy&&m.id===runMessageId.current&&blenderModeling}/>}]:[];
    // Runtime stores run metadata on the user request. It must follow that request,
    // while older projects that store it on an assistant message keep it before the answer.
    return m.role==='user'?[messageItem,...processItems]:[...processItems,messageItem];
  });
  const listItems=[
    ...(emptyState?[{key:'empty',role:'notice',content:emptyState}]:[]),...messageItems,
    ...(errorNotice?[{key:'error',role:'notice',content:errorNotice}]:[]),
    ...(blenderResult?[{key:'blender-result',role:'notice',content:<BlenderResult result={blenderResult}/>}]:[]),
    ...(!canvasMode&&previewing&&!messages.some(m=>m.batch?.requestId===pendingBatch?.requestId)?[{key:'preview',role:'notice',content:previewCard}]:[])
  ];

  return <div className={`chat-panel adx-chat ${canvasMode?'canvas-chat':''} ${!expanded?'is-compact':''}`} data-adx-appearance={resolved}>
    {previewing&&<div className="adx-chat-topline"><span>修改结果待确认</span></div>}
    <Bubble.List ref={listRef} className="adx-messages" classNames={MESSAGE_LIST_CLASSES} role={MESSAGE_ROLES} autoScroll items={listItems}
      onScroll={event=>{stickRef.current=Math.abs(event.currentTarget.scrollTop)<64;if(stickRef.current)setNewMessages(false);}}/>
    {canvasMode&&expanded&&previewCard&&(reviewHost?createPortal(previewCard,reviewHost):previewCard)}
    <SiteAccessRecovery error={aiError}/>
    {newMessages && <button type="button" className="adx-scroll-latest" onClick={()=>{stickRef.current=true;setNewMessages(false);scrollToLatest();}}>查看最新消息 ↓</button>}
    {busy&&<div className="adx-notice" aria-label="当前草稿状态" data-phase={progress.phase} data-model-state={progress.modelState}>{progress.modelEditAgeSeconds!==undefined&&<p aria-label="距上次模型修改">距上次模型修改 {progress.modelEditAgeSeconds} 秒</p>}{agentActivity&&(agentActivity.inputTokens+agentActivity.outputTokens>=100000||elapsed>=300)&&<p>任务耗时较长，可在任务记录查看详情。</p>}</div>}
    {canvasMode&&!expanded&&previewing&&<div className="adx-compact-strip"><span>修改结果待确认</span><Button size="small" onClick={onExpand}>查看详情</Button><Button size="small" type="primary" disabled={compareBefore} onClick={commit}>应用修改</Button><Button size="small" onClick={discard}>放弃修改</Button></div>}
    {canvasMode&&!expanded&&busy&&<div className="adx-compact-strip"><Button size="small" onClick={onExpand}>查看过程</Button></div>}
    <div className="adx-composer">
      {blenderModeling&&<div className="instruction-context blender-connection"><span role="status">{blenderStatus==='checking'?'正在连接本机 Blender…':blenderStatus==='online'?'本机 Blender 已连接':blenderReason||'本机 Blender 未连接'}</span>{blenderStatus!=='checking'&&blenderStatus!=='online'&&<Button size="small" type="text" disabled={busy||blenderConnecting} onClick={()=>void connectBlender()}>连接 Blender</Button>}</div>}
      {(selectedNames.length>0||!blenderModeling&&(contextDoc.nodes.length>0||scopeMode==='selection'||lockPlacement))&&<div className="instruction-context" role="group" aria-label="本次修改范围">
        <div>{selectedNames.length>0&&<span aria-label="当前选中对象" title={selectedNames.join('、')}>当前选中：{selectedNames.length===1?selectedNames[0]:`${selectedNames.length} 个部件 · ${selectedNames.slice(0,3).join('、')}${selectedNames.length>3?' 等':''}`}</span>}{!blenderModeling&&lockPlacement&&<span>已锁定位置与朝向</span>}</div>
        {!blenderModeling&&<label>修改范围<Select aria-label="对话修改范围" size="small" value={scopeMode} disabled={busy} onChange={setScopeMode} popupMatchSelectWidth={false} popupRender={menu=><>{menu}<div className="adx-scope-options" onMouseDown={event=>event.preventDefault()}><Checkbox disabled={busy} checked={lockPlacement} onChange={event=>setLockPlacement(event.target.checked)}>锁定已有对象的位置与朝向</Checkbox><p>选中对象用于指代；选择“仅选中对象”才会限制修改范围。</p></div></>} options={[{value:'scene',label:'全场景'},{value:'selection',label:`仅选中对象（${selection.length}）`}]}/></label>}
      </div>}
      {!blenderModeling&&scopeMode==='selection'&&!selection.length&&<p className="instruction-scope-empty" role="note">请先选择要修改的对象，或切换到全场景。</p>}
      {removedQueueId&&<div className="adx-queue-undo">已移出队列 <button type="button" className="adx-link" onClick={restoreQueued}>撤销移除</button></div>}
      <div className={`adx-composer-surface${pendingMessages.length?' has-queue':''}`}>
      {!!pendingMessages.length&&<section className="adx-queue" role="region" aria-label="排队消息"><div className="adx-queue-list">{pendingMessages.map(m=><div className="adx-queue-row" key={m.id}><ListBulletIcon className="adx-queue-marker" aria-hidden="true"/><span className="adx-queue-text" title={m.text}>{m.text||'参考附件'}{m.images?.length?` · ${m.images.length} 个附件`:''}</span><div className="adx-queue-actions"><Button type="text" size="small" className="adx-queue-guide" icon={<EnterIcon/>} disabled={busy&&!canSteer} title={busy&&!canSteer?'当前模型暂不能接收引导，消息会保留在队列中':busy?'将这条消息送入当前任务':'将这条消息放回输入框，确认后发送'} onClick={()=>busy?promoteQueued(m.id,'guide'):prepareQueued(m.id)}>{busy?'引导':'准备发送'}</Button><Button type="text" size="small" aria-label={`移出队列 ${m.text}`} title="移出队列" icon={<TrashIcon/>} onClick={()=>removeQueued(m.id)}/><QueueRowMenu text={m.text} busy={busy} canSteer={canSteer} onQuestion={()=>promoteQueued(m.id,'question')} onEdit={()=>prepareQueued(m.id)} onRemove={()=>removeQueued(m.id)}/></div></div>)}</div></section>}
      {dashboardPickerOpen&&dashboardCommand&&<DashboardCommandPicker ref={dashboardPickerRef} query={dashboardCommand.query} skills={dashboardCommand.skills} busy={dashboardBusy} locked={busy||previewing} senderRef={senderRef} onSelect={selectDashboard} onSelectSkill={selectDashboardSkill} onDismiss={()=>setDashboardDismissed({editor,text:input})}/>}
      {imageBusy&&<OperationProgress title="处理参考附件" stage="读取并准备附件" completed={attachmentProgress.completed} total={attachmentProgress.total} detail={attachmentProgress.name}/>}
      <Sender
        ref={senderRef}
        className="adx-sender"
        value={input}
        onChange={value=>setInput(value)}
        onPasteFile={(files)=>void addImages(Array.from(files))}
        onSubmit={()=>void send(busy?'later':'guide')}
        onCancel={cancel}
        loading={dashboardBusy||busy&&!input.trim()&&!attachments.length}
        onKeyDown={event=>{
          if(event.nativeEvent.isComposing||event.keyCode===229)return false;
          if(dashboardPickerOpen)return dashboardPickerRef.current?.onKeyDown(event);
          if(dashboardBusy&&event.key==='Enter'){event.preventDefault();return false;}
        }}
        autoSize={{minRows:3,maxRows:8}}
        readOnly={imageBusy||dashboardBusy}
        placeholder={busy?'补充要求…':previewing?'描述需要继续调整的地方…':'描述你想创建或修改的内容…'}
        header={<Sender.Header title={`参考附件 · ${attachments.length}`} open={attachments.length>0} forceRender closable={false}>
          <ReferenceAttachments ref={attachmentsRef} values={attachments} disabled={imageBusy}
            onAdd={files=>void addImages(files)} onRemove={index=>setAttachments(prev=>prev.filter((_,i)=>i!==index))}/>
        </Sender.Header>}
        prefix={false}
        suffix={false}
        footer={(_, {components:{SendButton}})=><div className="adx-composer-toolbar">
          <div className="adx-composer-controls">
            <Button type="text" shape="circle" aria-label="添加参考附件" title="添加参考附件（单文件100MB以内）" disabled={imageBusy}
              icon={<PlusIcon/>} onClick={()=>attachmentsRef.current?.select({multiple:true})}/>
            {configured&&<GenerationMethodPicker onConfigure={onConfigure} blenderModeling={blenderModeling} onBlenderModelingChange={value=>{setBlenderStatus('checking');setBlenderModeling(value);setNotice('');}}/>}
            <ModelPicker onConfigure={onConfigure}/>
          </div>
          <span className="adx-send-cluster">
            {busy&&<Button className="adx-stop-generation" size="small" onClick={cancel}>停止生成</Button>}
            {(!busy||!!input.trim()||!!attachments.length)&&<SendButton shape="circle" style={{width:34,height:34,borderRadius:'50%'}}
              aria-label={dashboardPickerOpen?dashboardCommand?.skills?'请在列表选择技能':'请在列表选择看板':busy?'加入消息队列':'发送'} title={dashboardPickerOpen?dashboardCommand?.skills?'请在列表选择技能，或按 Enter 查看模板':'请在列表选择看板，或按 Enter 接入当前选项':busy?'加入待处理消息，发送后可选择引导当前任务':'发送（Enter发送，Shift+Enter换行）'}
              disabled={imageBusy||dashboardBusy||dashboardPickerOpen||(!input.trim()&&!attachments.length)}/>}
          </span>
        </div>}

      />
      {notice?<div role="status" className="adx-composer-notice">{notice}</div>:!configured&&!dashboardCommand&&!dashboardBusy&&<p className="adx-connection-hint" role="note">连接模型后即可生成，草稿和附件会保留。</p>}
      </div>
    </div>
  </div>;
}
