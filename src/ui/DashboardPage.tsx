import {DashboardRegionEditor} from './DashboardRegionEditor';
import {DashboardCardPreview,DashboardScreenshot} from './DashboardCardPreview';
import {DashboardScreenshotDialog} from './DashboardScreenshotDialog';
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Alert,Button,Dropdown,Empty,Input,InputNumber,Modal,Progress,Select,Spin,Switch,Tag} from 'antd';
import {CodeIcon,DashboardIcon,DotsHorizontalIcon,DownloadIcon,LayersIcon,MagnifyingGlassIcon,ReloadIcon,UploadIcon} from '@radix-ui/react-icons';
import {getTeamSession,subscribeTeamSession} from '../domain/teamLibrary';
import {DEFAULT_DASHBOARD_VIEW,downloadDashboardSource,listDashboards,readDashboard,validDashboardRegion,type DashboardItem,type DashboardVersion,type DashboardView,type DashboardRegion} from '../domain/dashboard';
import {useEditorStore} from '../store';
import {useWorkspaceStore} from '../workspace';
import {assertLibraryReady} from '../domain/libraryNavigation';
import {prepareDashboardBinding} from '../runtime/dashboardCommands';
import {TeamSessionLogin} from './TeamTransferDialog';
import {exportHtml,withHtmlViewerView} from '../scene/exportHtml';
import {buildDashboardExport,inspectDashboardPlacement} from '../scene/dashboardRuntime';
import {exportFile} from '../util/exportFile';
import {DashboardPresentation} from './DashboardPresentation';
import {DashboardUploadDialog} from './DashboardUploadDialog';
import './dashboard.css';

function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}

type ExportStatus={kind:'running';name:string;loaded:number;total?:number}|{kind:'success'|'error'|'cancel';message:string};
function ExportFeedback({status}:{status:ExportStatus|null}){
  if(!status)return null;
  if(status.kind!=='running')return <Alert role={status.kind==='error'?'alert':'status'} type={status.kind==='cancel'?'info':status.kind} showIcon title={status.message}/>;
  const percent=status.total&&status.total>0?Math.min(100,Math.floor(status.loaded/status.total*100)):undefined;
  return <div role="status" aria-live="polite"><span>正在导出「{status.name}」…</span><Progress percent={percent??100} status="active" showInfo={percent!==undefined}/></div>;
}

export function DashboardSceneView({onClose}:{onClose:()=>void}) {
  const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession);
  const doc=useEditorStore(state=>state.doc),binding=doc.dashboard;
  const [value,setValue]=useState<DashboardVersion>();
  const [scene,setScene]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [exporting,setExporting]=useState(false),[adjusting,setAdjusting]=useState(false),[editingRegion,setEditingRegion]=useState(false),[measuring,setMeasuring]=useState(false);
  const [exportStatus,setExportStatus]=useState<ExportStatus|null>(null);
  const [draft,setDraft]=useState<DashboardView>({...DEFAULT_DASHBOARD_VIEW,...binding?.view});
  const [previewView,setPreviewView]=useState(draft);
  const [region,setRegion]=useState<DashboardRegion|undefined>(binding?.region),[previewRegion,setPreviewRegion]=useState(region);
  useEffect(()=>{const next={...DEFAULT_DASHBOARD_VIEW,...binding?.view};setDraft(next);setPreviewView(next);setRegion(binding?.region);setPreviewRegion(binding?.region);},[binding?.view,binding?.region]);
  useEffect(()=>{
    let alive=true;const abort=new AbortController();setError('');setValue(undefined);setScene('');
    if(!binding)return;
    void(async()=>{
      if(!client?.user||client.base!==binding.service)throw Error('请登录绑定模板所属的团队服务：'+binding.service);
      const [template,html]=await Promise.all([readDashboard(client,binding.templateId,binding.version,abort.signal),exportHtml(doc,binding.name,undefined,{embedded:true})]);
      if(alive){setValue(template);setScene(html);}
    })().catch(reason=>{if(alive)setError(errorMessage(reason));});
    return()=>{alive=false;abort.abort();};
  },[client,doc.projectId,doc.nodes,doc.materials,doc.assets,binding?.service,binding?.templateId,binding?.version]);
  const adjustedScene=useMemo(()=>scene?withHtmlViewerView(scene,previewView):'',[scene,previewView]);
  const previewBinding=useMemo(()=>binding?{...binding,region:previewRegion}:undefined,[binding,previewRegion]);
  const changed=JSON.stringify(draft)!==JSON.stringify({...DEFAULT_DASHBOARD_VIEW,...binding?.view})||JSON.stringify(region)!==JSON.stringify(binding?.region);
  const regionValid=region===undefined||validDashboardRegion(region);
  const download=async()=>{
    if(!value||!scene||!binding||exporting||!regionValid)return;
    setExporting(true);setExportStatus(null);
    try{
      const result=await exportFile(()=>{setExportStatus({kind:'running',name:binding.name,loaded:0});return buildDashboardExport(value.package,{...binding,view:draft,region},withHtmlViewerView(scene,draft));},'html','scenivo-dashboard.html');
      setExportStatus(result===null?{kind:'cancel',message:'已取消导出'}:{kind:'success',message:result});
    }catch(reason){setExportStatus({kind:'error',message:errorMessage(reason)});}
    finally{setExporting(false);}
  };
  const save=()=>{const current=useEditorStore.getState();if(current.doc!==doc||!current.doc.dashboard){setNotice('场景已变化，请重新打开看板后调整');return false;}if(!regionValid){setNotice('三维区域无效，请重新拖动');return false;}const result=current.setDashboard({...current.doc.dashboard,view:{...draft},region:region?{...region}:undefined});setNotice(result.ok?'显示设置已保存，可撤销。':result.error??'保存失败');return result.ok;};
  const editRegion=async()=>{
    if(editingRegion){if(save())setEditingRegion(false);return;}if(!value||measuring)return;
    if(region){setEditingRegion(true);return;}
    const source=value;setMeasuring(true);setNotice('');
    try{const measured=await inspectDashboardPlacement(source.package);if(useEditorStore.getState().doc!==doc)return;setRegion(measured.region);setEditingRegion(true);}catch(reason){setNotice(errorMessage(reason));}finally{setMeasuring(false);}
  };
  const preview=()=>{if(!regionValid){setNotice('三维区域不能超出画布，宽高至少为 5%');return;}setPreviewView({...draft});setPreviewRegion(region?{...region}:undefined);};
  const fields:{key:keyof DashboardView;label:string;min:number;max:number;factor:number;unit:string}[]=[
    {key:'zoom',label:'模型大小',min:25,max:400,factor:100,unit:'%'},
    {key:'offsetX',label:'模型水平偏移',min:-100,max:100,factor:100,unit:'%'},
    {key:'offsetY',label:'模型垂直偏移',min:-100,max:100,factor:100,unit:'%'},
    {key:'azimuth',label:'旋转角度',min:-180,max:180,factor:1,unit:'°'},
    {key:'elevation',label:'俯视角度',min:5,max:85,factor:1,unit:'°'},
  ];
  return <Modal open centered className="dashboard-scene-modal" title={binding?`${binding.name} · v${binding.version}`:'未接入看板'} onCancel={onClose} width={adjusting?'min(95vw, calc((100dvh - 330px) * 16 / 9 + 48px))':'min(95vw, calc((100dvh - 170px) * 16 / 9 + 48px))'} footer={<><Button disabled={exporting||!value||!scene||!regionValid} loading={exporting} onClick={()=>void download()}>导出组合大屏 HTML</Button><Button onClick={onClose}>关闭</Button></>}>
    <div className="dashboard-view-toolbar"><span>{editingRegion?'拖动移动，拉动边角缩放；完成后自动保存':'16:9 等比看板 · 数据面板位于三维模型上层'}</span><div><Button aria-expanded={adjusting} onClick={()=>{setAdjusting(!adjusting);setEditingRegion(false);}}>调整模型</Button>{binding?.mode==='dashboard'&&<Button disabled={!value} loading={measuring} aria-pressed={editingRegion} onClick={()=>{setAdjusting(false);void editRegion();}}>{editingRegion?'完成区域编辑':'编辑三维区域'}</Button>}</div></div>
    {adjusting&&<section className="dashboard-view-adjustments" aria-label="模型显示设置">
      {adjusting&&<div className="dashboard-view-fields">{fields.map(field=><label key={field.key}>{field.label}<InputNumber aria-label={field.label} min={field.min} max={field.max} step={field.key==='zoom'?5:1} suffix={field.unit} value={Math.round(draft[field.key]*field.factor)} onChange={number=>{if(number===null||!Number.isFinite(number))return;setNotice('');setDraft(previous=>previous[field.key]===number/field.factor?previous:{...previous,[field.key]:number/field.factor});}}/></label>)}</div>}
      <div className="dashboard-view-actions"><Button onClick={()=>{setDraft({...DEFAULT_DASHBOARD_VIEW});setPreviewView({...DEFAULT_DASHBOARD_VIEW});setRegion(undefined);setPreviewRegion(undefined);}}>恢复自动适配</Button><Button disabled={!regionValid} onClick={preview}>预览调整</Button><Button type="primary" disabled={!changed||!regionValid} onClick={save}>保存显示设置</Button></div>
    </section>}
    {notice&&<Alert role="status" type="info" title={notice} closable onClose={()=>setNotice('')}/>}
    {!!doc.animation?.tracks.length&&<p>导出的三维模型不含场景动画。如需保留动画，请下载项目 JSON。</p>}
    <ExportFeedback status={exportStatus}/>
    <div className="dashboard-scene-modal-content">{error?<Alert type="error" role="alert" title={error}/>:value&&adjustedScene&&previewBinding?<><DashboardPresentation pack={value.package} binding={previewBinding} sceneHtml={adjustedScene}/>{editingRegion&&region&&regionValid&&<DashboardRegionEditor region={region} onChange={next=>{setRegion(next);setNotice('');}}/>}</>:binding?<div className="dashboard-loading" role="status"><Spin/><span>正在载入已接入的固定版本…</span></div>:<Empty description="当前场景尚未接入看板"/>}</div>
  </Modal>;
}

export function DashboardPage({onSceneLibrary}:{onSceneLibrary?:()=>void}){
  const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession);
  const admin=client?.user?.role==='admin';
  const binding=useEditorStore(state=>state.doc.dashboard);
  const workspace=useWorkspaceStore(),doc=useEditorStore(state=>state.doc),aiStatus=useEditorStore(state=>state.aiStatus);
  const currentScene=workspace.sessions.find(session=>session.id===workspace.activeId&&!session.deletedAt&&session.moduleKind!=='asset');
  const sceneAvailable=!!currentScene&&doc.nodes.some(node=>node.visible);
  const sceneLocked=!['idle','error','cancelled'].includes(aiStatus)||!!workspace.error;
  const [connection,setConnection]=useState<{template:DashboardItem;account:typeof client;sceneId:string;name:string;doc:typeof doc}>();
  const [items,setItems]=useState<DashboardItem[]>([]);
  const [query,setQuery]=useState(''),[systemFilter,setSystemFilter]=useState('');
  const [all,setAll]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(''),[error,setError]=useState('');
  const [exportStatus,setExportStatus]=useState<ExportStatus|null>(null);
  const [upload,setUpload]=useState<{target?:DashboardItem}>();
  const [selected,setSelected]=useState<DashboardItem>();
  const [screenshotTarget,setScreenshotTarget]=useState<DashboardItem>();
  const [viewer,setViewer]=useState(false);
  const request=useRef(0),actionLock=useRef(false),detail=useRef<HTMLElement>(null);
  const transfer=useRef<AbortController|undefined>(undefined),mounted=useRef(true),selectedRef=useRef(selected);
  selectedRef.current=selected;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;transfer.current?.abort();};},[]);

  async function refresh() {
    if(!client?.user)return;
    const current=++request.current;
    setLoading(true);setError('');
    try{const values=await listDashboards(client,admin&&all);if(current===request.current)setItems(values);}
    catch(reason){if(current===request.current)setError(errorMessage(reason));}
    finally{if(current===request.current)setLoading(false);}
  }
  useEffect(()=>{
    transfer.current?.abort();setItems([]);setSelected(undefined);setConnection(undefined);setUpload(undefined);setScreenshotTarget(undefined);setSystemFilter('');setNotice('');setError('');
    if(client?.user)void refresh();else setLoading(false);
    return()=>{request.current++;transfer.current?.abort();};
  },[client,all]);
  useEffect(()=>{if(selected)detail.current?.scrollIntoView?.({behavior:'smooth',block:'start'});},[selected]);
  async function action(work:()=>Promise<void>) {
    if(actionLock.current)return;
    actionLock.current=true;setBusy(true);setError('');setNotice('');
    try{await work();}catch(reason){if(mounted.current)setError(errorMessage(reason));}
    finally{actionLock.current=false;if(mounted.current)setBusy(false);}
  }
  function choose(item:DashboardItem) {
    transfer.current?.abort();setSelected(item);setError('');
  }
  async function downloadSource(item:DashboardItem){
    if(!client)return;
    await action(async()=>{
      const abort=new AbortController();transfer.current=abort;setExportStatus(null);
      try{
        const result=await downloadDashboardSource(client,item,progress=>{if(!abort.signal.aborted)setExportStatus({kind:'running',name:item.name,...progress});},abort.signal);
        if(!abort.signal.aborted)setExportStatus(result===null?{kind:'cancel',message:'已取消导出'}:{kind:'success',message:result});
      }catch(reason){if(mounted.current)setExportStatus(abort.signal.aborted?{kind:'cancel',message:'已取消导出'}:{kind:'error',message:errorMessage(reason)});}
    });
  }
  async function connect(){
    if(!connection||!client||actionLock.current)return;
    const target=connection;
    const abort=new AbortController();transfer.current=abort;
    await action(async()=>{
      assertLibraryReady();
      if(client!==target.account)throw Error('团队账户已变更，请重新选择看板');
      const list=await listDashboards(client);
      if(!list.some(item=>item.id===target.template.id))throw Error('模板已下架或不可用，未修改场景');
      const template=await readDashboard(client,target.template.id,target.template.version,abort.signal);
      const {binding:fixed,description}=await prepareDashboardBinding(client,template,'dashboard',abort.signal);
      abort.signal.throwIfAborted();
      const current=useWorkspaceStore.getState(),scene=current.sessions.find(session=>session.id===target.sceneId&&!session.deletedAt);
      if(!mounted.current||selectedRef.current!==target.template||!detail.current||current.activeId!==target.sceneId||scene?.title!==target.name||scene.moduleKind==='asset'||useEditorStore.getState().doc!==target.doc)throw Error('当前场景或模板预览已变化，请重新确认接入');
      assertLibraryReady();
      const result=useEditorStore.getState().setDashboard(fixed);
      if(!result.ok)throw Error(result.error);
      setConnection(undefined);setNotice(`已接入场景“${target.name}”：${fixed.name} v${fixed.version}，引用版本保持固定。${description}。可在工作台“查看看板”或撤销。`);
    });
  }
  const systems=Array.from(new Set(items.map(item=>item.system))).filter(Boolean).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const needle=query.trim().toLocaleLowerCase();
  const visible=items.filter(item=>(!systemFilter||item.system===systemFilter)&&`${item.name} ${item.description} ${item.system} ${item.fileName}`.toLocaleLowerCase().includes(needle));
  const working=busy||loading;

  return <section className="dashboard-page" aria-label="看板库">
    <header className="dashboard-page-header">
      <div><div className="dashboard-page-eyebrow"><DashboardIcon/>团队看板</div><h1>看板库</h1><p>查看大屏模板，预览后可直接接入当前场景；也可在工作台输入 /看板。</p></div>
      {client?.user&&admin&&<Button type="primary" size="large" icon={<UploadIcon/>} onClick={()=>setUpload({})}>上传看板模板</Button>}
    </header>
    {!client?.user?<div className="dashboard-empty"><span className="dashboard-empty-symbol"><DashboardIcon/></span><h2>登录后访问团队看板</h2><TeamSessionLogin/></div>:<>
      {binding&&<section className="dashboard-current-binding" aria-label="当前场景已接入"><span className="dashboard-binding-icon"><LayersIcon/></span><div><span className="dashboard-field-hint">当前场景已接入</span><strong>{binding.name}<Tag>v{binding.version}</Tag></strong><p>{binding.mode==='overlay'?'场景叠加看板':'大屏嵌入场景'}</p></div><div className="dashboard-binding-actions"><Button onClick={()=>setViewer(true)}>查看已接入看板</Button></div></section>}
      <section className="dashboard-library" aria-labelledby="dashboard-library-title">
        <div className="dashboard-library-heading"><div><h2 id="dashboard-library-title">模板库 <span>{visible.length}</span></h2><p>按系统查找，查看源码与固定版本</p></div>{!admin&&<span className="dashboard-field-hint">模板由团队管理员发布</span>}</div>
        <div className="dashboard-toolbar">
          <Input className="dashboard-search" aria-label="搜索看板模板" prefix={<MagnifyingGlassIcon/>} placeholder="搜索模板名称、描述或系统" value={query} allowClear onChange={event=>setQuery(event.target.value)}/>
          <Select className="dashboard-system-filter" aria-label="看板系统筛选" value={systemFilter} options={[{value:'',label:'全部系统'},...systems.map(value=>({value,label:value}))]} onChange={setSystemFilter}/>
          <div className="dashboard-toolbar-end">{admin&&<label className="dashboard-archive-switch"><Switch size="small" aria-label="包含已下架" checked={all} disabled={busy} onChange={setAll}/><span>包含已下架</span></label>}<Button icon={<ReloadIcon/>} disabled={working} onClick={()=>void refresh()}>刷新模板</Button></div>
        </div>
        {error&&<Alert role="alert" type="error" showIcon title={error} action={<Button size="small" onClick={()=>void refresh()} disabled={working}>重新读取</Button>}/>}
        {notice&&<Alert role="status" type="success" showIcon closable title={notice} onClose={()=>setNotice('')}/>}
        <ExportFeedback status={exportStatus}/>
        {loading?<div className="dashboard-loading" role="status"><Spin/><span>正在读取看板模板…</span></div>:visible.length?<div className="dashboard-template-grid">
          {visible.map(item=><article key={item.id} className={`dashboard-template-card${selected?.id===item.id?' is-selected':''}${item.archived?' is-archived':''}`} aria-label={`看板模板 ${item.name}`}>
            <DashboardCardPreview client={client} item={item} disabled={working} onOpen={()=>choose(item)}/>
            <div className="dashboard-template-topline">
              <span className="dashboard-template-icon"><DashboardIcon/></span>
              <div className="dashboard-template-tags">
                <Tag>{item.system}</Tag><Tag>v{item.version}</Tag>{item.archived&&<Tag>已下架</Tag>}
              </div>
              {admin&&<Dropdown trigger={['click']} menu={{items:[
                {key:'version',label:'发布新版',onClick:()=>setUpload({target:item})},
                {key:'screenshot',label:'管理此版本截图',onClick:()=>setScreenshotTarget(item)},
                {type:'divider'},
                {
                  key:'archive',label:item.archived?'重新上架':'下架模板',danger:!item.archived,
                  onClick:()=>void action(async()=>{
                    if(!client)return;
                    await client.request(`dashboards/${item.id}/archive`,{archived:!item.archived});
                    setItems(await listDashboards(client,all));
                    setNotice(item.archived?'模板已重新上架':'模板已下架，已有场景的固定版本不受影响');
                  }),
                },
              ]}}>
                <Button type="text" size="small" aria-label={`${item.name} 的模板操作`} disabled={working} icon={<DotsHorizontalIcon/>}/>
              </Dropdown>}
            </div>
            <h3 title={item.name}>{item.name}</h3>
            <div className="dashboard-template-actions">
              <Button type="primary" ghost disabled={working} onClick={()=>choose(item)}>查看模板</Button>
              <Button icon={<DownloadIcon/>} disabled={working} onClick={()=>void downloadSource(item)}>导出源码</Button>
            </div>
          </article>)}
        </div>:<div className="dashboard-empty"><span className="dashboard-empty-symbol"><DashboardIcon/></span><h3>{query||systemFilter?'没有匹配的看板模板':error?'暂时无法读取模板':'还没有看板模板'}</h3><p>{query||systemFilter?'试试其他关键词或系统，或清除筛选条件。':error?'请检查团队服务连接后重试。':'上传已有静态大屏，保留源码与版本，再选择场景接入。'}</p>{query||systemFilter?<Button onClick={()=>{setQuery('');setSystemFilter('');}}>清除筛选</Button>:!error&&admin?<Button type="primary" icon={<UploadIcon/>} onClick={()=>setUpload({})}>上传第一个看板模板</Button>:null}</div>}
      </section>
      <div className="dashboard-security-note"><CodeIcon/><p>静态源码在隔离环境中运行，不执行服务端构建，不共享登录信息。接入模板仅组合展示，不代表已接通业务数据。</p></div>
      {selected&&<section ref={detail} className="dashboard-connection" aria-labelledby="dashboard-connection-title">
        <header className="dashboard-connection-heading">
          <div>
            <span className="dashboard-page-eyebrow">模板预览</span>
            <h2 id="dashboard-connection-title">{selected.name} <Tag>v{selected.version}</Tag></h2>
            <p>{sceneAvailable?`当前场景：${currentScene!.title}。接入将固定使用模板 v${selected.version}，可撤销。`:'请先创建/打开有可见模型的场景，再接入看板。资产项目不能作为接入目标。'}</p>
          </div>
          <Button type="text" onClick={()=>{transfer.current?.abort();setSelected(undefined);setConnection(undefined);}}>关闭预览</Button>
        </header>
        <div className="dashboard-template-preview"><DashboardScreenshot client={client} item={selected}/></div>
        {selected.screenshot&&<p>截图来源（管理员人工确认）：{selected.screenshot.source} · {selected.screenshot.width}×{selected.screenshot.height} · {selected.screenshot.capturedAt}。非服务端自动真实性证明。</p>}
        <div className="dashboard-command-hint"><Button type="primary" disabled={working||selected.archived||!sceneAvailable||sceneLocked} onClick={()=>{setError('');setConnection({template:selected,account:client,sceneId:currentScene!.id,name:currentScene!.title,doc});}}>接入当前场景</Button>{!sceneAvailable&&onSceneLibrary&&<Button onClick={onSceneLibrary}>创建/打开场景</Button>}{selected.archived?<p>此模板已下架，不能新接入。</p>:sceneAvailable&&sceneLocked&&<p>请先结束任务、处理预览或解决本机保存异常。</p>}<p>仅组合展示，不代表已接通业务数据。</p></div>
      </section>}
      {upload&&<DashboardUploadDialog client={client} target={upload.target} systems={systems} onClose={()=>setUpload(undefined)} onPublished={()=>{setUpload(undefined);setNotice('看板模板已发布，已有场景继续使用原固定版本');void refresh();}}/>}
      {screenshotTarget&&<DashboardScreenshotDialog client={client} item={screenshotTarget} onClose={()=>setScreenshotTarget(undefined)} onSaved={()=>{setScreenshotTarget(undefined);setSelected(undefined);setNotice('截图绑定已更新');void refresh();}}/>}
    </>}
    {viewer&&<DashboardSceneView onClose={()=>setViewer(false)}/>}
    <Modal open={!!connection} title="接入当前场景" okButtonProps={{loading:busy}} okText="确认接入" cancelText={busy?'取消接入':'取消'} onCancel={()=>{transfer.current?.abort();setConnection(undefined);}} onOk={()=>void connect()}><p>将“{connection?.template.name}”固定版本 v{connection?.template.version} 接入场景“{connection?.name}”{connection?.doc.dashboard?'，替换现有看板接入':''}。此操作可撤销，不会接通业务数据。</p>{busy&&<p role="status">正在按需读取固定版本并检查场景区域…</p>}{error&&<Alert type="error" role="alert" title={error}/>}</Modal>
  </section>;
}
