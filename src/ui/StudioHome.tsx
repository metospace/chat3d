import {prepareReference,isReferenceImage,attachmentInfo,MAX_ATTACHMENT_BYTES} from '../domain/referenceAttachments';
import {HomeTasks} from './HomeTasks';
import {Button,Card,Input,Modal,Tag} from 'antd';
import {Prompts,Sender,Welcome} from '@ant-design/x';
import {HomeSenderInput} from './chat/HomeSenderInput';
import {useEffect,useRef,useState,type ComponentRef,type ComponentType} from 'react';
import {CubeIcon,LayersIcon,ArrowRightIcon,PlusIcon,ArrowUpIcon,Cross1Icon,ImageIcon,MagnifyingGlassIcon,MixerHorizontalIcon} from '@radix-ui/react-icons';
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
import {StudioSectionHeader} from './studio/StudioSectionHeader';
import {StudioEmptyState} from './studio/StudioEmptyState';

export function StudioHome({onOpen,onLibrary,onGenerate,onConfigure,onTasks,hidden=false}:{onOpen:()=>void;onLibrary:(kind:'asset'|'scene')=>void;onGenerate?:(projectId:string)=>void;onConfigure?:()=>void;onTasks?:()=>void;hidden?:boolean}){
 const sessions=useWorkspaceStore(s=>s.sessions);
 const config=useEditorStore(s=>s.aiConfig);
 const configured=!!config&&!config.useMock&&!!config.baseURL.trim()&&!!config.apiKey.trim()&&!!config.model.trim();
 const ready=useWorkspaceStore(s=>s.ready),workspaceError=useWorkspaceStore(s=>s.error);
 const [kind,setKind]=useState<'asset'|'scene'>('asset'),[draft,setDraft]=useState(''),[images,setImages]=useState<string[]>([]),[preview,setPreview]=useState<string|null>(null),[imageBusy,setImageBusy]=useState(false);
 const [items,setItems]=useState<ModelAssetSummary[]>([]),[error,setError]=useState('');
 const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|'asset'|'scene'>('all');
 const creating=useRef(false),imageBusyRef=useRef(false),fileRef=useRef<HTMLInputElement>(null),draftRef=useRef<ComponentRef<typeof Sender>>(null);
 const locked=!ready||!!workspaceError;
 const promptSuggestions=kind==='asset'?[
  {key:'metal-workbench',label:'金属工作台',description:'创建一个长 1.5 米、宽 0.7 米、高 0.8 米的金属工作台，浅灰台面，深灰方管支腿。'},
  {key:'storage-rack',label:'仓储货架',description:'创建一个长 2 米、深 0.6 米、高 2 米的四层仓储货架，蓝色立柱，橙色横梁。'},
 ]:[
  {key:'assembly-station',label:'装配工位',description:'创建一个 8 米 × 6 米的装配区域，包含两张工作台、一个工具柜和物料架，保留中间通道。'},
  {key:'warehouse-layout',label:'仓储布局',description:'创建一个 12 米 × 8 米的仓储场景，包含两排货架和中央通道，物件排列整齐。'},
 ];
 useEffect(()=>{if(hidden)return;let alive=true;listModelAssets().then(a=>{if(alive)setItems(a);}).catch(()=>{if(alive)setItems([]);});return()=>{alive=false;};},[hidden]);
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
 return <StudioPage className="home-page home-command-center" hidden={hidden}>
  <header className="home-hero">
   <div><span className="home-workspace-eyebrow">SCENIVO / 创作空间</span><h1 id="home-title">把想法，变成三维作品。</h1><p className="home-hero-lead">描述你的构想，让 AI 完成第一步。每个细节，仍由你掌控。</p></div>
   <Button className="home-new-project" aria-label="新建空白项目" disabled={locked} onClick={startBlankProject}><PlusIcon/>新建空白{kind==='asset'?'资产':'场景'}</Button>
  </header>
  <div className="home-start-grid">
  <section className="home-creation" aria-labelledby="home-create-title">
   <div className="home-creation-copy">
    <Welcome className="home-x-welcome" variant="borderless" title={<span id="home-create-title">用 AI 开始创作</span>} styles={{title:{fontSize:18,fontWeight:600,margin:0}}} description="先选择类型，再描述你想创建的内容。"/>

    <div className="home-kind-switch" role="group" aria-label="新项目类型"><button type="button" aria-pressed={kind==='asset'} onClick={()=>setKind('asset')}><CubeIcon/>资产</button><button type="button" aria-pressed={kind==='scene'} onClick={()=>setKind('scene')}><LayersIcon/>场景</button></div>
    <p className="home-kind-description">{kind==='asset'?'单个可复用的三维模型，可在场景中组合使用。':'由多个模型组成的空间布局，可继续编辑物件与位置。'}</p>
   </div>
   <div className="home-create-column">
   <form className="home-x-form" aria-label="创建项目" onSubmit={e=>{e.preventDefault();startProject();}}>
    <Sender ref={draftRef} className="home-composer home-x-sender" components={{input:HomeSenderInput as ComponentType<React.ComponentProps<typeof Input.TextArea>>}} value={draft} onChange={setDraft} onPasteFile={files=>void addImages(Array.from(files))} onSubmit={startProject} submitType="shiftEnter" disabled={locked} readOnly={imageBusy} suffix={false} autoSize={{minRows:5,maxRows:10}} placeholder={kind==='asset'?'描述模型的外形、尺寸、材质与细节…':'描述场景的空间、物件，以及它们之间的关系…'} header={
    !!images.length&&<div className="home-reference-images">{images.map((image,i)=><div key={i}>{isReferenceImage(image)?<button type="button" aria-label={`预览首页参考附件 ${i+1}`} onClick={()=>setPreview(image)}><img src={image} alt={`首页参考附件 ${i+1}`}/></button>:<span>{attachmentInfo(image).name}</span>}<Button type="text" aria-label={`移除首页参考附件 ${i+1}`} onClick={()=>setImages(old=>old.filter((_,j)=>i!==j))} icon={<Cross1Icon/>}/></div>)}</div>}
    footer={<div className="home-composer-actions">
     <input ref={fileRef} type="file" multiple hidden onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void addImages(files);}}/>
     <Button className="home-add-image" aria-label={imageBusy?'正在处理参考附件':'添加参考附件'} title="添加参考附件（不限类型与数量，单文件100MB以内）" type="text" disabled={imageBusy} onClick={()=>fileRef.current?.click()} icon={<ImageIcon/>}>{imageBusy?'处理中':'参考附件'}{images.length>0&&<span className="attachment-count">{images.length}</span>}</Button>
     <div className="composer-spacer"/><QualityPicker forNewProject onConfigure={onConfigure}/><ModelPicker forNewProject onConfigure={onConfigure}/>
     <Button type="primary" className="home-start composer-send" aria-label="开始生成" title="开始生成" htmlType="submit" disabled={locked||imageBusy||(!draft.trim()&&!images.length)}><span>开始生成</span><ArrowUpIcon/></Button>
    </div>}/>
   </form>
   <Prompts className="home-prompt-suggestions" role="group" aria-label="需求参考" title="试着描述" wrap items={promptSuggestions.map(item=>({...item,description:<span hidden>{item.description}</span>,disabled:locked}))} onItemClick={({data})=>{if(locked||data.disabled)return;const selected=promptSuggestions.find(item=>item.key===data.key);if(!selected)return;setDraft(selected.description);draftRef.current?.focus();}}/>
   <p className="home-composer-note">可粘贴图片或上传参考文件，单文件最大 100 MB。生成后可先预览，再确认修改。</p>
   {(error||workspaceError)&&<p className="resource-error" role="alert">{error||'工作区保存异常，请关闭其他标签页后刷新本页'}</p>}
   </div>
  </section>
  <aside className="home-activity" aria-label="创作状态">
   {!configured&&<section className="home-setup-guide" aria-labelledby="home-setup-title"><div className="home-setup-heading"><h2 id="home-setup-title">三步开始创作</h2><Button type="text" disabled={locked} onClick={onConfigure}>连接模型<ArrowRightIcon/></Button></div><ol><li><span>1</span><div><strong>连接生成模型</strong><p>使用你自己的模型服务</p></div></li><li><span>2</span><div><strong>描述想法或添加参考</strong><p>告诉 AI 外形、尺寸与材质</p></div></li><li><span>3</span><div><strong>预览，调整，再保存</strong><p>生成结果确认后存入本地库</p></div></li></ol></section>}
   <HomeTasks items={items} disabled={locked} hidden={hidden} onOpen={onOpen} onAll={onTasks}/>
   {configured&&<div className="home-model-status is-configured">
    <MixerHorizontalIcon/><div><strong>{configured?'已配置生成模型':'连接你的生成模型'}</strong><p>{configured?config.model:'配置后即可用 AI 创作，输入内容会保留。'}</p></div>
    <Button type="text" disabled={locked} onClick={onConfigure}>{configured?'管理':'去配置'}<ArrowRightIcon/></Button>
   </div>}
  </aside>
  </div>
  <section className="home-recent-section" aria-labelledby="home-recent-title">
   <StudioSectionHeader id="home-recent-title" title="最近项目" count={matching.length} actions={<div className="home-library-links"><Button type="text" disabled={locked} aria-label="查看全部资产" onClick={()=>onLibrary('asset')}>资产库 <ArrowRightIcon/></Button><Button type="text" disabled={locked} aria-label="查看全部场景" onClick={()=>onLibrary('scene')}>场景库 <ArrowRightIcon/></Button></div>}/>
   {!!projects.length&&<div className="home-project-toolbar">
    <div className="home-project-filters" role="group" aria-label="项目类型筛选">{(['all','asset','scene'] as const).map(value=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value==='all'?'全部项目':value==='asset'?'资产':'场景'}</button>)}</div>
    <Input prefix={<MagnifyingGlassIcon/>} aria-label="搜索项目" placeholder="搜索项目名称…" value={search} onChange={e=>setSearch(e.target.value)}/>
   </div>}
   <div className="home-recent">{recent.map(s=><Card key={s.id} className="home-recent-card" variant="outlined"><article><button className="home-project-link" aria-label={`继续编辑 ${s.title}`} disabled={locked} onClick={()=>{if(switchSession(s.id))onOpen();else setError('请关闭其他标签页后刷新本页');}}><ProjectThumb src={s.sceneThumbnail??items.find(a=>a.id===s.assetSource?.id)?.thumbnail} name={s.title} kind={s.moduleKind??'scene'}/><div className="home-project-caption"><h3>{s.title}</h3><p className="home-project-updated">{new Date(s.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})} · {s.snapshot.doc.nodes.length} 个零件</p><div><Tag variant="filled" className="home-kind">{s.moduleKind==='asset'?<CubeIcon/>:<LayersIcon/>}{s.moduleKind==='asset'?'资产':'场景'}</Tag><span>{projectLabel(s)}</span></div></div></button></article></Card>)}</div>
   {!recent.length&&<StudioEmptyState className="resource-empty home-empty" icon={<LayersIcon/>} title={projects.length?'没有找到匹配的项目':'你的创作，从这里开始'} description={projects.length?'试试其他名称，或切换项目类型。':'用上方的描述开始 AI 创作，也可以先创建一个空白项目。'} actions={!projects.length&&<Button disabled={locked} onClick={startBlankProject}><PlusIcon/>创建空白{kind==='asset'?'资产':'场景'}</Button>}/>}
   {matching.length>12&&<p className="home-composer-note">显示最近更新的 12 个项目。可搜索名称，或前往资产库与场景库查看。</p>}
  </section>
  <footer className="resource-footer">项目保存在当前设备 · 对话随项目保留 · 建议在设置中定期导出备份</footer>
  <Modal open={!!preview} onCancel={()=>setPreview(null)} title="参考附件" width={800} footer={<Button onClick={()=>setPreview(null)}>关闭参考附件</Button>}><img src={preview??''} alt="首页参考附件大图" style={{maxHeight:'65vh',width:'100%',objectFit:'contain'}}/></Modal>
 </StudioPage>;
}
