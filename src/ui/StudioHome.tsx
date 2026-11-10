import {ProCard} from '@ant-design/pro-components';
import {prepareReference,MAX_ATTACHMENT_BYTES} from '../domain/referenceAttachments';
import {OperationProgress,nextProgressPaint} from './OperationProgress';
import {HomeTasks} from './HomeTasks';
import {Button,Dropdown,Input,Modal,Segmented} from 'antd';
import {Attachments,Sender} from '@ant-design/x';
import {ReferenceAttachments} from './chat/ReferenceAttachments';
import {useSenderLabel} from './chat/useSenderLabel';
import {useEffect,useRef,useState,type ComponentRef} from 'react';
import {CubeIcon,LayersIcon,ArrowRightIcon,DotsHorizontalIcon} from '@radix-ui/react-icons';
import {PaperClipOutlined} from '@ant-design/icons';
import {createSession,renameSession,switchSession,useWorkspaceStore,type WorkspaceSession} from '../workspace';
import {useEditorStore} from '../store';
import {listModelAssets} from '../domain/modelAssetStorage';
import type {ModelAssetSummary} from '../domain/modelAssets';
import {compressImage} from './ChatPanel';
import {ModelPicker} from './ModelPicker';
import {GenerationMethodPicker} from './GenerationMethodPicker';
import {assertLibraryReady,projectLabel} from '../domain/libraryNavigation';
import {ProjectThumb} from './ProjectLibrary';
import {StudioPage} from './studio/StudioPage';
import {StudioEmptyState} from './studio/StudioEmptyState';

function ideaTitle(text:string,kind:'asset'|'scene'){
 const subject=text.trim().split(/[\n，。；,;]/)[0].replace(/^(?:(?:请|帮我|给我|为我)\s*)*(?:生成|创建|制作|设计|建模|做)(?:一下)?\s*(?:一个|一台|一座|一套|一组|个)?\s*/,'').trim();
 return subject.slice(0,36)||(kind==='asset'?'未命名模型':'未命名场景');
}
function artworkTitle(project:WorkspaceSession){
 if(project.title==='新建会话'){
  const doc=project.snapshot.pendingResult?.doc??project.snapshot.doc;
  return doc.nodes.find(node=>!node.parentId&&node.name)?.name||(project.moduleKind==='asset'?'未命名模型':'未命名场景');
 }
 return project.autoTitle?ideaTitle(project.title,project.moduleKind??'scene'):project.title;
}
export function StudioHome({onOpen,onGenerate,onConfigure,onTasks,onImport,hidden=false}:{onOpen:()=>void;onGenerate?:(projectId:string,blenderModeling:boolean)=>void;onConfigure?:()=>void;onTasks?:()=>void;onImport?:()=>void;hidden?:boolean}){
 const sessions=useWorkspaceStore(s=>s.sessions);
 const config=useEditorStore(s=>s.aiConfig);
 const configured=!!config&&!config.useMock&&!!config.baseURL.trim()&&!!config.apiKey.trim()&&!!config.model.trim();
 const ready=useWorkspaceStore(s=>s.ready),workspaceError=useWorkspaceStore(s=>s.error);
 const [kind,setKind]=useState<'asset'|'scene'>('asset'),[draft,setDraft]=useState(''),[images,setImages]=useState<string[]>([]),[imageBusy,setImageBusy]=useState(false);
 const [attachmentProgress,setAttachmentProgress]=useState({completed:0,total:0,name:''});
 const [blenderModeling,setBlenderModeling]=useState(false);
 const [items,setItems]=useState<ModelAssetSummary[]>([]),[itemsReady,setItemsReady]=useState(false),[error,setError]=useState(''),[libraryError,setLibraryError]=useState('');
 const [renaming,setRenaming]=useState<WorkspaceSession|null>(null),[name,setName]=useState('');
 const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|'asset'|'scene'>('all');
 const creating=useRef(false),imageBusyRef=useRef(false),attachmentsRef=useRef<ComponentRef<typeof Attachments>>(null),draftRef=useRef<ComponentRef<typeof Sender>>(null);
 useSenderLabel(draftRef,'新项目描述');
 const locked=!ready||!!workspaceError;
 useEffect(()=>{if(hidden)return;let alive=true;listModelAssets().then(a=>{if(alive){setItems(a);setItemsReady(true);setLibraryError('');}}).catch(()=>{if(alive){setItemsReady(true);setLibraryError('资产预览读取失败，项目仍可打开。请稍后重试。');}});return()=>{alive=false;};},[hidden]);
 const projects=sessions.filter(s=>!s.deletedAt&&(s.moduleKind||s.snapshot.doc.nodes.length||s.snapshot.messages.length)).sort((a,b)=>b.updatedAt-a.updatedAt);
 const matching=projects.filter(s=>(filter==='all'||(s.moduleKind??'scene')===filter)&&(s.title+' '+artworkTitle(s)).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const recent=matching.slice(0,12);
 function startBlankProject(){
  if(creating.current)return;
  creating.current=true;
  try{
   assertLibraryReady();
   if(!createSession(undefined,{moduleKind:kind,title:kind==='asset'?'未命名资产':'未命名场景',...(kind==='asset'?{assetCategory:'其他' as const}:{})})){assertLibraryReady();throw Error('当前无法新建，请重试');}
   setError('');onOpen();
  }catch(e){setError(e instanceof Error?e.message:'新建失败');creating.current=false;}
 }
 function startProject(){
  if(creating.current)return;
  creating.current=true;
  try{
   assertLibraryReady();
   if(imageBusyRef.current)throw Error('附件正在处理，请稍候');
   if(!draft.trim()&&!images.length)throw Error('请输入需求或添加参考附件');
   const config=useEditorStore.getState().aiConfig;
   if(!config||config.useMock||!config.baseURL.trim()||!config.apiKey.trim()||!config.model.trim()){onConfigure?.();throw Error('请先连接并选择模型，输入内容已保留');}
   if(config.agentMode!=='single'&&config.stream===false)throw Error('请在连接设置中开启流式输出，或选择单次生成模式');
   if(blenderModeling&&config.agentMode==='single')throw Error('Blender Python 建模需要 Agent 模式，请在模型配置中切换；输入已保留');
   const title=draft.trim()?ideaTitle(draft,kind):(kind==='asset'?'参考附件资产':'参考附件场景');
   if(!createSession(undefined,{moduleKind:kind,title, ...(kind==='asset'?{assetCategory:'其他' as const}:{})})){assertLibraryReady();throw Error('当前无法新建，请重试');}
   // An explicit home submit authorizes one generation in a new project. Images stay in that project.
   useEditorStore.getState().setComposerText(draft);useEditorStore.getState().setComposerImages([...images]);
   const projectId=useEditorStore.getState().doc.projectId;
   setDraft('');setImages([]);setError('');onOpen();onGenerate?.(projectId,blenderModeling);
  }catch(e){setError(e instanceof Error?e.message:'新建失败');creating.current=false;}
 }
 async function addImages(files:File[]){if(imageBusyRef.current||!files.length)return;imageBusyRef.current=true;setImageBusy(true);setAttachmentProgress({completed:0,total:files.length,name:files[0].name});setError('');const prepared:string[]=[];try{for(const [index,file] of files.entries()){setAttachmentProgress({completed:index,total:files.length,name:file.name});await nextProgressPaint();if(file.size>MAX_ATTACHMENT_BYTES){setError('单个附件不能超过100MB');continue;}try{prepared.push(await prepareReference(file,compressImage));}catch{setError('附件处理失败，请重新选择');}}setImages(old=>[...old,...prepared]);}catch{setError('附件处理失败，请重新选择');}finally{imageBusyRef.current=false;setImageBusy(false)}}
 // A new visit can start another project; repeated submit events within the current visit cannot.
 useEffect(()=>{if(!hidden)creating.current=false;},[hidden]);
 const openRecent=(id:string)=>{if(switchSession(id))onOpen();else setError('项目暂时无法打开，请检查工作区保存状态');};
 const createMenu=[{key:'blank',label:`新建空白${kind==='asset'?'资产':'场景'}`,onClick:startBlankProject},{key:'import',label:'导入 GLB 为新资产',disabled:!onImport,onClick:onImport}];
 return <StudioPage className="pro-home-page project-dashboard ai-start-home" hidden={hidden}>
  <section className="home-idea-stage" aria-label="创建新项目">
   <header className="home-idea-heading"><span className="home-idea-eyebrow">SCENIVO · AI 三维创作</span></header>
   <div className="home-idea-composer">
    <div className="home-idea-modes"><Segmented aria-label="新项目类型" disabled={locked} value={kind} onChange={value=>setKind(value as 'asset'|'scene')} options={[{value:'asset',label:'单个模型',icon:<CubeIcon/>},{value:'scene',label:'完整场景',icon:<LayersIcon/>}]}/></div>
    <form className="pro-home-form" aria-label="创建项目" onSubmit={event=>{event.preventDefault();startProject();}}>
     <Sender ref={draftRef} className="home-x-sender pro-home-sender" value={draft} onChange={setDraft} onPasteFile={files=>void addImages(Array.from(files))} onSubmit={startProject} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return false;}} submitType="enter" disabled={locked} readOnly={imageBusy} suffix={false} autoSize={{minRows:3,maxRows:8}} placeholder={kind==='asset'?'描述你想创建的模型，例如：一台带升降机构的仓储 AGV…':'描述你想创建的空间，例如：一个有两排货架和中央通道的仓库…'}
      header={<Sender.Header title={`参考附件 · ${images.length}`} open={images.length>0} forceRender closable={false}><ReferenceAttachments ref={attachmentsRef} values={images} disabled={locked||imageBusy} onAdd={files=>void addImages(files)} onRemove={index=>setImages(old=>old.filter((_,i)=>i!==index))}/></Sender.Header>}
      footer={(_, {components:{SendButton}})=><div className="pro-home-composer-actions home-composer-toolbar"><Button aria-label={imageBusy?'正在处理参考附件':'添加参考附件'} title="添加参考附件（单文件100MB以内）" type="text" disabled={locked||imageBusy} onClick={()=>attachmentsRef.current?.select({multiple:true})} icon={<PaperClipOutlined/>}/><GenerationMethodPicker forNewProject onConfigure={onConfigure} blenderModeling={blenderModeling} onBlenderModelingChange={setBlenderModeling}/><ModelPicker forNewProject onConfigure={onConfigure}/><span className="pro-spacer"/><SendButton shape="default" icon={<ArrowRightIcon/>} aria-label="开始生成" disabled={locked||imageBusy||(!draft.trim()&&!images.length)}>开始生成</SendButton></div>}/>
    </form>
   {imageBusy&&<OperationProgress title="处理参考附件" stage="读取并准备附件" completed={attachmentProgress.completed} total={attachmentProgress.total} detail={attachmentProgress.name}/>}
   </div>
   <div className="home-idea-footnote">{!configured?<span><Button type="link" disabled={locked} onClick={onConfigure}>连接模型</Button>后即可生成，输入和附件会保留。</span>:<span>{blenderModeling?'Blender 模型会在工作台预览，应用后可编辑。':'每次生成独立项目，预览确认后再应用。'}</span>}<Dropdown trigger={['click']} menu={{items:createMenu}}><Button type="text" disabled={locked} aria-label="新建项目">空白项目 / 导入为新资产 <ArrowRightIcon/></Button></Dropdown>{kind==='scene'&&<span>导入 GLB 始终新建资产，可在资产库中用它新建场景。</span>}</div>
   {error&&<p className="resource-error" role="alert">{error}</p>}
  </section>
  <div className="home-resume-area"><HomeTasks items={items} disabled={locked} hidden={hidden} onOpen={onOpen} onAll={onTasks}/>
   <section className="project-dashboard-library" aria-label="本地项目"><header className="home-recent-heading"><div><h2>最近作品 <span>{projects.length}</span></h2></div>{!!projects.length&&<Input.Search aria-label="搜索项目" placeholder="搜索作品" value={search} onChange={event=>setSearch(event.target.value)} allowClear/>}</header>
    <ProCard className="pro-home-recent project-gallery-panel">
     {!!projects.length&&<div className="pro-home-project-filters"><Segmented aria-label="项目类型筛选" value={filter} onChange={value=>setFilter(value as typeof filter)} options={[{value:'all',label:'全部项目'},{value:'asset',label:'单个模型'},{value:'scene',label:'完整场景'}]}/><span>自动保存在本机 · 最近更新优先</span></div>}
     {libraryError&&<p role="alert" className="resource-error">{libraryError}</p>}
     {recent.length?<div className="project-artwork-grid">{recent.map(project=>{const title=artworkTitle(project);return <article key={project.id} className="project-artwork-card">
      <button type="button" className="project-artwork-open" aria-label={`继续编辑 ${title}`} disabled={locked} onClick={()=>openRecent(project.id)}>
       <div className="project-gallery-preview"><ProjectThumb active={!hidden&&(!project.assetSource||itemsReady)} src={project.sceneThumbnail??items.find(item=>item.id===project.assetSource?.id)?.thumbnail} name={title} kind={project.moduleKind??'scene'} document={project.snapshot.pendingResult?.doc??project.snapshot.doc}/><span className="project-artwork-continue">继续创作 <ArrowRightIcon/></span><span className="project-artwork-kind">{project.moduleKind==='asset'?'模型':'场景'}</span></div>
       <div className="project-artwork-info"><strong title={project.title}>{title}</strong><div className="project-gallery-meta"><span>{projectLabel(project)}</span><time dateTime={new Date(project.updatedAt).toISOString()}>{new Date(project.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div></div>
      </button>
      <Dropdown trigger={['click']} menu={{items:[{key:'rename',label:'重命名',onClick:()=>{setRenaming(project);setName(title);}}]}}><Button type="text" className="project-artwork-menu" aria-label={`作品操作 ${title}`} disabled={locked} icon={<DotsHorizontalIcon/>}/></Dropdown>
     </article>;})}</div>:<StudioEmptyState title={projects.length?'没有找到匹配的项目':'还没有作品？先说说你的想法'} description={projects.length?'试试其他名称，或切换项目类型。':'在上方描述一个模型或场景，你的作品会自动留在这里。'}/>}
    </ProCard>
   </section>
  </div>
  <Modal open={!!renaming} title="重命名作品" okText="保存名称" cancelText="取消" okButtonProps={{disabled:locked||!name.trim()}} onCancel={()=>setRenaming(null)} onOk={()=>{if(renaming&&renameSession(renaming.id,name)){setRenaming(null);setError('');}else setError('名称未保存，请检查工作区状态');}}><Input aria-label="作品名称" maxLength={80} value={name} onChange={event=>setName(event.target.value)} onPressEnter={()=>{if(renaming&&name.trim()&&!locked&&renameSession(renaming.id,name))setRenaming(null);}}/>{renaming&&error&&<p role="alert">{error}</p>}</Modal>
 </StudioPage>;
}
