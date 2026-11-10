import {ProCard,ProTable} from '@ant-design/pro-components';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button,Checkbox,Dropdown,Drawer,Input,Select,Tag} from 'antd';
import {PortalDialog} from './kit/PortalDialog';
import {AccessibleModal as Modal} from './kit/AccessibleModal';
import {CubeIcon,LayersIcon,PlusIcon,MagnifyingGlassIcon,GridIcon,RowsIcon,Cross1Icon,UploadIcon,ChevronDownIcon} from '@radix-ui/react-icons';
import {createSession,switchSession,useWorkspaceStore,editLibrarySessionMetadata,moveLibrarySessionsToCategory,syncAssetCatalogMetadata,isLibraryDraft,sessionIsRunning,trashLibraryDrafts,type WorkspaceSession} from '../workspace';
import {assetDocument,type ModelAssetSummary} from '../domain/modelAssets';
import {listModelAssets,moveModelAssetsToCategory,updateModelAssetMetadata,readModelAsset,readAssetQuality,updateAssetThumbnail} from '../domain/modelAssetStorage';
import {assetQualityStatus,validateAssetQuality} from '../domain/assetQuality';
import {assertLibraryReady,createSceneFromAsset,openLibraryAsset,projectLabel} from '../domain/libraryNavigation';
import {categoryMatches,categoryPath} from '../domain/libraryCategories';
import {listLocalTeamResourceStates,subscribeTeamResourceLinks,type LocalTeamResourceState} from '../domain/teamResourceLinks';
import {getTeamSession,refreshLinkedTeamResources,teamItemFromLink,type TeamItem} from '../domain/teamLibrary';
import {captureLibraryThumbnail} from '../scene/libraryThumbnail';
import {LibraryCategoryTree} from './LibraryCategoryTree';
import {CategoryManager,CategoryPicker,LibraryMetadataDialog,useLibraryCategories} from './LibraryMetadataDialog';
import {TeamSessionLogin,TeamTransferDialog} from './TeamTransferDialog';
import {StudioPage} from './studio/StudioPage';
import {StudioPageHeader} from './studio/StudioPageHeader';
import {StudioEmptyState} from './studio/StudioEmptyState';
import type {SceneDocument} from '../domain/types';

export function ProjectThumb({src,name,kind='scene',document:scene,active=true}:{src?:string;name:string;kind?:'asset'|'scene';document?:SceneDocument;active?:boolean}){
 const [failedSrc,setFailedSrc]=useState<string>();
 const [generated,setGenerated]=useState<{doc:SceneDocument;image:string}>(),[generating,setGenerating]=useState<SceneDocument>();
 const placeholder=useRef<HTMLDivElement>(null),image=src&&src!==failedSrc?src:generated&&generated.doc===scene?generated.image:undefined;
 useEffect(()=>{
  if(!active||image||!scene?.nodes.some(node=>node.visible&&node.geometry)||!placeholder.current||typeof IntersectionObserver==='undefined')return;
  let request:AbortController|undefined;
  const observer=new IntersectionObserver(entries=>{
   if(!entries.some(entry=>entry.isIntersecting)){request?.abort();request=undefined;setGenerating(undefined);return;}
   if(request)return;const controller=request=new AbortController();
   void import('../scene/projectThumbnail').then(async({projectThumbnail})=>{const {promise,resolve}=Promise.withResolvers<void>();const schedule=()=>{if(!controller.signal.aborted&&placeholder.current?.getClientRects().length)setGenerating(scene);resolve();};if('requestIdleCallback' in window)window.requestIdleCallback(schedule,{timeout:1200});else setTimeout(schedule,100);await promise;if(controller.signal.aborted||!placeholder.current?.getClientRects().length)return;return projectThumbnail(scene,controller.signal);}).then(value=>{if(value&&!controller.signal.aborted)setGenerated({doc:scene,image:value});}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setGenerating(undefined);});
  });observer.observe(placeholder.current);
  return()=>{observer.disconnect();request?.abort();};
 },[scene,image,active]);
 return image?<img src={image} alt={`${name} 几何缩略图`} title={image===src?undefined:'本地形体预览，不代表质量验收'} loading="lazy" decoding="async" onError={()=>{if(image===src)setFailedSrc(src);}}/>:<div ref={placeholder} className="resource-no-thumb">{kind==='asset'?<CubeIcon/>:<LayersIcon/>}<span>{scene&&generating===scene?'正在生成预览…':scene&&!scene.nodes.length?'空白项目':src?'预览图暂不可用':'尚无预览图'}</span></div>;
}
function timestamp(value:string|number){return new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function compactTimestamp(value:string|number){return new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function LinkStatus({states,compact=false}:{states:LocalTeamResourceState[];compact?:boolean}){
 if(compact){const active=states.filter(state=>state.link.active),updates=active.some(state=>state.updateAvailable),modified=active.some(state=>state.localModified);return <span className="resource-link-status resource-link-compact"><span>{active.length?'关联团队':states.length?'历史来源':'仅本地'}</span>{updates&&<span className="resource-link-update">有新版</span>}{modified&&<span className="resource-link-modified">本地有修改</span>}</span>;}
 if(!states.length)return <span className="resource-link-status">仅本地 · 尚未关联团队</span>;
 return <span className="resource-link-status">{states.map(state=><span key={`${state.link.serviceOrigin}/${state.link.teamItemId}/${state.link.teamVersion}`}>{state.link.teamName} · 团队 v{state.link.teamVersion}{!state.link.active?' · 历史来源':state.updateAvailable?` · 新版 v${state.latestVersion} 可获取`:''}{state.localModified?' · 有本地修改':''}</span>)}</span>;
}
function ProjectState({session}:{session?:WorkspaceSession}){
 const label=session?projectLabel(session):'已保存到资产库',tone=!session||label==='已保存到库'?'saved':label==='正在执行'?'running':label==='待确认预览'?'review':'draft';
 return <span className="resource-state-badge" data-tone={tone}>{label}</span>;
}
export function ProjectLibrary({kind,onOpen,onManage,onTrash,onImport,locateIds,onLocate}:{kind:'asset'|'scene';onOpen:()=>void;onManage:()=>void;onTrash?:()=>void;onImport?:()=>void;locateIds?:string[];onLocate?:(kind:'asset'|'scene',ids:string[])=>void}){
 const sessions=useWorkspaceStore(state=>state.sessions);
 const [items,setItems]=useState<ModelAssetSummary[]>([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('全部');
 const [view,setView]=useState<'saved'|'draft'>('saved'),[sort,setSort]=useState<'updated'|'name'>('updated'),[layout,setLayout]=useState<'grid'|'list'>('grid');
 const [selected,setSelected]=useState(''),[manageCategories,setManageCategories]=useState(false),[editingAsset,setEditingAsset]=useState<ModelAssetSummary>(),[editingProject,setEditingProject]=useState<WorkspaceSession>();
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[opening,setOpening]=useState(false);
 const [bulk,setBulk]=useState(false),[checked,setChecked]=useState<string[]>([]),[moveTarget,setMoveTarget]=useState('');
 const [trashTarget,setTrashTarget]=useState<{ids:string[];title?:string}>();
 const [categoriesOpen,setCategoriesOpen]=useState(false);
 const [locating,setLocating]=useState(!!locateIds?.length),[quality,setQuality]=useState<{id:string;version:number;label:string}>();
 const detailRef=useRef<HTMLElement>(null);
 const selectedCardRef=useRef<HTMLElement|null>(null);
 const [publishSources,setPublishSources]=useState<Array<{id:string;version?:number}>>(),[teamStates,setTeamStates]=useState<LocalTeamResourceState[]>([]);
 const [acquireTarget,setAcquireTarget]=useState<{item:TeamItem;serviceOrigin:string}>(),[teamLogin,setTeamLogin]=useState(false);
 const lock=useRef(false),alive=useRef(true),linkRequest=useRef(0),resourceName=kind==='asset'?'资产':'场景';
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const {categories,error:categoryError}=useLibraryCategories(sessions.filter(session=>(session.moduleKind??'scene')===kind).map(session=>kind==='asset'?session.assetCategory:session.sceneCategory).filter((category):category is string=>!!category),kind);
 const refreshLinks=useCallback(async()=>{const request=++linkRequest.current;try{const states=await listLocalTeamResourceStates(kind);if(alive.current&&request===linkRequest.current)setTeamStates(states);}catch(reason){if(alive.current&&request===linkRequest.current)setError(reason instanceof Error?reason.message:'读取团队关联失败');}},[kind]);
 useEffect(()=>{void refreshLinks();return subscribeTeamResourceLinks(()=>void refreshLinks());},[refreshLinks,sessions,items]);
 const loadAssets=useCallback(async()=>{setLoading(true);setLoadError('');setError('');try{const rows=await listModelAssets();if(alive.current)setItems(rows);}catch(reason){if(alive.current)setLoadError(reason instanceof Error?reason.message:'读取资产失败');}finally{if(alive.current)setLoading(false);}},[]);
 useEffect(()=>{void loadAssets();},[loadAssets]);
 const allProjects=sessions.filter(session=>!session.deletedAt&&(session.moduleKind??'scene')===kind);
 const hasContent=allProjects.length>0||(kind==='asset'&&items.length>0);
 const drafts=allProjects.filter(isLibraryDraft),savedProjects=allProjects.filter(session=>!isLibraryDraft(session));
 const searchText=query.trim().toLocaleLowerCase();
 const projectCategory=(session:WorkspaceSession)=>kind==='asset'?session.assetCategory:session.sceneCategory;
 const projects=(view==='draft'?drafts:locating?allProjects:savedProjects).filter(session=>(!locating||locateIds?.includes(session.id))&&`${session.title} ${session.libraryDescription??''} ${categoryPath(categories,projectCategory(session))}`.toLocaleLowerCase().includes(searchText)&&(!!searchText||categoryMatches(categories,projectCategory(session),filter))).sort((a,b)=>sort==='name'?a.title.localeCompare(b.title,'zh-CN')||b.updatedAt-a.updatedAt:b.updatedAt-a.updatedAt||a.title.localeCompare(b.title,'zh-CN'));
 const assets=items.filter(item=>(!locating||!locateIds?.length||locateIds.includes(item.id))&&`${item.name} ${item.description??''} ${item.purpose??''} ${categoryPath(categories,item.category)}`.toLocaleLowerCase().includes(searchText)&&(!!searchText||categoryMatches(categories,item.category,filter))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN')||Date.parse(b.createdAt)-Date.parse(a.createdAt):Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.name.localeCompare(b.name,'zh-CN'));
 const browsingAssets=kind==='asset'&&view==='saved',visibleIds=browsingAssets?assets.map(item=>item.id):projects.map(session=>session.id);
 const selectedAsset=browsingAssets?assets.find(item=>item.id===selected):undefined,selectedProject=!browsingAssets?projects.find(session=>session.id===selected):undefined;
 const categoryValues=browsingAssets?items.map(item=>item.category):(view==='draft'?drafts:savedProjects).map(projectCategory);
 const linksFor=(id:string)=>teamStates.filter(state=>state.link.localId===id);
 const detailLinks=selectedAsset?linksFor(selectedAsset.id):selectedProject?linksFor(selectedProject.assetSource?.id??selectedProject.id):[];
 useEffect(()=>{
  if(!selectedAsset)return;let current=true;const {id,version}=selectedAsset;
  void (async()=>{const record=await readAssetQuality(id,version);if(record)await validateAssetQuality(await readModelAsset(id,version),record);const label={unreviewed:'待验收',needs_work:'需要修正',pending:'仍有待验项',user_reviewed:'人工已复核'}[assetQualityStatus(record)];if(current)setQuality({id,version,label});})().catch(()=>{if(current)setQuality({id,version,label:'验收记录不可用，请重新检查'});});
  return()=>{current=false;};
 },[selectedAsset?.id,selectedAsset?.version]);
 useEffect(()=>{if(selected&&window.innerWidth<=720){detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView?.({block:'start',behavior:'smooth'});}},[selected]);
 function resetSelection(){setSelected('');setChecked([]);setNotice('');}
 function selectResource(id:string,card:HTMLElement){selectedCardRef.current=card;setSelected(id);setError('');setNotice('');}
 function closeDetail(){setSelected('');if(selectedCardRef.current?.isConnected)selectedCardRef.current.focus();}
 function changeView(next:'saved'|'draft'){setView(next);setBulk(false);setLocating(false);resetSelection();}
 function toggleChecked(id:string,checkedValue:boolean){setChecked(ids=>checkedValue?[...ids,id]:ids.filter(value=>value!==id));}
 async function perform(action:()=>Promise<void>){if(lock.current){setError('操作正在进行，请稍候重试');return;}lock.current=true;setOpening(true);setError('');setNotice('');try{assertLibraryReady();await action();}catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'操作失败');}finally{lock.current=false;if(alive.current)setOpening(false);}}
 async function checkTeamUpdates(){try{assertLibraryReady();}catch(reason){setError((reason as Error).message);return;}if(!getTeamSession()?.user){setTeamLogin(true);return;}await perform(async()=>{const states=await refreshLinkedTeamResources(kind);if(alive.current){setTeamStates(states);const origin=getTeamSession()?.base,updates=states.filter(state=>state.link.active&&state.link.serviceOrigin===origin&&state.updateAvailable).length;setNotice(`已检查当前团队服务，${updates?`${updates} 项关联有新版`:'暂无可获取的新版'}。其他服务的关联需登录对应服务后检查；本地内容未改变。`);}});}
 async function completedTransfer(){try{const rows=await listModelAssets();if(alive.current)setItems(rows);await refreshLinks();}catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'刷新资源失败');}}
 async function createProject(){await perform(async()=>{const category=filter!=='全部'&&filter!=='未分类'?filter:undefined;if(!createSession(undefined,{moduleKind:kind,title:`未命名${resourceName}`,...(kind==='asset'?{assetCategory:category}:{sceneCategory:category})})){assertLibraryReady();throw Error('无法新建项目，请重试');}onOpen();});}
 async function editAsset(item:ModelAssetSummary){await perform(async()=>{await openLibraryAsset(item,()=>alive.current);onOpen();});}
 async function sceneFromAsset(item:ModelAssetSummary){await perform(async()=>{await createSceneFromAsset(item,`${item.name}场景`,()=>alive.current);onOpen();});}
 async function editAssetInfo(item:ModelAssetSummary){await perform(async()=>{const rows=await listModelAssets(),head=rows.find(row=>row.id===item.id);if(!head)throw Error('找不到资产记录');if(alive.current){setItems(rows);setEditingAsset(head);}});}
 async function refreshThumbnail(item:ModelAssetSummary){await perform(async()=>{const version=await readModelAsset(item.id,item.version),result=await captureLibraryThumbnail(assetDocument(version));if(!alive.current)return;const updated=await updateAssetThumbnail(item.id,item.version,result.image);if(alive.current){setItems(rows=>rows.map(row=>row.id===item.id?updated:row));setNotice(`${result.notice} 模型版本未改变。`);}});}
 async function moveSelection(){await perform(async()=>{
  if(!checked.length||checked.some(id=>!visibleIds.includes(id)))throw Error('选中结果已变化，请重新选择');
  if(browsingAssets){const chosen=checked.map(id=>items.find(item=>item.id===id)!);const changed=await moveModelAssetsToCategory(chosen,moveTarget);if(alive.current)setItems(rows=>rows.map(row=>changed.find(item=>item.id===row.id)??row));for(const item of changed)await syncAssetCatalogMetadata(item);}
  else{const chosen=checked.map(id=>projects.find(session=>session.id===id)!);await moveLibrarySessionsToCategory(chosen,moveTarget||undefined,kind);}
  if(alive.current){setNotice(`已整理 ${checked.length} 项${resourceName}，模型内容、版本与保存状态未改变。`);setChecked([]);}
 });}
 function readyAction(action:()=>void){try{assertLibraryReady();if(lock.current)throw Error('操作正在进行，请稍候重试');setError('');action();}catch(reason){setError(reason instanceof Error?reason.message:'操作失败');}}
 function openProject(session:WorkspaceSession){readyAction(()=>{if(switchSession(session.id))onOpen();else{assertLibraryReady();throw Error('项目已不可用，请重新选择');}});}
 function publishChecked(){if(checked.some(id=>!visibleIds.includes(id))){setError('选中结果已变化，请重新选择');return;}if(!browsingAssets&&projects.some(project=>checked.includes(project.id)&&isLibraryDraft(project))){setError('请先保存有修改的场景，再发布至团队');return;}setPublishSources(browsingAssets?checked.map(id=>({id,version:items.find(item=>item.id===id)!.version})):checked.map(id=>({id})));}
 function canTrash(ids:string[]){return view==='draft'&&ids.length>0&&ids.every(id=>projects.some(project=>project.id===id&&!project.snapshot.wasRunning)&&!sessionIsRunning(id));}
 function confirmTrash(){if(!trashTarget)return;readyAction(()=>{
  if(!canTrash(trashTarget.ids)||!trashLibraryDrafts(trashTarget.ids,kind))throw Error('草稿已变化或正在执行，无法移至回收站');
  resetSelection();setTrashTarget(undefined);setNotice(`已将 ${trashTarget.ids.length} 项草稿移至回收站。可点“打开回收站”恢复。`);
 });}
 const listRows=browsingAssets?assets.map(item=>({id:item.id,name:item.name,category:item.category,version:'v'+item.version,parts:item.parts,updatedAt:item.createdAt})):projects.map(session=>({id:session.id,name:session.title,category:projectCategory(session)??'',version:session.assetSource?'v'+session.assetSource.version:'r'+session.snapshot.doc.revision,parts:session.snapshot.doc.nodes.length,updatedAt:new Date(session.updatedAt).toISOString()}));
 return <StudioPage className={`resource-page resource-page-${kind}${hasContent?' resource-page-populated':''}`} aria-label={`${resourceName}库模块`}>
  <StudioPageHeader title={`${resourceName}库`} description={kind==='asset'?'管理可编辑、可复用的本地 3D 资产。':'整理本地场景、资产引用和编辑草稿。'} actions={<Button type="primary" className="primary" disabled={opening} onClick={()=>void createProject()}><PlusIcon/>新建{resourceName}</Button>}/>
  <div className="resource-local-context"><Tag variant="filled">本地资源</Tag><span>保存在当前设备，登录后可主动发布到团队。</span></div>
  {<div className="resource-toolbar" aria-label="资源工具栏">
   <div className="resource-segments" role="group" aria-label="资源状态"><Button aria-pressed={view==='saved'} onClick={()=>changeView('saved')}>已保存{resourceName} <span>{kind==='asset'?items.length:savedProjects.length}</span></Button><Button aria-pressed={view==='draft'} onClick={()=>changeView('draft')}>草稿 <span>{drafts.length}</span></Button></div>
   <div className="resource-search"><Input aria-label="搜索库内容" placeholder="跨分类搜索名称、说明或分类" value={query} onChange={event=>{setQuery(event.target.value);resetSelection();}} prefix={<MagnifyingGlassIcon/>}/></div>
   <label className="resource-sort">排序<Select aria-label="资源排序" value={sort} onChange={setSort} options={[{value:"updated",label:"最近更新"},{value:"name",label:"名称"}]} style={{minWidth:120}}/></label>
   <div className="resource-view-switch" role="group" aria-label="资源显示方式"><Button type="text" aria-label="网格视图" aria-pressed={layout==='grid'} onClick={()=>setLayout('grid')}><GridIcon/></Button><Button type="text" aria-label="列表视图" aria-pressed={layout==='list'} onClick={()=>setLayout('list')}><RowsIcon/></Button></div>
   <Button disabled={opening} aria-pressed={bulk} onClick={()=>{setBulk(!bulk);setChecked([]);}}>{bulk?'退出多选':'批量整理'}</Button>
   {teamStates.some(state=>state.link.active)&&<Button disabled={opening} onClick={()=>void checkTeamUpdates()}>检查团队更新</Button>}
   {onTrash&&<Button onClick={onTrash}>打开回收站</Button>}
   {kind==='asset'&&onImport&&<Button onClick={onImport}>导入资产 JSON / 资产库备份</Button>}
  </div>}
  {(error||categoryError)&&<p role="alert" className="resource-error">{error||categoryError}</p>}{loadError&&<div role="alert" className="resource-error">资源读取失败：{loadError} <Button onClick={()=>void loadAssets()}>重新加载</Button></div>}
  {notice&&<p role="status" className="resource-notice">{notice}</p>}
  {locating&&locateIds?.length&&<p role="status">本次获取的本机{resourceName}库结果。<Button onClick={()=>{setLocating(false);setFilter('全部');setQuery('');resetSelection();}}>显示全部{resourceName}</Button></p>}
  <div className={`library-organizer${hasContent?'':' library-organizer-empty'}`}>
   {hasContent&&<div className="library-category-region"><button type="button" className="library-category-toggle" aria-expanded={categoriesOpen} aria-controls={`library-categories-${kind}`} onClick={()=>setCategoriesOpen(!categoriesOpen)}>分类：{query.trim()?'全部':categoryPath(categories,filter)}<ChevronDownIcon/></button><div className="library-category-content" id={`library-categories-${kind}`} data-mobile-open={categoriesOpen}><LibraryCategoryTree categories={categories} values={categoryValues} value={query.trim()?'全部':filter} onChange={value=>{setFilter(value);setQuery('');setCategoriesOpen(false);resetSelection();}} onManage={()=>setManageCategories(true)}/></div></div>}
   <div className="resource-main">
    {bulk&&<div className="library-bulk-actions" aria-label="批量资源操作"><strong>已选 {checked.length} 项</strong><Button disabled={opening||!visibleIds.length} onClick={()=>setChecked(visibleIds)}>全选结果</Button><Button type="text" disabled={opening||!checked.length} onClick={()=>setChecked([])}>清空选择</Button><CategoryPicker label="移动到分类" value={moveTarget} onChange={setMoveTarget} categories={categories} optional disabled={opening}/><Button disabled={opening||!checked.length||(browsingAssets&&!moveTarget)} onClick={()=>void moveSelection()}>移动分类</Button>{view==='saved'?<Button disabled={opening||!checked.length} onClick={()=>readyAction(publishChecked)}><UploadIcon/>发布至团队</Button>:<Button danger disabled={opening||!canTrash(checked)} onClick={()=>readyAction(()=>setTrashTarget({ids:checked}))}>批量移至回收站</Button>}</div>}
    <div className="resource-results-heading"><span>{query.trim()?`跨分类搜索：“${query.trim()}”`:filter==='全部'?`全部${view==='draft'?'草稿':resourceName}`:categoryPath(categories,filter)}{view==='draft'&&' · 未保存或有待处理修改'}</span><span>{visibleIds.length} 项结果</span></div>
    <div className={`resource-browser ${selectedAsset||selectedProject?'has-detail':''} resource-layout-${layout}`}>
     <section className="resource-results" aria-label="资源列表" aria-busy={loading}>
      {layout==='list'&&visibleIds.length>0?<ProTable rowKey="id" dataSource={listRows} search={false} options={false} toolBarRender={false} cardProps={false} size="middle" pagination={{pageSize:12,showSizeChanger:false}} scroll={{x:640}} rowSelection={bulk?{selectedRowKeys:checked,onChange:keys=>setChecked(keys.map(String)),getCheckboxProps:()=>({disabled:opening})}:undefined} columns={[
       {title:'名称',dataIndex:'name',render:(_,row)=><Button type="link" aria-label={`查看${browsingAssets?'资产':kind==='asset'?'草稿':'场景'} ${row.name}`} onClick={event=>selectResource(row.id,event.currentTarget)}>{row.name}</Button>},
       {title:'分类',dataIndex:'category',render:(_,row)=>categoryPath(categories,row.category)},
       {title:'版本',dataIndex:'version',width:80},{title:'零件',dataIndex:'parts',width:80},
       {title:'更新时间',dataIndex:'updatedAt',render:(_,row)=>compactTimestamp(row.updatedAt)},
       {title:'操作',valueType:'option',width:90,render:(_,row)=><Button type="link" onClick={event=>selectResource(row.id,event.currentTarget)}>查看详情</Button>}
      ]}/>:<>
      {browsingAssets&&loading?<p className="resource-muted">正在读取资产…</p>:<div className="resource-grid">
       {browsingAssets?assets.map(item=><div className="resource-selectable" key={item.id}><ProCard className={selected===item.id?'pro-resource-card is-selected':'pro-resource-card'} styles={{body:{padding:0}}} hoverable>{bulk&&<Checkbox className="resource-bulk-check" aria-label={`选择资产 ${item.name}`} disabled={opening} checked={checked.includes(item.id)} onChange={event=>toggleChecked(item.id,event.target.checked)}/>}<button className="resource-tile" aria-pressed={selected===item.id} aria-label={`查看资产 ${item.name}`} onClick={event=>selectResource(item.id,event.currentTarget)}><ProjectThumb src={item.thumbnail} name={item.name} kind="asset"/><ProjectState/><strong title={item.name}>{item.name}</strong><span className="resource-category-path" title={categoryPath(categories,item.category)}>{categoryPath(categories,item.category)}</span><span className="resource-tile-meta">v{item.version} · {item.parts} 个零件</span><span className="resource-tile-description" title={item.description||item.purpose}>{item.description||item.purpose||'暂无说明'}</span><span className="resource-tile-updated" title={timestamp(item.createdAt)}>更新 {compactTimestamp(item.createdAt)}</span><LinkStatus compact states={linksFor(item.id)}/></button></ProCard></div>):projects.map(session=><div className="resource-selectable" key={session.id}><ProCard className={selected===session.id?'pro-resource-card is-selected':'pro-resource-card'} styles={{body:{padding:0}}} hoverable>{bulk&&<Checkbox className="resource-bulk-check" aria-label={`选择${view==='draft'?'草稿':'场景'} ${session.title}`} disabled={opening} checked={checked.includes(session.id)} onChange={event=>toggleChecked(session.id,event.target.checked)}/>}<button className="resource-tile" aria-pressed={selected===session.id} aria-label={`查看${kind==='asset'?'草稿':'场景'} ${session.title}`} onClick={event=>selectResource(session.id,event.currentTarget)}><ProjectThumb src={session.sceneThumbnail??items.find(item=>item.id===session.assetSource?.id)?.thumbnail} name={session.title} kind={kind} document={session.snapshot.pendingResult?.doc??session.snapshot.doc}/><ProjectState session={session}/><strong title={session.title}>{session.title}</strong><span className="resource-category-path" title={categoryPath(categories,projectCategory(session))}>{categoryPath(categories,projectCategory(session))}</span><span className="resource-tile-meta">{session.assetSource?`v${session.assetSource.version}`:`修订 r${session.snapshot.doc.revision}`} · {session.snapshot.doc.nodes.length} 个零件</span><span className="resource-tile-description" title={session.libraryDescription}>{session.libraryDescription||'暂无说明'}</span><span className="resource-tile-updated" title={timestamp(session.updatedAt)}>更新 {compactTimestamp(session.updatedAt)}</span><LinkStatus compact states={linksFor(session.assetSource?.id??session.id)}/></button></ProCard></div>)}
      </div>}
      </>}
      {!loading&&!loadError&&!visibleIds.length&&<div className="resource-empty-wrap"><StudioEmptyState className="resource-empty" icon={kind==='asset'?<CubeIcon/>:<LayersIcon/>} title={query?'没有匹配内容':view==='draft'?'暂无草稿':kind==='asset'?'建立你的第一个资产':'创建你的第一个场景'} description={query?'搜索覆盖所有分类，可换一个关键词。':view==='draft'?'未保存的编辑和待确认预览会出现在这里。':kind==='asset'?'在工作台生成或导入模型后点“保存资产”，也可以从已有场景选中部件保存。':'将资产组合为空间布局，保存后继续编辑与完善。'} actions={!query&&filter==='全部'&&<Button type="primary" className="primary" disabled={opening} onClick={()=>void createProject()}><PlusIcon/>创建{resourceName}</Button>}/>{(query||filter!=='全部')&&<Button onClick={()=>{setQuery('');setFilter('全部');resetSelection();}}>清除筛选</Button>}</div>}
     </section>
     <Drawer autoFocus={false} open={(!!selectedAsset||!!selectedProject)&&!editingAsset&&!editingProject&&!publishSources&&!acquireTarget&&!teamLogin} onClose={closeDetail} size={440} closable={false} rootClassName="resource-inspector-drawer">{selectedAsset&&<aside ref={detailRef} tabIndex={-1} className="resource-detail" aria-label="资产详情">
      {(error||categoryError)&&<p role="alert" className="resource-error resource-detail-error">{error||categoryError}</p>}<div className="resource-detail-body">
      <div className="resource-detail-title"><h2>{selectedAsset.name}</h2><Button type="text" aria-label="关闭详情" onClick={closeDetail}><Cross1Icon/></Button></div><ProjectThumb src={selectedAsset.thumbnail} name={selectedAsset.name} kind="asset"/>
      <section className="resource-detail-section"><h3>摘要</h3><dl><dt>完整分类</dt><dd>{categoryPath(categories,selectedAsset.category)}</dd><dt>零件</dt><dd>{selectedAsset.parts}</dd><dt>尺寸 X / Y / Z</dt><dd>{selectedAsset.size.map(value=>Number(value.toFixed(3))).join(' × ')} m</dd><dt>质量</dt><dd>{quality?.id===selectedAsset.id&&quality.version===selectedAsset.version?quality.label:'正在读取验收记录…'}</dd></dl>{(selectedAsset.description||selectedAsset.purpose)&&<p className="resource-detail-description">{selectedAsset.description||selectedAsset.purpose}</p>}</section>
      <section className="resource-detail-section"><h3>版本与来源</h3><dl><dt>本地版本</dt><dd>v{selectedAsset.version}</dd><dt>版本更新时间</dt><dd>{timestamp(selectedAsset.createdAt)}</dd></dl><LinkStatus states={linksFor(selectedAsset.id)}/><p className="resource-muted">场景引用固定版本。编辑实例不改变资产原件；更新预览不增加模型版本。</p></section>
      {detailLinks.filter(state=>state.link.active&&state.updateAvailable).map(state=><div className="resource-linked-update" key={state.link.id}><small>{state.link.serviceOrigin}</small><Button disabled={opening} onClick={()=>readyAction(()=>setAcquireTarget({item:teamItemFromLink(state.link,state.latestVersion),serviceOrigin:state.link.serviceOrigin}))}>获取新版 v{state.latestVersion} 并保留旧副本</Button></div>)}
      </div><footer className="resource-detail-footer"><div className="resource-detail-actions" role="group" aria-label="资产操作"><Button type="primary" className="primary" disabled={opening} onClick={()=>void sceneFromAsset(selectedAsset)}>用此资产新建场景</Button><Button disabled={opening} onClick={()=>void editAsset(selectedAsset)}>编辑资产</Button><Dropdown trigger={['click']} menu={{items:[{key:'metadata',label:'编辑信息',onClick:()=>void editAssetInfo(selectedAsset)},{key:'thumbnail',label:'更新预览图',onClick:()=>void refreshThumbnail(selectedAsset)},{key:'versions',label:'版本记录与资产备份',onClick:onManage},{key:'publish',label:'发布至团队',onClick:()=>readyAction(()=>setPublishSources([{id:selectedAsset.id,version:selectedAsset.version}]))}]}}><Button disabled={opening}>更多操作<ChevronDownIcon/></Button></Dropdown></div><p className="resource-muted">新场景引用此资产的固定版本 v{selectedAsset.version}，资产原件不变。</p></footer>
     </aside>}
     {selectedProject&&<aside ref={detailRef} tabIndex={-1} className="resource-detail" aria-label="项目详情">
      {(error||categoryError)&&<p role="alert" className="resource-error resource-detail-error">{error||categoryError}</p>}<div className="resource-detail-body">
      <div className="resource-detail-title"><h2>{selectedProject.title}</h2><Button type="text" aria-label="关闭详情" onClick={closeDetail}><Cross1Icon/></Button></div><ProjectThumb src={selectedProject.sceneThumbnail??items.find(item=>item.id===selectedProject.assetSource?.id)?.thumbnail} name={selectedProject.title} kind={kind} document={selectedProject.snapshot.pendingResult?.doc??selectedProject.snapshot.doc}/>
      <section className="resource-detail-section"><h3>摘要</h3><dl><dt>完整分类</dt><dd>{categoryPath(categories,projectCategory(selectedProject))}</dd><dt>状态</dt><dd>{projectLabel(selectedProject)}</dd><dt>零件</dt><dd>{selectedProject.snapshot.doc.nodes.length}</dd><dt>更新时间</dt><dd>{timestamp(selectedProject.updatedAt)}</dd></dl>{selectedProject.libraryDescription&&<p className="resource-detail-description">{selectedProject.libraryDescription}</p>}</section>
      <section className="resource-detail-section"><h3>版本与来源</h3><p className="resource-muted">{selectedProject.assetSource?`资产 v${selectedProject.assetSource.version} · `:''}文档修订 r{selectedProject.snapshot.doc.revision}{selectedProject.librarySavedAt?` · 最近入库 ${timestamp(selectedProject.librarySavedAt)}`:' · 尚未保存到库'}</p><LinkStatus states={linksFor(selectedProject.assetSource?.id??selectedProject.id)}/>{kind==='scene'&&<div className="resource-references"><h4>引用资产</h4>{Array.from(new Map(selectedProject.snapshot.doc.nodes.filter(node=>node.modelAsset).map(node=>[node.modelAsset!.instanceId,node.modelAsset!])).values()).map(asset=><p className="resource-reference" key={asset.instanceId}>{items.find(item=>item.id===asset.id)?.name??'资产实例'} · v{asset.version}</p>)}{!selectedProject.snapshot.doc.nodes.some(node=>node.modelAsset)&&<p className="resource-muted">尚未引用资产</p>}</div>}</section>
      {detailLinks.filter(state=>state.link.active&&state.updateAvailable).map(state=><div className="resource-linked-update" key={state.link.id}><small>{state.link.serviceOrigin}</small><Button disabled={opening} onClick={()=>readyAction(()=>setAcquireTarget({item:teamItemFromLink(state.link,state.latestVersion),serviceOrigin:state.link.serviceOrigin}))}>获取新版 v{state.latestVersion} 并保留旧副本</Button></div>)}
      </div><footer className="resource-detail-footer"><div className="resource-detail-actions"><Button type="primary" className="primary" disabled={opening} onClick={()=>openProject(selectedProject)}>{kind==='asset'?'继续编辑草稿':'打开场景'}</Button><Button disabled={opening} onClick={()=>readyAction(()=>setEditingProject(selectedProject))}>编辑信息</Button>{view==='saved'?<Button disabled={opening||isLibraryDraft(selectedProject)} onClick={()=>readyAction(()=>setPublishSources([{id:selectedProject.id}]))}><UploadIcon/>发布至团队</Button>:<Button danger disabled={opening||!canTrash([selectedProject.id])} onClick={()=>readyAction(()=>setTrashTarget({ids:[selectedProject.id],title:selectedProject.title}))}>移至回收站</Button>}</div><p className="resource-muted">预览图在工作台重新保存时更新。草稿和待确认修改不会被当作已保存内容发布。</p></footer>
     </aside>}</Drawer>
    </div>
   </div>
  </div>
  <footer className="resource-footer"><span>本地保存仅限当前浏览器 · 团队关联不等于自动同步 · 请定期备份</span>{kind==='asset'&&<Button onClick={onManage}>资产版本与备份</Button>}</footer>
  {manageCategories&&<CategoryManager kind={kind} encountered={categories.map(category=>category.value)} values={categoryValues} onClose={()=>setManageCategories(false)}/>}
  {editingAsset&&<LibraryMetadataDialog kind="asset" initial={{name:editingAsset.name,category:editingAsset.category,description:editingAsset.description}} title="编辑资产信息" submitLabel="保存信息" onClose={()=>setEditingAsset(undefined)} onSubmit={async metadata=>{assertLibraryReady();const updated=await updateModelAssetMetadata(editingAsset.id,metadata,editingAsset);await syncAssetCatalogMetadata(updated);if(alive.current)setItems(rows=>rows.map(row=>row.id===updated.id?updated:row));}}/>}
  {editingProject&&<LibraryMetadataDialog kind={kind} initial={{name:editingProject.title,category:projectCategory(editingProject),description:editingProject.libraryDescription}} title={kind==='asset'?'编辑草稿信息':'编辑场景信息'} submitLabel="保存信息" onClose={()=>setEditingProject(undefined)} onSubmit={metadata=>{assertLibraryReady();return editLibrarySessionMetadata(editingProject.id,metadata,editingProject.libraryMetadataRevision??0);}}/>}
  {teamLogin&&<PortalDialog label="检查团队关联更新" onClose={()=>setTeamLogin(false)}><h2 className="app-modal-title">检查团队关联更新</h2><p className="app-modal-description">登录关联对应的团队服务后手动检查；不会上传或覆盖本地内容。</p><TeamSessionLogin onConnected={()=>{setTeamLogin(false);void checkTeamUpdates();}}/><div className="app-modal-actions"><Button onClick={()=>setTeamLogin(false)}>取消</Button></div></PortalDialog>}
  {acquireTarget&&<TeamTransferDialog kind={kind} mode="acquire" items={[acquireTarget.item]} serviceOrigin={acquireTarget.serviceOrigin} onClose={()=>setAcquireTarget(undefined)} onLocate={onLocate?ids=>onLocate(kind,ids):undefined} onCompleted={()=>void completedTransfer()}/>}
  {publishSources&&<TeamTransferDialog kind={kind} mode="publish" sources={publishSources} onClose={()=>setPublishSources(undefined)} onCompleted={()=>void completedTransfer()}/>}
  <Modal open={!!trashTarget} onCancel={()=>setTrashTarget(undefined)} footer={null} closable={false} width={420} className="session-dialog"><div role="alertdialog" aria-label="移至回收站？"><h2 className="session-dialog-title">移至回收站？</h2><p className="session-dialog-lede">{trashTarget?.title?`“${trashTarget.title}”`:`所选 ${trashTarget?.ids.length} 项草稿`}的聊天、参考图与场景将一起移入回收站，之后可以恢复。</p>{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><Button onClick={()=>setTrashTarget(undefined)}>取消</Button><Button danger disabled={opening||!trashTarget||!canTrash(trashTarget.ids)} onClick={confirmTrash}>移至回收站</Button></div></div></Modal>
 </StudioPage>;
}
