import {ProForm,ProFormText,ProFormTextArea} from '@ant-design/pro-components';
import {useEffect,useRef,useState} from 'react';
import {Button,Input} from 'antd';
import {CheckIcon,ChevronDownIcon,MagnifyingGlassIcon,PlusIcon} from '@radix-ui/react-icons';
import {categoryMatches,categoryPath,defaultLibraryCategories,listLibraryCategories,saveLibraryCategory,type LibraryCategory,type LibraryKind} from '../domain/libraryCategories';
import {normalizeLibraryMetadata,type LibraryMetadata} from '../domain/libraryMetadata';
import {listModelAssets} from '../domain/modelAssetStorage';
import {saveLibraryProject,type LibrarySaveProgress} from '../domain/workspaceLibrary';
import {useWorkspaceStore} from '../workspace';
import {useEditorStore} from '../store';
import {captureLibraryThumbnail} from '../scene/libraryThumbnail';
import {captureSceneEvidence} from '../scene/capture';
import {CategoryDirectory,CategoryFolderIcon} from './LibraryCategoryTree';
import {PortalDialog} from './kit/PortalDialog';
import {PopoverPanel} from './kit/PopoverPanel';
import './library-metadata.css';
export function useLibraryCategories(encountered:string[]=[],kind:LibraryKind='asset'){
 const [categories,setCategories]=useState<LibraryCategory[]>(()=>defaultLibraryCategories(kind)),[error,setError]=useState(''),[ready,setReady]=useState(false);const key=encountered.join('\u0000');
 useEffect(()=>{let alive=true,sequence=0;const refresh=()=>{const run=++sequence;void listLibraryCategories(encountered,kind).then(rows=>{if(alive&&run===sequence){setCategories(rows);setError('');setReady(true);}}).catch(e=>{if(alive&&run===sequence){setError(e.message);setReady(false);}});};refresh();window.addEventListener('chat3d:categories',refresh);window.addEventListener('focus',refresh);return()=>{alive=false;window.removeEventListener('chat3d:categories',refresh);window.removeEventListener('focus',refresh);};},[key,kind]);
 return {categories,error,ready};
}
export function CategoryPicker({value,onChange,categories,label='分类',optional=false,disabled=false,className}:{value:string;onChange:(value:string)=>void;categories:LibraryCategory[];label?:string;optional?:boolean;disabled?:boolean;className?:string}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');const triggerRef=useRef<HTMLButtonElement>(null);
 const term=query.trim().toLocaleLowerCase(),roots=categories.filter(c=>!c.parentValue).map(parent=>({parent,children:categories.filter(c=>c.parentValue===parent.value)})).filter(({parent,children})=>!term||parent.label.toLocaleLowerCase().includes(term)||children.some(c=>categoryPath(categories,c.value).toLocaleLowerCase().includes(term)));
 function choose(next:string){onChange(next);setOpen(false);setQuery('');}
 function option(next:string,text:string,child=false){return <button key={next} type="button" role="menuitemradio" aria-checked={value===next} aria-label={child?categoryPath(categories,next):text} className={`category-picker-option${child?' is-child':''}`} onClick={()=>choose(next)}><CategoryFolderIcon open={value===next}/><span>{text}</span>{value===next&&<CheckIcon/>}</button>;}
 // antd cannot emit menuitemradio roles, so the popup carries the radio semantics itself.
 // The panel is self-managed: a real popover would keep its content mounted while the
 // leave motion settles, and a chosen category must disappear immediately.
 return <>
  <Button ref={triggerRef} className={className} disabled={disabled} aria-label={label} onClick={()=>setOpen(value=>!value)} onKeyDown={e=>{if(['ArrowDown','Enter',' '].includes(e.key)){e.preventDefault();setOpen(true);}}}><CategoryFolderIcon/>{optional&&!value?'未分类':categoryPath(categories,value)}<ChevronDownIcon/></Button>
  <PopoverPanel anchor={triggerRef} open={open&&!disabled} onClose={()=>{setOpen(false);setQuery('');}} label={`选择${label}`}>
   <div className="category-picker-popover">
    <Input autoFocus aria-label={`搜索${label}`} placeholder="搜索分类…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key!=='ArrowDown')return;e.preventDefault();e.currentTarget.closest('.category-picker-popover')?.querySelector<HTMLButtonElement>('.category-picker-option')?.focus();}} prefix={<MagnifyingGlassIcon/>}/>
    <div className="category-picker-options" role="menu" aria-label={label} onKeyDown={e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));if(!buttons.length)return;e.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();}}>{optional&&(!term||'未分类'.includes(term))&&option('','未分类')}{roots.map(({parent,children})=><div className="category-picker-group" key={parent.value}>{option(parent.value,parent.label)}{children.filter(c=>!term||categoryPath(categories,c.value).toLocaleLowerCase().includes(term)).map(c=>option(c.value,c.label,true))}</div>)}{!roots.length&&!(optional&&(!term||'未分类'.includes(term)))&&<p className="category-directory-empty">没有匹配的分类</p>}</div>
   </div>
  </PopoverPanel>
 </>;
}
export function CategoryManager({onClose,encountered=[],kind='asset',onCreated,values}:{onClose:()=>void;encountered?:string[];kind?:LibraryKind;onCreated?:(category:LibraryCategory)=>void;values?:Array<string|undefined>}){
 const {categories,error:loadError,ready}=useLibraryCategories(encountered,kind),[parent,setParent]=useState(''),[editing,setEditing]=useState<LibraryCategory>(),[label,setLabel]=useState(''),[query,setQuery]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[assetValues,setAssetValues]=useState<Array<string|undefined>>(),[countError,setCountError]=useState('');const lock=useRef(false);
 const sessions=useWorkspaceStore(s=>s.sessions),workspaceReady=useWorkspaceStore(s=>s.ready);
 useEffect(()=>{if(values||kind!=='asset')return;let alive=true;void listModelAssets().then(items=>{if(alive)setAssetValues(items.map(a=>a.category));}).catch(e=>{if(alive)setCountError(e instanceof Error?e.message:'资源计数读取失败');});return()=>{alive=false;};},[kind,values]);
 const resourceValues=values??(kind==='asset'?assetValues:workspaceReady?sessions.filter(s=>!s.deletedAt&&s.moduleKind!=='asset').map(s=>s.sceneCategory):undefined),count=resourceValues?.filter(v=>categoryMatches(categories,v,editing?.value??'全部')).length;
 function create(parentValue=''){setEditing(undefined);setParent(parentValue);setLabel('');setError('');setNotice('');}
 function select(value:string){const category=categories.find(c=>c.value===value);if(!category)return;setEditing(category);setParent(category.parentValue??'');setLabel(category.label);setError('');setNotice('');}
 async function submit(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const saved=await saveLibraryCategory(label,editing,{kind,parentValue:parent});if(!editing)onCreated?.(saved);setEditing(saved);setLabel(saved.label);setParent(saved.parentValue??'');setNotice(editing?'分类名称已保存，资源版本和引用未改变。':'分类已创建，可以继续添加子分类或整理资源。');}catch(e){setError(e instanceof Error?e.message:'分类保存失败');}finally{lock.current=false;setBusy(false);}}
 return <PortalDialog label="管理分类" onClose={onClose} closable={!busy} width={880} className="library-metadata-dialog library-category-manager">
  <div className="category-manager-heading">
   <div><h2 className="app-modal-title">管理分类</h2><p className="app-modal-description">{kind==='asset'?'资产分类':'场景分类'}独立保存在当前浏览器，支持一级分类和子分类。</p></div>
   <span className="category-manager-kind">{kind==='asset'?'资产目录':'场景目录'}</span>
  </div>
  <div className="category-manager-layout">
   <section className="category-manager-browser" aria-label="分类浏览">
    <div className="category-manager-browser-heading"><strong>分类目录 <small>{categories.length}</small></strong><Button type="text" disabled={busy||!ready} aria-label="新建一级分类" onClick={()=>create()}><PlusIcon/>新建</Button></div>
    <Input aria-label="搜索管理分类" placeholder="搜索分类名称…" value={query} onChange={e=>setQuery(e.target.value)} prefix={<MagnifyingGlassIcon/>}/>
    <CategoryDirectory categories={categories} values={resourceValues} value={editing?.value??''} onChange={select} query={query} disabled={busy||!ready} editing/>
    <p className="category-manager-browser-note">{values?'当前资源列表':kind==='asset'?'已保存资产':'本地场景项目'} · {resourceValues?`${resourceValues.length} 项资源`:'正在读取资源数…'}</p>
   </section>
   <section className="category-manager-editor" aria-label="分类编辑">
    <div className="category-manager-editor-heading"><span className="category-manager-folder"><CategoryFolderIcon open/></span><div><h3>{editing?'编辑分类':parent?'新建子分类':'新建一级分类'}</h3><p>{editing?categoryPath(categories,editing.value):'给资源建立清晰的查找位置'}</p></div></div>
    {editing&&<dl className="category-manager-facts"><div><dt>资源数{!editing.parentValue?'（含子分类）':''}</dt><dd>{count===undefined?'读取中…':`${count} 项`}</dd></div><div><dt>子分类</dt><dd>{categories.filter(c=>c.parentValue===editing.value).length} 个</dd></div></dl>}
    <form onSubmit={e=>{e.preventDefault();void submit();}}>
     <label>上级分类<select aria-label="上级分类" disabled={busy||!ready||!!editing} value={parent} onChange={e=>setParent(e.target.value)}><option value="">一级分类</option>{categories.filter(c=>!c.parentValue).map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
     <label>{editing?'新分类名称':'添加分类'}<Input aria-label="分类名称" value={label} maxLength={80} disabled={busy||!ready} placeholder="输入分类名称" onChange={e=>setLabel(e.target.value)}/></label>
     <div className="library-dialog-actions">{editing&&!editing.parentValue&&<Button htmlType="button" disabled={busy||!ready} onClick={()=>create(editing.value)}><PlusIcon/>新建子分类</Button>}<Button type="primary" htmlType="submit" disabled={busy||!ready||!label.trim()}>{editing?'保存分类名称':<><PlusIcon/>添加分类</>}</Button></div>
    </form>
    <div className="category-manager-safety"><CheckIcon/><p>只维护目录和显示名称，不移动已有资源，不修改历史版本或场景中的固定版本引用。分类最多两级。</p></div>
    {(error||loadError||countError)&&<p role="alert" className="resource-error">{error||loadError||countError}</p>}{notice&&<p role="status" className="category-manager-notice">{notice}</p>}
   </section>
  </div>
  <div className="category-manager-footer"><span>资产与场景的分类互不影响</span><Button htmlType="button" disabled={busy} onClick={onClose}>完成</Button></div>
 </PortalDialog>;
}
const saveStageLabels:Record<LibrarySaveProgress['stage'],string>={preparing:'准备模型数据',thumbnail:'生成预览图',validating:'检查模型数据',writing:'写入资源库',workspace:'保存工作区',complete:'保存完成'};
export function LibraryMetadataDialog({kind,initial,title,submitLabel,onSubmit,onClose,onBusyChange,progress}:{kind:'asset'|'scene';initial:LibraryMetadata;title:string;submitLabel:string;onSubmit:(metadata:LibraryMetadata)=>Promise<void>;onClose:()=>void;onBusyChange?:(busy:boolean)=>void;progress?:LibrarySaveProgress}){
 const [name,setName]=useState(initial.name),[category,setCategory]=useState(initial.category??(kind==='asset'?'其他':'')),[description,setDescription]=useState(initial.description??''),[manage,setManage]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false),alive=useRef(true);
 const formInitial=useRef({name:initial.name,description:initial.description??''});
 const {categories,error:categoryError,ready}=useLibraryCategories(category?[category]:[],kind);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const saveProgress:LibrarySaveProgress=progress??{stage:'preparing',completed:0,total:5},stageLabel=saveStageLabels[saveProgress.stage];
 function close(){if(!lock.current)onClose();}
 async function submit(){if(lock.current)return;setError('');let metadata:LibraryMetadata;try{metadata=normalizeLibraryMetadata({name,category,description},kind);}catch(e){setError((e as Error).message);return;}lock.current=true;setBusy(true);onBusyChange?.(true);try{await onSubmit(metadata);if(alive.current)onClose();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'保存失败');}finally{lock.current=false;onBusyChange?.(false);if(alive.current)setBusy(false);}}
 return <><PortalDialog label={title} onClose={close} closable={!busy} width={480} className="library-metadata-dialog">
  <h2 className="app-modal-title">{title}</h2>
  <p className="app-modal-description">{kind==='asset'?'整理资产名称、分类和说明。模型尺寸、版本与质量状态由实际数据保留。':'整理场景名称与说明，分类可选。场景中的资产引用保持固定版本。'}</p>
  <ProForm initialValues={formInitial.current} submitter={false} onValuesChange={values=>{if(values.name!==undefined)setName(values.name);if(values.description!==undefined)setDescription(values.description);}} onFinish={async()=>{await submit();}}>
   <ProFormText name="name" label={kind==='asset'?'资产名称':'场景名称'} fieldProps={{autoFocus:true,'aria-label':kind==='asset'?'资产名称':'场景名称',maxLength:80,disabled:busy}} placeholder={kind==='asset'?'例如：蓝色网格托盘':'例如：原料仓库'}/>

   <div className="library-category-field"><label>{kind==='scene'?'分类（可选）':'分类'}<CategoryPicker label={kind==='asset'?'资产分类':'场景分类'} value={category} onChange={setCategory} categories={categories} optional={kind==='scene'} disabled={busy||!ready}/></label><Button type="text" disabled={busy||!ready} onClick={()=>setManage(true)}>管理分类</Button></div>
   <ProFormTextArea name="description" label="说明" fieldProps={{'aria-label':'库内容说明',maxLength:500,disabled:busy,rows:3}} placeholder="用途、结构或需要保留的细节"/>
   {(error||categoryError)&&<p role="alert" className="resource-error">{error||categoryError}</p>}
   {busy&&<div className="library-save-progress" role="status" aria-live="polite" aria-atomic="true">
    <div className="library-save-progress-heading"><strong>{stageLabel}</strong><span>{saveProgress.completed}/{saveProgress.total} 个阶段已完成</span></div>
    <progress aria-label="保存阶段" aria-valuetext={`${stageLabel}，${saveProgress.completed}/${saveProgress.total} 个阶段已完成`} max={saveProgress.total} value={saveProgress.completed}/>
    <p>大型模型可能需要较长时间。阶段进度不代表耗时比例；保存完成前无法关闭，请稍候。</p>
   </div>}
   <div className="library-dialog-actions"><Button htmlType="button" disabled={busy} onClick={close}>取消</Button><Button type="primary" htmlType="submit" disabled={busy||!ready}>{busy?'正在保存…':submitLabel}</Button></div>
  </ProForm>
 </PortalDialog>{manage&&<CategoryManager kind={kind} onCreated={c=>{setCategory(c.value);setManage(false);}} encountered={category?[category]:[]} onClose={()=>setManage(false)}/>}</>;
}
export function LibraryProjectSaveDialog({onClose,onSaved,onBusyChange}:{onClose:()=>void;onSaved:(notice:string)=>void;onBusyChange:(busy:boolean)=>void}){
 const [target]=useState(()=>{const w=useWorkspaceStore.getState();return {session:w.sessions.find(s=>s.id===w.activeId),projectId:useEditorStore.getState().doc.projectId};});
 const [initial,setInitial]=useState<LibraryMetadata>(),[revision,setRevision]=useState(0),[error,setError]=useState(''),[progress,setProgress]=useState<LibrarySaveProgress>();const session=target.session;
 useEffect(()=>{let alive=true;void (async()=>{if(!session)throw Error('找不到当前项目');const head=session.assetSource?(await listModelAssets()).find(a=>a.id===session.assetSource!.id):undefined;if(session.assetSource&&!head)throw Error('找不到资产记录，草稿已保留');if(alive){setInitial(head?{name:head.name,category:head.category,description:head.description}:{name:/^未命名(资产|场景)$/.test(session.title)?'':session.title,category:session.moduleKind==='asset'?session.assetCategory:session.sceneCategory,description:session.libraryDescription});setRevision(head?.metadataRevision??session.libraryMetadataRevision??0);}})().catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[session]);
 if(!initial||!session)return <PortalDialog label="保存到库" onClose={onClose} width={480}>
  <h2 className="app-modal-title">保存到库</h2>
  <p className="app-modal-description">{error||'正在读取项目信息…'}</p>
  <div className="app-modal-actions"><Button htmlType="button" onClick={onClose}>取消</Button></div>
 </PortalDialog>;
 return <LibraryMetadataDialog kind={session.moduleKind??'scene'} initial={initial} title={session.moduleKind==='asset'?'保存资产到库':'保存场景到库'} submitLabel="保存到库" onBusyChange={onBusyChange} onClose={onClose} progress={progress} onSubmit={async metadata=>{setProgress({stage:'preparing',completed:0,total:5});let imageNotice='';const notice=await saveLibraryProject(async d=>{const result=await captureLibraryThumbnail(d,captureSceneEvidence);imageNotice=result.notice;return result.image;},{metadata,sessionId:session.id,projectId:target.projectId,metadataRevision:revision,onProgress:setProgress});onSaved(notice+(imageNotice?` ${imageNotice}`:''));}}/>;
}
