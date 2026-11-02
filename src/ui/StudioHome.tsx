import {ProCard,ProList} from '@ant-design/pro-components';
import {StudioPageHeader} from './studio/StudioPageHeader';
import {prepareReference,MAX_ATTACHMENT_BYTES} from '../domain/referenceAttachments';
import {HomeTasks} from './HomeTasks';
import {Button,Dropdown,Input,Segmented,Tag} from 'antd';
import {Attachments,Prompts,Sender} from '@ant-design/x';
import {ReferenceAttachments} from './chat/ReferenceAttachments';
import {useSenderLabel} from './chat/useSenderLabel';
import {useEffect,useRef,useState,type ComponentRef} from 'react';
import {CubeIcon,LayersIcon,ArrowRightIcon,PlusIcon,ImageIcon} from '@radix-ui/react-icons';
import {createSession,switchSession,useWorkspaceStore} from '../workspace';
import {useEditorStore} from '../store';
import {listModelAssets} from '../domain/modelAssetStorage';
import type {ModelAssetSummary} from '../domain/modelAssets';
import {compressImage} from './ChatPanel';
import {ModelPicker} from './ModelPicker';
import {QualityPicker} from './QualityPicker';
import {assertLibraryReady,projectLabel} from '../domain/libraryNavigation';
import {ProjectThumb} from './ProjectLibrary';
import {StudioPage} from './studio/StudioPage';
import {StudioEmptyState} from './studio/StudioEmptyState';

export function StudioHome({onOpen,onLibrary,onGenerate,onConfigure,onTasks,onImport,hidden=false}:{onOpen:()=>void;onLibrary:(kind:'asset'|'scene')=>void;onGenerate?:(projectId:string)=>void;onConfigure?:()=>void;onTasks?:()=>void;onImport?:()=>void;hidden?:boolean}){
 const sessions=useWorkspaceStore(s=>s.sessions);
 const config=useEditorStore(s=>s.aiConfig);
 const configured=!!config&&!config.useMock&&!!config.baseURL.trim()&&!!config.apiKey.trim()&&!!config.model.trim();
 const ready=useWorkspaceStore(s=>s.ready),workspaceError=useWorkspaceStore(s=>s.error);
 const [kind,setKind]=useState<'asset'|'scene'>('asset'),[draft,setDraft]=useState(''),[images,setImages]=useState<string[]>([]),[imageBusy,setImageBusy]=useState(false);
 const [items,setItems]=useState<ModelAssetSummary[]>([]),[error,setError]=useState(''),[libraryError,setLibraryError]=useState('');
 const [method,setMethod]=useState<'ai'|'blank'|'import'>('ai');
 const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|'asset'|'scene'>('all');
 const creating=useRef(false),imageBusyRef=useRef(false),attachmentsRef=useRef<ComponentRef<typeof Attachments>>(null),draftRef=useRef<ComponentRef<typeof Sender>>(null);
 useSenderLabel(draftRef,'新项目描述');
 const locked=!ready||!!workspaceError;
 const promptSuggestions=kind==='asset'?[
  {key:'metal-workbench',label:'金属工作台',description:'创建一个长 1.5 米、宽 0.7 米、高 0.8 米的金属工作台，浅灰台面，深灰方管支腿。'},
  {key:'storage-rack',label:'仓储货架',description:'创建一个长 2 米、深 0.6 米、高 2 米的四层仓储货架，蓝色立柱，橙色横梁。'},
 ]:[
  {key:'assembly-station',label:'装配工位',description:'创建一个 8 米 × 6 米的装配区域，包含两张工作台、一个工具柜和物料架，保留中间通道。'},
  {key:'warehouse-layout',label:'仓储布局',description:'创建一个 12 米 × 8 米的仓储场景，包含两排货架和中央通道，物件排列整齐。'},
 ];
 useEffect(()=>{if(hidden)return;let alive=true;listModelAssets().then(a=>{if(alive){setItems(a);setLibraryError('');}}).catch(()=>{if(alive)setLibraryError('资产预览读取失败，项目仍可打开。请稍后重试。');});return()=>{alive=false;};},[hidden]);
 const projects=sessions.filter(s=>!s.deletedAt&&(s.moduleKind||s.snapshot.doc.nodes.length||s.snapshot.messages.length)).sort((a,b)=>b.updatedAt-a.updatedAt);
 const matching=projects.filter(s=>(filter==='all'||(s.moduleKind??'scene')===filter)&&s.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const recent=matching.slice(0,12);
 function startBlankProject(){
  if(creating.current)return;
  creating.current=true;
  try{
   assertLibraryReady();
   if(!createSession(undefined,{moduleKind:kind,title:kind==='asset'?'未命名资产':'未命名场景',...(kind==='asset'?{assetCategory:'其他' as const}:{})}))throw Error('当前无法新建，请关闭其他标签页后刷新本页');
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
   const title=draft.trim().split('\n')[0].slice(0,36)||(kind==='asset'?'参考附件资产':'参考附件场景');
   if(!createSession(undefined,{moduleKind:kind,title, ...(kind==='asset'?{assetCategory:'其他' as const}:{})}))throw Error('当前无法新建，请关闭其他标签页后刷新本页');
   // An explicit home submit authorizes one generation in a new project. Images stay in that project.
   useEditorStore.getState().setComposerText(draft);useEditorStore.getState().setComposerImages([...images]);
   const projectId=useEditorStore.getState().doc.projectId;
   setDraft('');setImages([]);setError('');onOpen();onGenerate?.(projectId);
  }catch(e){setError(e instanceof Error?e.message:'新建失败');creating.current=false;}
 }
 async function addImages(files:File[]){if(imageBusyRef.current)return;imageBusyRef.current=true;setImageBusy(true);setError('');const prepared:string[]=[];try{for(const file of files){if(file.size>MAX_ATTACHMENT_BYTES){setError('单个附件不能超过100MB');continue;}try{prepared.push(await prepareReference(file,compressImage));}catch{setError('附件处理失败，请重新选择');}}setImages(old=>[...old,...prepared]);}catch{setError('附件处理失败，请重新选择');}finally{imageBusyRef.current=false;setImageBusy(false)}}
 // A new visit can start another project; repeated submit events within the current visit cannot.
 useEffect(()=>{if(!hidden)creating.current=false;},[hidden]);
 const openRecent=(id:string)=>{if(switchSession(id))onOpen();else setError('项目暂时无法打开，请检查工作区保存状态');};
 const activeTasks=sessions.filter(session=>!session.deletedAt&&(session.snapshot.wasRunning||session.snapshot.pendingBatch)).length;
 const createMenu=[{key:'describe',label:'描述生成',onClick:()=>{setMethod('ai');draftRef.current?.focus();}},{key:'import',label:'导入 GLB',disabled:!onImport,onClick:onImport},{key:'blank',label:`新建空白${kind==='asset'?'资产':'场景'}`,onClick:startBlankProject}];
 return <StudioPage className="pro-home-page project-dashboard" hidden={hidden}>
  <StudioPageHeader title="项目工作台" description="管理本地项目，继续创作，或开始一个新的想法。" actions={<Dropdown trigger={['click']} menu={{items:createMenu}}><Button type="primary" aria-label="新建项目" disabled={locked} icon={<PlusIcon/>}>新建项目</Button></Dropdown>}/>
  <div className="project-dashboard-context"><span><i/>本地工作空间</span><span>{projects.length} 个项目</span><span>{items.length} 个可复用资产</span>{activeTasks>0&&<Tag color="processing">{activeTasks} 个任务进行中 / 待确认</Tag>}</div>
  <div className="project-dashboard-grid"><section className="project-dashboard-library" aria-label="本地项目">  <ProCard title={<h2>最近项目</h2>} extra={<div className="pro-inline-actions"><Button type="link" disabled={locked} aria-label="查看全部资产" onClick={()=>onLibrary('asset')}>资产库</Button><Button type="link" disabled={locked} aria-label="查看全部场景" onClick={()=>onLibrary('scene')}>场景库</Button></div>} className="pro-home-recent project-gallery-panel">
   {!!projects.length&&<div className="pro-home-project-filters"><Segmented aria-label="项目类型筛选" value={filter} onChange={value=>setFilter(value as typeof filter)} options={[{value:'all',label:'全部项目'},{value:'asset',label:'资产'},{value:'scene',label:'场景'}]}/><Input.Search aria-label="搜索项目" placeholder="搜索项目名称" value={search} onChange={event=>setSearch(event.target.value)} allowClear/></div>}
   {libraryError&&<p role="alert" className="resource-error">{libraryError}</p>}
   {recent.length?<ProList rowKey="id" dataSource={recent} search={false} options={false} toolBarRender={false} pagination={false} cardProps={false} grid={{gutter:16,xs:1,sm:2,xxl:3}} columns={[
    {dataIndex:'title',listSlot:'title',render:(_,project)=><strong>{project.title}</strong>},
    {listSlot:'content',render:(_,project)=><div className="project-gallery-content"><div className="project-gallery-preview"><ProjectThumb src={project.sceneThumbnail??items.find(item=>item.id===project.assetSource?.id)?.thumbnail} name={project.title} kind={project.moduleKind??'scene'} document={project.snapshot.pendingResult?.doc??project.snapshot.doc}/></div><div className="project-gallery-meta"><Tag>{project.moduleKind==='asset'?'资产':'场景'}</Tag><span>{projectLabel(project)}</span><span>{(project.snapshot.pendingResult?.doc??project.snapshot.doc).nodes.length} 个对象</span></div><p>{new Date(project.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})} 更新</p></div>},
    {listSlot:'actions',render:(_,project)=><Button type="link" aria-label={`继续编辑 ${project.title}`} disabled={locked} onClick={()=>openRecent(project.id)}>打开项目<ArrowRightIcon/></Button>}
   ]}/>:<StudioEmptyState title={projects.length?'没有找到匹配的项目':'你的创作，从这里开始'} description={projects.length?'试试其他名称，或切换项目类型。':'描述想法交给 AI，或先创建一个空白项目。'}/>}
  </ProCard>
</section><aside className="project-create-column" aria-label="创建新项目">   <ProCard className="pro-home-create" title="开始新项目" extra={!configured&&<Button type="primary" size="small" disabled={locked} onClick={onConfigure}>连接模型</Button>}>
    <Segmented block aria-label="创建方式" value={method} onChange={value=>setMethod(value as typeof method)} options={[{value:"ai",label:"AI 生成"},{value:"blank",label:"空白项目"},{value:"import",label:"导入 GLB"}]}/><div className="project-kind-field" hidden={method==='import'}><span>项目类型</span><Segmented aria-label="新项目类型" value={kind} onChange={value=>setKind(value as 'asset'|'scene')} options={[{value:'asset',label:'资产',icon:<CubeIcon/>},{value:'scene',label:'场景',icon:<LayersIcon/>}]}/></div>
    <p className="pro-home-type-hint">{kind==='asset'?'单个可复用模型，可在场景中组合使用。':'组合多个模型，创建可编辑的空间布局。'}</p>
    <form hidden={method!=="ai"} className="pro-home-form" aria-label="创建项目" onSubmit={event=>{event.preventDefault();startProject();}}>
     <Sender ref={draftRef} className="home-x-sender pro-home-sender" value={draft} onChange={setDraft} onPasteFile={files=>void addImages(Array.from(files))} onSubmit={startProject} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return false;}} submitType="enter" disabled={locked} readOnly={imageBusy} suffix={false} autoSize={{minRows:3,maxRows:8}} placeholder={kind==='asset'?'描述模型的外形、尺寸、材质与细节…':'描述场景的空间、物件，以及它们之间的关系…'}
      header={<Sender.Header title={`参考附件 · ${images.length}`} open={images.length>0} forceRender closable={false}><ReferenceAttachments ref={attachmentsRef} values={images} disabled={locked||imageBusy} onAdd={files=>void addImages(files)} onRemove={index=>setImages(old=>old.filter((_,i)=>i!==index))}/></Sender.Header>}
      footer={(_, {components:{SendButton}})=><div className="pro-home-composer-actions"><Button aria-label={imageBusy?'正在处理参考附件':'添加参考附件'} title="添加参考附件（单文件100MB以内）" type="text" disabled={locked||imageBusy} onClick={()=>attachmentsRef.current?.select({multiple:true})} icon={<ImageIcon/>}/><span className="pro-spacer"/><SendButton aria-label="开始生成" title="开始生成" disabled={locked||imageBusy||(!draft.trim()&&!images.length)}/></div>}/>
     <div className="project-generation-options"><QualityPicker forNewProject onConfigure={onConfigure}/><ModelPicker forNewProject onConfigure={onConfigure}/></div>
    </form>
    <div hidden={method!=="ai"}><Prompts className="pro-home-prompts" role="group" aria-label="需求参考" wrap items={promptSuggestions.map(item=>({...item,description:undefined,disabled:locked}))} onItemClick={({data})=>{const selected=promptSuggestions.find(item=>item.key===data.key);if(!locked&&selected){setDraft(selected.description);draftRef.current?.focus();}}}/>
    </div>{method==='blank'&&<div className="project-create-method"><CubeIcon/><h3>从空白项目开始</h3><p>进入工作台后，可组合本地资产，也可以继续向 AI 描述需求。</p><Button block type="primary" disabled={locked} onClick={startBlankProject}>创建空白{kind==='asset'?'资产':'场景'}</Button></div>}{method==='import'&&<div className="project-create-method"><ImageIcon/><h3>继续编辑已有模型</h3><p>导入 GLB 后创建独立项目，保留网格与材质。</p><Button block type="primary" disabled={locked||!onImport} onClick={onImport}>选择 GLB 文件</Button></div>}{!configured&&method==='ai'&&<p className="pro-home-connect-note">连接模型后即可生成，输入的需求和附件会保留。</p>}
    {(error||workspaceError)&&<p className="resource-error" role="alert">{error||'工作区保存异常，请关闭其他标签页后刷新本页'}</p>}
   </ProCard>
<HomeTasks items={items} disabled={locked} hidden={hidden} onOpen={onOpen} onAll={onTasks}/><p className="pro-home-local-note">项目自动保存在本机。登录后可手动发布到团队资源。</p></aside></div></StudioPage>;
}
