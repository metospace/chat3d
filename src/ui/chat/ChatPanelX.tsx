import {AccessibleModal as Modal} from '../kit/AccessibleModal';
import {forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState,type ComponentRef,type ComponentType} from 'react';
import {prepareReference,isReferenceImage,attachmentInfo,MAX_ATTACHMENT_BYTES} from '../../domain/referenceAttachments';
import {REFERENCE_IMAGE_JPEG_QUALITY,REFERENCE_IMAGE_MAX_SIDE} from '../../domain/referenceImageLimits';
import {PlusIcon,ArrowUpIcon,StopIcon,ImageIcon,PersonIcon,ChatBubbleIcon,DotsHorizontalIcon,Pencil1Icon,TrashIcon,CheckIcon} from '@radix-ui/react-icons';
import {Button,Input,Tag,Select,Checkbox,type GetProps} from 'antd';
import {PopoverPanel} from '../kit/PopoverPanel';
import {Bubble,Prompts,Sender,Welcome,FileCard} from '@ant-design/x';
import {useStore} from 'zustand';
import {useEditorStore,type ChatMessage} from '../../store';
import {activeConversationStore} from '../../conversationStores';
import {conversationController} from '../../runtime/conversationController';
import {sceneChanges} from '../../domain/editScope';
import {useAppearance} from '../Appearance';
import {SiteAccessRecovery} from '../SiteAccessRecovery';
import {MessageText} from '../MessageText';
import {ResultMessage} from '../ResultMessage';
import {ModelPicker} from '../ModelPicker';
import {QualityPicker} from '../QualityPicker';
import {AppTheme} from '../theme/AppTheme';
import {RunTrace} from './RunTrace';
import './adx-chat.css';

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

type ComposerInputProps=GetProps<typeof Input.TextArea>;
/** Ant Design X calls back into the textarea for submit/focus, so the custom input must expose the same ref API. */
type ComposerInputRef={nativeElement:HTMLTextAreaElement|null;focus:(options?:{preventScroll?:boolean;cursor?:'start'|'end'|'all'})=>void;blur:()=>void;insert:(value:string,position?:'start'|'end'|'cursor')=>void;clear:()=>void;getValue:()=>({value:string;slotConfig:unknown[]})};
/** The accessible name of the composer lives here: Ant Design X forwards extra props to the root, not the textarea. */
const ComposerInput=forwardRef<ComposerInputRef,ComposerInputProps>(function ComposerInput(props,ref){
  const areaRef=useRef<ComponentRef<typeof Input.TextArea>>(null);
  const textarea=()=>areaRef.current?.resizableTextArea?.textArea??null;
  useImperativeHandle(ref,()=>({
    nativeElement: (areaRef.current?.nativeElement??null) as HTMLTextAreaElement|null,
    focus: options=>areaRef.current?.focus(options),
    blur: ()=>areaRef.current?.blur(),
    insert: (value,position)=>{
      const el=textarea(); if(!el) return;
      const at=position==='start'?0:position==='end'?el.value.length:el.selectionStart??el.value.length;
      el.setRangeText(value,at,at,'end'); el.dispatchEvent(new Event('input',{bubbles:true}));
    },
    clear: ()=>{const el=textarea(); if(!el) return; el.value=''; el.dispatchEvent(new Event('input',{bubbles:true}));},
    getValue: ()=>({value:String(props.value??''),slotConfig:[]}),
  }),[props.value]);
  return <Input.TextArea {...props} ref={areaRef} aria-label="建模指令" rows={props.rows??4} className="adx-composer-input" autoSize={props.autoSize}/>;
});

/** Per-row options for a queued message. Owns its trigger ref so the popup follows the row. */
function QueueRowMenu({text,busy,canSteer,onQuestion,onEdit,onRemove}:{text:string;busy:boolean;canSteer:boolean;onQuestion:()=>void;onEdit:()=>void;onRemove:()=>void}){
  const [open,setOpen]=useState(false),triggerRef=useRef<HTMLButtonElement>(null);
  const run=(action:()=>void)=>{setOpen(false);action();};
  return <>
    <Button ref={triggerRef} type="text" size="small" className="adx-queue-more" aria-label={`消息选项 ${text}`} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '||event.key==='ArrowDown'){event.preventDefault();setOpen(true);}}}><DotsHorizontalIcon/></Button>
    <PopoverPanel anchor={triggerRef} open={open} onClose={()=>setOpen(false)} label={`消息选项 ${text}`}>
      <div className="composer-action-menu" role="menu" aria-label="消息选项">
        {busy&&<button type="button" role="menuitem" className="composer-action-item" disabled={!canSteer} onClick={()=>run(onQuestion)}>只提问，不修改模型</button>}
        <button type="button" role="menuitem" className="composer-action-item" onClick={()=>run(onEdit)}><Pencil1Icon/>编辑消息</button>
        <button type="button" role="menuitem" className="composer-action-item" onClick={()=>run(onRemove)}><TrashIcon/>移出队列</button>
      </div>
    </PopoverPanel>
  </>;
}

const SendIcon=<ArrowUpIcon/>;

export type ChatPanelProps={autoStartRequest?:{id:string;projectId:string}|null;onAutoStartConsumed?:(id:string)=>void;executionDetails?:boolean;onConfigure?:()=>void;onAssets?:()=>void;canvasMode?:boolean;expanded?:boolean;onExpand?:()=>void};

export function ChatPanelX(props:ChatPanelProps){
  return <AppTheme><ChatSurface {...props}/></AppTheme>;
}

function ChatSurface({onConfigure,onAssets,canvasMode=false,expanded=true,onExpand,autoStartRequest,onAutoStartConsumed}:ChatPanelProps){
  const {resolved}=useAppearance();
  const { messages, aiStatus, aiError, pendingBatch, pendingResult, aiConfig, selection, doc } = useEditorStore();
  const editor=activeConversationStore();
  const store = editor.getState;
  const runtime=conversationController(editor);
  const {notice,agentActivity,canSteer,started,lastRequest,removedQueueId,runMessageId:currentRunId}=useStore(runtime.ui);
  const runMessageId={current:currentRunId};
  const setNotice=runtime.setNotice;
  const input=useEditorStore(s=>s.composerText);
  const setInput=(text:string)=>store().setComposerText(text);
  const attachments=useEditorStore(s=>s.composerImages);
  const setAttachments=(value:string[]|((previous:string[])=>string[]))=>store().setComposerImages(typeof value==='function'?value(store().composerImages):value);
  const [lockPlacement,setLockPlacement]=useState(false);
  const [scopeMode,setScopeMode]=useState<'scene'|'selection'>('scene');
  useEffect(()=>{setScopeMode('scene');setLockPlacement(false);},[doc.projectId]);
  const [compareBefore,setCompareBefore]=useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reuseReference, setReuseReference] = useState(true);
  const [imageView, setImageView] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const attachRef = useRef<HTMLButtonElement>(null);
  const [newMessages, setNewMessages] = useState(false);
  const imageBusyRef = useRef(false);
  const aliveRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const senderRef = useRef<ComponentRef<typeof Sender>>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const focusComposer=()=>senderRef.current?.focus({cursor:'end'});
  const busy = ['capturing','context','generating','validating','applying'].includes(aiStatus);
  const viewportStatus=useEditorStore(s=>s.viewportStatus);
  const previewing = aiStatus === 'previewing';

  const changes=useMemo(()=>previewing&&pendingResult?sceneChanges(doc,pendingResult.doc):[],[previewing,doc,pendingResult]);
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));

  useEffect(() => {
    aliveRef.current=true;
    return()=>{aliveRef.current=false;const state=store();if(state.aiStatus==='previewing'&&state.pendingResult)state.setPreviewDoc(state.pendingResult.doc);};
  },[editor]);
  useEffect(()=>{if(busy)setCompareBefore(false);},[busy]);
  useEffect(() => { if (!busy) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [busy]);
  useEffect(() => {
    if (stickRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    else setNewMessages(true);
  }, [messages, aiStatus]);

  const addImages = async (files: (File | Blob)[]) => {
    if (imageBusyRef.current) return;
    imageBusyRef.current = true; setImageBusy(true); setNotice('');
    const imgs: string[] = [];
    try {
      for (const f of files) {
        if (f.size > MAX_ATTACHMENT_BYTES) { setNotice('单个附件不能超过 100 MB'); continue; }
        try { imgs.push(await prepareReference(f,compressImage)); } catch { setNotice('附件处理失败，请重新选择'); }
      }
      if (aliveRef.current) setAttachments(prev => [...prev, ...imgs]);
    } catch { if(aliveRef.current) setNotice('附件处理失败，请重新选择'); }
    finally { imageBusyRef.current = false; if(aliveRef.current) setImageBusy(false); }
  };
  const send=async(mode:'guide'|'question'|'later'='guide')=>{
    if(imageBusyRef.current)return;
    stickRef.current=true;await runtime.send(mode,{scopeMode,lockPlacement,reuseReference});
    if(aliveRef.current)focusComposer();
  };
  const cancel=()=>{runtime.cancel();focusComposer();};
  const autoStarted=useRef<string|null>(null);
  useEffect(()=>{
    if(!autoStartRequest||autoStartRequest.projectId!==doc.projectId||autoStarted.current===autoStartRequest.id)return;
    // Deferred past StrictMode's setup/cleanup replay. The request is transient and consumed before sending.
    const timer=setTimeout(()=>{if(!aliveRef.current||autoStarted.current===autoStartRequest.id)return;autoStarted.current=autoStartRequest.id;onAutoStartConsumed?.(autoStartRequest.id);void send();},0);
    return()=>clearTimeout(timer);
  },[autoStartRequest?.id,doc.projectId]);

  const pendingMessages=messages.filter(m=>m.queuedTask?.status==='waiting');
  const prepareQueued=(id:string)=>{const m=store().messages.find(m=>m.id===id&&m.queuedTask?.status==='waiting');if(!m)return;if(store().composerText.trim()||store().composerImages.length){setNotice('请先处理输入框中的内容');return;}setInput(m.text);setAttachments(m.images??[]);editor.setState(state=>({messages:state.messages.map(item=>item.id===id?{...item,queuedTask:{status:'prepared' as const}}:item)}));focusComposer();};
  const promoteQueued=runtime.promoteQueued;
  const {removeQueued,restoreQueued}=runtime;

  const restore = () => {
    if(!lastRequest) return;
    if(input.trim() || attachments.length) { setNotice('请先处理当前草稿，再恢复上一条指令'); return; }
    setInput(lastRequest.text); setAttachments(lastRequest.images); setNotice('已恢复，请按需修改后发送'); focusComposer();
  };

  const commit = () => {runtime.commit();focusComposer();};
  const discard = () => {runtime.discard();focusComposer();};

  const previewCard=(previewing && pendingBatch && <section className="adx-preview" role="region" aria-label="预览确认">
      <div className="adx-preview-head">
        <span className="adx-preview-kicker">{pendingBatch.taskStatus==='partial'?'本次任务中断 · 已保留部分修改':'本次修改已生成 · 等待应用'}</span>
        <Tag color="success">{pendingBatch.operations.length} 项操作</Tag>
      </div>
      <p className="adx-preview-note">应用后写入当前项目，可撤销；继续调整会在当前预览上修改。</p>
      <div className="adx-preview-actions">
        <Button type="primary" disabled={compareBefore} onClick={commit} className="adx-preview-apply">应用修改</Button>
        <Button onClick={discard}>放弃修改</Button>
      </div>
      {(pendingBatch.incomplete||viewportStatus!=='ready')&&<details className="adx-preview-details adx-warn"><summary>模型质量：尚有待核对项（不等于本次修改失败）</summary><p>{viewportStatus!=='ready'?'实时三维画面不可用，尚不能完成真实材质与交互验收。':''}应用修改不会将模型质量标为通过。</p>{!!pendingBatch.qualityIssues?.length&&<ul>{[...new Set(pendingBatch.qualityIssues)].map((issue,i)=><li key={i}>{issue}</li>)}</ul>}</details>}
      {pendingResult&&<details className="adx-preview-details"><summary>修改对比与受影响对象</summary><p>修改对比：新增 {changes.filter(c=>c.kind==='added').length} · 修改 {changes.filter(c=>c.kind==='modified').length} · 移除 {changes.filter(c=>c.kind==='removed').length}</p><details><summary>查看受影响对象</summary><ul className="adx-preview-objects">{changes.map(c=><li key={c.id}><button type="button" disabled={!pendingResult.doc.nodes.some(n=>n.id===c.id)} onClick={()=>store().select([c.id])}>{c.group} / {c.name}：{c.fields.join('、')}</button></li>)}</ul></details><Button size="small" onClick={()=>{const before=!compareBefore;setCompareBefore(before);store().setPreviewDoc(before?doc:pendingResult.doc);}}>{compareBefore?'查看修改后':'查看修改前'}</Button>{compareBefore&&<p className="adx-warn">当前显示修改前，请切回修改后再确认应用</p>}</details>}
      <Button type="link" size="small" className="adx-preview-continue" onClick={()=>{if(!input.trim()&&pendingBatch.continuation)setInput(pendingBatch.continuation);focusComposer();}}>继续调整</Button>
    </section>);

  const messageFooter=(m:ChatMessage)=><>
    {m.steering&&<p className="adx-bubble-note">{m.steering.status==='queued'?'补充要求 · 等待接收':m.steering.status==='received'?'补充要求 · 已送入模型上下文':'补充要求 · 未送达，可重新发送'}{m.steering.status==='interrupted'&&<button type="button" className="adx-link" onClick={()=>{if(input.trim()||attachments.length){setNotice('请先处理输入框中的内容，再恢复补充要求');return;}setInput(m.text);setAttachments(m.images??[]);focusComposer();}}>恢复补充要求</button>}</p>}
    {m.batch && <p className="adx-bubble-outcome">{m.outcome==='applied'?'✓ 已应用 · 可用工具栏撤销':m.outcome==='discarded'?'已放弃 · 未修改场景':m.outcome==='superseded'?'已合并到后续预览':pendingBatch?.requestId===m.batch.requestId?'待确认 · 当前画面是预览':'预览已结束'}</p>}
    {m.run&&['failed','stopped'].includes(m.run.status)&&!busy&&<button type="button" className="adx-link" onClick={()=>{if(input.trim()||attachments.length){setNotice('请先处理输入框中的内容');return;}setInput(m.text);setAttachments(m.images??[]);focusComposer();}}>恢复本轮指令</button>}
  </>;

  const bubbleContent=(m:ChatMessage)=><div className="adx-bubble-body">
    {!!m.images?.length && <div className="adx-bubble-images">{m.images.map((src,i)=>isReferenceImage(src)?<button type="button" key={i} onClick={()=>setImageView(src)} title="放大参考图"><img src={src} alt={`参考图 ${i+1}`}/></button>:<FileCard type="file" aria-label={attachmentInfo(src).name} key={i} name={attachmentInfo(src).name} byte={attachmentInfo(src).size} size="small" description="仅提供文件信息，尚未解析内容"/>)}</div>}
    {m.role==='assistant'&&m.error?<><MessageText text={m.text.includes('倒角半径')?'零件倒角超出尺寸限制，生成已暂停。请恢复指令后重试。':'本次生成未完成，请查看错误详情。'}/>{!(aiError&&m.text.includes(aiError))&&<details className="adx-bubble-error"><summary>错误详情</summary><MessageText text={m.text}/></details>}</>:m.role==='assistant'&&m.batch?<ResultMessage text={m.text}/>:<MessageText text={m.text}/>}
  </div>;

  return <div className={`chat-panel adx-chat ${canvasMode?'canvas-chat':''} ${!expanded?'is-compact':''}`} data-adx-appearance={resolved}>
    <div className="adx-chat-topline">
      <span className="adx-chat-context" title="会话在本浏览器保存；请下载项目文件长期备份">{selection.length ? `已选 ${selection.length} 个对象` : `场景 ${doc.nodes.length} 个对象`}</span>
      {busy&&<span className="adx-chat-status" role="presentation"><i className="adx-live-dot"/>{elapsed} 秒</span>}
    </div>
    <div ref={scrollRef} onScroll={() => {const el=scrollRef.current; if(el) {stickRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<64;if(stickRef.current)setNewMessages(false);}}} className="chat-transcript adx-transcript">
      {!messages.length && <div className="adx-welcome">
        <Welcome variant="borderless"
          icon={<span className="adx-orb" aria-hidden="true"><ChatBubbleIcon/></span>}
          title={doc.nodes.length?'让模型更进一步。':'把想法，变成立体。'}
          description={doc.nodes.length?'描述你想改变的地方，或选择对象精确调整。每次修改都会先预览，由你决定是否应用。':'告诉我用途、尺寸和你在意的细节，也可以上传参考附件，一起完成你的第一个模型。'}/>
        <Prompts className="adx-starters" aria-label="从这里开始" vertical
          title={<span className="adx-starters-label">从这里开始</span>}
          classNames={{item:'adx-starter'}}
          items={[
            {key:'workbench',label:<><strong>创建一个有明确尺寸的工作台</strong><span aria-hidden="true">↗</span></>},
            ...(!doc.nodes.length?[{key:'scene',label:<><strong>组合一个场景</strong><span aria-hidden="true">↗</span></>}]:[]),
            ...(onAssets?[{key:'assets',label:<><strong>从资产库开始</strong><span aria-hidden="true">↗</span></>}]:[]),
          ]}
          onItemClick={({data})=>{
            if(data.key==='workbench')setInput('创建一个长 1.2 米、宽 0.8 米、高 0.75 米的工作台');
            else if(data.key==='scene')setInput('创建一个小型仓储场景，包含货架、周转箱和一条清晰通道；先给出布局和尺寸假设，再生成可编辑模型');
            else if(data.key==='assets')onAssets?.();
          }}/>
        <p className="adx-welcome-note">参考图用于近似重建，背面与真实尺寸需要补充说明。</p>
      </div>}
      {(!aiConfig || aiConfig.useMock || !aiConfig.apiKey)&&<div className="adx-connect" role="note"><div><strong>连接模型，开始创作</strong><small>手动编辑、保存与导出始终可用</small></div><Button type="primary" onClick={onConfigure}>连接模型 ↗</Button></div>}
      {messages.filter(m=>!m.queuedTask).map(m=><div key={m.id} className="adx-turn">
        <Bubble
          className={`adx-bubble ${m.role==='user'?'is-user':'is-assistant'} ${m.error?'is-error':''}`}
          placement={m.role==='user'?'end':'start'}
          variant={m.role==='user'?'filled':'outlined'}
          avatar={canvasMode?<span className={`adx-avatar ${m.role}`} aria-hidden="true">{m.role==='user'?<PersonIcon/>:<ChatBubbleIcon/>}</span>:undefined}
          header={<span className="adx-bubble-meta">{m.role==='user'?'你':'Scenivo'} · {new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>}
          content={bubbleContent(m)}
          footer={messageFooter(m)}
          footerPlacement={m.role==='user'?'outer-end':'outer-start'}
        />
        {m.run&&<RunTrace run={m.run} activity={busy&&m.id===runMessageId.current?agentActivity:undefined}/>}
        {!canvasMode&&previewing&&m.batch?.requestId===pendingBatch?.requestId&&previewCard}
      </div>)}
      {(aiStatus==='error' || aiStatus==='cancelled') && <div className="adx-chat-alert" role="status"><span>{aiStatus==='error'?'本次未完成，原场景未修改':'已停止生成'}</span>{lastRequest && <button type="button" className="adx-link" onClick={restore}>恢复指令重试</button>}{aiError && <details><summary>错误详情</summary><p className="adx-selectable">{aiError}</p></details>}</div>}
      {!canvasMode&&previewing&&!messages.some(m=>m.batch?.requestId===pendingBatch?.requestId)&&previewCard}
    </div>
    {canvasMode&&expanded&&previewCard}
    <SiteAccessRecovery error={aiError}/>
    {newMessages && <button type="button" className="adx-scroll-latest" onClick={()=>{stickRef.current=true;setNewMessages(false);if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;}}>查看最新消息 ↓</button>}
    {notice && <div role="status" className="adx-notice">{notice}</div>}
    {busy && agentActivity && (agentActivity.inputTokens+agentActivity.outputTokens>=100000 || elapsed>=300) && <p role="status" className="adx-notice">任务耗时较长，详情见任务记录。可随时停止并保留已生成草稿。</p>}
    {canvasMode&&!expanded&&previewing&&<div className="adx-compact-strip"><span>修改结果待确认</span><Button size="small" onClick={onExpand}>查看详情</Button><Button size="small" type="primary" disabled={compareBefore} onClick={commit}>应用修改</Button><Button size="small" onClick={discard}>放弃修改</Button></div>}
    {canvasMode&&!expanded&&busy&&<div className="adx-compact-strip"><span>正在处理 · {{idle:'就绪',capturing:'检查画面',context:'准备上下文',generating:'生成中',validating:'校验修改',applying:'应用修改',previewing:'待确认',error:'失败',cancelled:'已停止'}[aiStatus]}</span><Button size="small" onClick={onExpand}>查看过程</Button></div>}
    <div className="adx-composer">
      {!!pendingMessages.length&&<section className="adx-queue" role="region" aria-label="排队消息"><div className="adx-queue-head">{pendingMessages.length} 条待处理消息</div><div className="adx-queue-list">{pendingMessages.map(m=><div className="adx-queue-row" key={m.id}><span className="adx-queue-text" title={m.text}>{m.text}{m.images?.length?` · ${m.images.length}张图`:''}</span>{busy?<Button type="text" size="small" disabled={!canSteer} onClick={()=>promoteQueued(m.id,'guide')} title="将这条消息交给当前任务调整方向">引导</Button>:<Button type="text" size="small" onClick={()=>prepareQueued(m.id)}>准备发送</Button>}<Button type="text" size="small" aria-label={`移出队列 ${m.text}`} title="移出队列" onClick={()=>removeQueued(m.id)}><TrashIcon/></Button><QueueRowMenu text={m.text} busy={busy} canSteer={canSteer} onQuestion={()=>promoteQueued(m.id,'question')} onEdit={()=>prepareQueued(m.id)} onRemove={()=>removeQueued(m.id)}/></div>)}</div></section>}
      {removedQueueId&&<div className="adx-queue-undo">已移出队列 <button type="button" className="adx-link" onClick={restoreQueued}>撤销移除</button></div>}
      <input ref={fileRef} type="file" multiple className="hidden" onChange={e=>{void addImages(Array.from(e.target.files??[]));e.target.value='';}}/>
      <Sender
        ref={senderRef}
        className="adx-sender"
        value={input}
        onChange={value=>setInput(value)}
        onPasteFile={(files)=>void addImages(Array.from(files))}
        onKeyDown={(event)=>{
          // Sender only submits through its own SendButton, which this panel replaces. Handle Enter here and
          // stop the built-in submit so queuing while a run is active keeps working.
          if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey)return;
          if((event.nativeEvent as KeyboardEvent).isComposing||event.keyCode===229)return;
          event.preventDefault();void send(busy?'later':'guide');return false;
        }}
        readOnly={imageBusy}
        placeholder={busy ? canSteer?'输入后发送到上方队列，可选择引导当前任务…':'正在准备，可先输入补充要求…' : previewing?'继续描述调整要求，将修改当前预览…': '描述结构、尺寸与需要修改的细节…'}
        components={{input: ComposerInput as ComponentType<ComposerInputProps>}}
        header={attachments.length?<div className="adx-attachments">{attachments.map((src,i)=><div key={i} className="adx-attachment">{isReferenceImage(src)?<button type="button" onClick={()=>setImageView(src)}><img src={src} alt={`待发送参考图 ${i+1}`}/></button>:<FileCard type="file" aria-label={attachmentInfo(src).name} name={attachmentInfo(src).name} byte={attachmentInfo(src).size} size="small" description="仅提供文件信息，尚未解析内容"/>}<button type="button" aria-label={`移除参考附件 ${i+1}`} className="adx-attachment-remove" onClick={()=>setAttachments(prev=>prev.filter((_,j)=>i!==j))}>×</button></div>)}</div>:undefined}
        prefix={<><Button ref={attachRef} type="text" aria-label="添加与参考附件选项" title="添加参考附件与附件选项" className="composer-icon adx-attach-trigger" aria-haspopup="menu" aria-expanded={attachOpen} onClick={()=>setAttachOpen(open=>!open)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '||event.key==='ArrowDown'){event.preventDefault();setAttachOpen(true);}}}><PlusIcon/>{attachments.length>0&&<span className="attachment-count">{attachments.length}</span>}</Button><PopoverPanel anchor={attachRef} open={attachOpen} onClose={()=>setAttachOpen(false)} label="参考附件选项"><div className="composer-action-menu" role="menu" aria-label="参考附件选项"><button type="button" role="menuitem" className="composer-action-item" disabled={imageBusy} onClick={()=>{setAttachOpen(false);fileRef.current?.click();}}><ImageIcon/>{imageBusy?'正在处理参考附件':'添加参考附件'}</button>{!attachments.length&&messages.some(m=>m.images?.length)&&<><div className="composer-action-divider" role="separator"/><button type="button" role="menuitemcheckbox" aria-checked={reuseReference} aria-label="沿用最近参考附件" className="composer-action-item" onClick={()=>setReuseReference(value=>!value)}><span className="composer-action-check" aria-hidden="true">{reuseReference&&<CheckIcon/>}</span>沿用最近参考附件</button></>}<p className="composer-action-note">每个附件100MB以内</p></div></PopoverPanel></>}
        suffix={<span className="adx-send-cluster">
          {busy&&(!!input.trim()||!!attachments.length)&&<Button shape="circle" title="停止当前任务，保留输入和已生成草稿" aria-label="停止生成" onClick={cancel} icon={<StopIcon/>}/>}
          <Button type="primary" shape="circle" className={busy?'is-running':''}
            key={busy&&!input.trim()&&!attachments.length?'stop-current':'send-message'}
            title={busy&&!input.trim()&&!attachments.length?'停止当前任务，保留已生成草稿':busy?'加入上方消息队列，可引导或移除':'发送（Enter发送，Shift+Enter换行）'}
            aria-label={busy&&!input.trim()&&!attachments.length?'停止生成':busy?'加入消息队列':'发送'}
            disabled={imageBusy||(!busy&&!input.trim()&&!attachments.length)}
            onClick={()=>busy&&!input.trim()&&!attachments.length?cancel():void send(busy?'later':'guide')}
            icon={busy&&!input.trim()&&!attachments.length?<StopIcon/>:SendIcon}/>
        </span>}
        footer={<>
          {doc.nodes.length>0&&<details className="adx-scope" open={!canvasMode}><summary hidden={!canvasMode}>修改范围：{scopeMode==='selection'?'仅选中对象':'全场景'}</summary><fieldset disabled={busy} className="adx-scope-body"><div className="adx-scope-row"><label htmlFor="adx-scope-select">修改范围</label><Select id="adx-scope-select" aria-label="对话修改范围" value={scopeMode} disabled={busy} onChange={setScopeMode} options={[{value:"scene",label:"全场景"},{value:"selection",label:`仅选中对象（${selection.length}）`}]}/></div><p>{scopeMode==='selection'?(selection.length?`仅允许修改选中的 ${selection.length} 个零件；其他对象受保护。`:'请先在对象列表中选择对象，再发送指令。'):'可以修改全场景；选中对象仅用于指代，仍遵守指令中的局部限制。'}</p><details><summary>更多修改选项</summary><Checkbox className="adx-lock" disabled={busy} checked={lockPlacement} onChange={e=>setLockPlacement(e.target.checked)}>锁定已有对象的位置与朝向</Checkbox></details></fieldset></details>}
          <div className="adx-composer-tools"><QualityPicker onConfigure={onConfigure}/><span className="adx-tool-divider"/><ModelPicker onConfigure={onConfigure}/><span className="adx-tool-spacer"/><span className="adx-composer-hint">{busy?(canSteer?'Enter 加入队列':'Enter 补充要求'):'Enter 发送 · Shift+Enter 换行'}</span></div>
        </>}
      />
    </div>
    <Modal open={!!imageView} title="参考图预览" onCancel={()=>setImageView(null)} footer={null} width={900} destroyOnHidden><img src={imageView??undefined} alt="参考图大图" style={{display:"block",maxWidth:"100%",maxHeight:"75vh",margin:"auto",objectFit:"contain"}}/></Modal>
  </div>;
}
