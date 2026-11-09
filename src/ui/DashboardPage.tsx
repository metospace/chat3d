import {DashboardRegionEditor} from './DashboardRegionEditor';
import {DashboardCardPreview} from './DashboardCardPreview';
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Alert,Button,Dropdown,Empty,Input,InputNumber,Modal,Select,Spin,Switch,Tag} from 'antd';
import {CodeIcon,DashboardIcon,DotsHorizontalIcon,DownloadIcon,LayersIcon,MagnifyingGlassIcon,ReloadIcon,UploadIcon} from '@radix-ui/react-icons';
import {getTeamSession,subscribeTeamSession} from '../domain/teamLibrary';
import {DEFAULT_DASHBOARD_VIEW,dashboardBinding,downloadDashboardSource,listDashboards,readDashboard,validDashboardRegion,type DashboardItem,type DashboardVersion,type DashboardView,type DashboardRegion} from '../domain/dashboard';
import {useEditorStore} from '../store';
import {exportHtml,withHtmlViewerView} from '../scene/exportHtml';
import {buildDashboardExport,inspectDashboardPlacement} from '../scene/dashboardRuntime';
import {exportFile} from '../util/exportFile';
import {DashboardPresentation} from './DashboardPresentation';
import {DashboardUploadDialog} from './DashboardUploadDialog';
import './dashboard.css';

function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}

export function DashboardSceneView({onClose}:{onClose:()=>void}) {
  const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession);
  const doc=useEditorStore(state=>state.doc),binding=doc.dashboard;
  const [value,setValue]=useState<DashboardVersion>();
  const [scene,setScene]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [exporting,setExporting]=useState(false),[adjusting,setAdjusting]=useState(false),[editingRegion,setEditingRegion]=useState(false),[measuring,setMeasuring]=useState(false);
  const [draft,setDraft]=useState<DashboardView>({...DEFAULT_DASHBOARD_VIEW,...binding?.view});
  const [previewView,setPreviewView]=useState(draft);
  const [region,setRegion]=useState<DashboardRegion|undefined>(binding?.region),[previewRegion,setPreviewRegion]=useState(region);
  useEffect(()=>{const next={...DEFAULT_DASHBOARD_VIEW,...binding?.view};setDraft(next);setPreviewView(next);setRegion(binding?.region);setPreviewRegion(binding?.region);},[binding?.view,binding?.region]);
  useEffect(()=>{
    let alive=true;setError('');setValue(undefined);setScene('');
    if(!binding)return;
    void(async()=>{
      if(!client?.user||client.base!==binding.service)throw Error('请登录绑定模板所属的团队服务：'+binding.service);
      const [template,html]=await Promise.all([readDashboard(client,binding.templateId,binding.version),exportHtml(doc,binding.name,undefined,{embedded:true})]);
      if(alive){setValue(template);setScene(html);}
    })().catch(reason=>{if(alive)setError(errorMessage(reason));});
    return()=>{alive=false;};
  },[client,doc.projectId,doc.nodes,doc.materials,doc.assets,binding?.service,binding?.templateId,binding?.version]);
  const adjustedScene=useMemo(()=>scene?withHtmlViewerView(scene,previewView):'',[scene,previewView]);
  const previewBinding=useMemo(()=>binding?{...binding,region:previewRegion}:undefined,[binding,previewRegion]);
  const changed=JSON.stringify(draft)!==JSON.stringify({...DEFAULT_DASHBOARD_VIEW,...binding?.view})||JSON.stringify(region)!==JSON.stringify(binding?.region);
  const regionValid=region===undefined||validDashboardRegion(region);
  const download=async()=>{if(!value||!scene||!binding||exporting||!regionValid)return;setExporting(true);try{await exportFile(()=>buildDashboardExport(value.package,{...binding,view:draft,region},withHtmlViewerView(scene,draft)),'html','scenivo-dashboard.html');}catch(reason){setNotice(errorMessage(reason));}finally{setExporting(false);}};
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
  return <Modal open centered className="dashboard-scene-modal" title={binding?`${binding.name} · v${binding.version}`:'未接入看板'} onCancel={onClose} width={adjusting?'min(95vw, calc((100dvh - 330px) * 16 / 9 + 48px))':'min(95vw, calc((100dvh - 170px) * 16 / 9 + 48px))'} footer={<><Button disabled={!value||!scene||!regionValid} loading={exporting} onClick={()=>void download()}>导出组合大屏 HTML</Button><Button onClick={onClose}>关闭</Button></>}>
    <div className="dashboard-view-toolbar"><span>{editingRegion?'拖动移动，拉动边角缩放；完成后自动保存':'16:9 等比看板 · 数据面板位于三维模型上层'}</span><div><Button aria-expanded={adjusting} onClick={()=>{setAdjusting(!adjusting);setEditingRegion(false);}}>调整模型</Button>{binding?.mode==='dashboard'&&<Button disabled={!value} loading={measuring} aria-pressed={editingRegion} onClick={()=>{setAdjusting(false);void editRegion();}}>{editingRegion?'完成区域编辑':'编辑三维区域'}</Button>}</div></div>
    {adjusting&&<section className="dashboard-view-adjustments" aria-label="模型显示设置">
      {adjusting&&<div className="dashboard-view-fields">{fields.map(field=><label key={field.key}>{field.label}<InputNumber aria-label={field.label} min={field.min} max={field.max} step={field.key==='zoom'?5:1} suffix={field.unit} value={Math.round(draft[field.key]*field.factor)} onChange={number=>{if(number===null||!Number.isFinite(number))return;setNotice('');setDraft(previous=>previous[field.key]===number/field.factor?previous:{...previous,[field.key]:number/field.factor});}}/></label>)}</div>}
      <div className="dashboard-view-actions"><Button onClick={()=>{setDraft({...DEFAULT_DASHBOARD_VIEW});setPreviewView({...DEFAULT_DASHBOARD_VIEW});setRegion(undefined);setPreviewRegion(undefined);}}>恢复自动适配</Button><Button disabled={!regionValid} onClick={preview}>预览调整</Button><Button type="primary" disabled={!changed||!regionValid} onClick={save}>保存显示设置</Button></div>
    </section>}
    {notice&&<Alert role="status" type="info" title={notice} closable onClose={()=>setNotice('')}/>}
    <div className="dashboard-scene-modal-content">{error?<Alert type="error" role="alert" title={error}/>:value&&adjustedScene&&previewBinding?<><DashboardPresentation pack={value.package} binding={previewBinding} sceneHtml={adjustedScene}/>{editingRegion&&region&&regionValid&&<DashboardRegionEditor region={region} onChange={next=>{setRegion(next);setNotice('');}}/>}</>:binding?<div className="dashboard-loading" role="status"><Spin/><span>正在载入已接入的固定版本…</span></div>:<Empty description="当前场景尚未接入看板"/>}</div>
  </Modal>;
}

export function DashboardPage(){
  const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession);
  const admin=client?.user?.role==='admin';
  const binding=useEditorStore(state=>state.doc.dashboard);
  const [items,setItems]=useState<DashboardItem[]>([]);
  const [query,setQuery]=useState(''),[systemFilter,setSystemFilter]=useState('');
  const [all,setAll]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(''),[error,setError]=useState('');
  const [upload,setUpload]=useState<{target?:DashboardItem}>();
  const [selected,setSelected]=useState<DashboardVersion>();
  const [viewer,setViewer]=useState(false);
  const request=useRef(0),actionLock=useRef(false),detail=useRef<HTMLElement>(null);

  async function refresh() {
    if(!client?.user)return;
    const current=++request.current;
    setLoading(true);setError('');
    try{const values=await listDashboards(client,admin&&all);if(current===request.current)setItems(values);}
    catch(reason){if(current===request.current)setError(errorMessage(reason));}
    finally{if(current===request.current)setLoading(false);}
  }
  useEffect(()=>{
    setItems([]);setSelected(undefined);setUpload(undefined);setSystemFilter('');setNotice('');setError('');
    if(client?.user)void refresh();else setLoading(false);
    return()=>{request.current++;};
  },[client,all]);
  useEffect(()=>{if(selected)detail.current?.scrollIntoView({behavior:'smooth',block:'start'});},[selected]);
  async function action(work:()=>Promise<void>) {
    if(actionLock.current)return;
    actionLock.current=true;setBusy(true);setError('');setNotice('');
    try{await work();}catch(reason){setError(errorMessage(reason));}
    finally{actionLock.current=false;setBusy(false);}
  }
  async function choose(item:DashboardItem) {
    if(!client)return;
    const result=await readDashboard(client,item.id,item.version);
    setSelected(result);
  }
  const previewBinding=selected&&client?dashboardBinding(client.base,selected,'dashboard'):undefined;
  const systems=Array.from(new Set(items.map(item=>item.system))).filter(Boolean).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const needle=query.trim().toLocaleLowerCase();
  const visible=items.filter(item=>(!systemFilter||item.system===systemFilter)&&`${item.name} ${item.description} ${item.system} ${item.fileName}`.toLocaleLowerCase().includes(needle));
  const activeCount=items.filter(item=>!item.archived).length;
  const working=busy||loading;

  return <section className="dashboard-page" aria-label="看板模板库">
    <header className="dashboard-page-header">
      <div><div className="dashboard-page-eyebrow"><DashboardIcon/>团队看板</div><h1>看板接入</h1><p>查看与管理大屏模板。接入场景请在工作台对话输入 /看板，选择所需模板。</p></div>
      {client?.user&&admin&&<Button type="primary" size="large" icon={<UploadIcon/>} onClick={()=>setUpload({})}>上传看板模板</Button>}
    </header>
    {!client?.user?<div className="dashboard-empty"><span className="dashboard-empty-symbol"><DashboardIcon/></span><h2>登录后访问团队看板</h2><p>请通过左下角账户登录团队服务，查看看板模板。</p></div>:<>
      <div className="dashboard-stats" aria-label="看板概览">
        <div><strong>{activeCount}</strong><span>可用模板</span></div><div><strong>{systems.length}</strong><span>所属系统</span></div><div><strong>{binding?'已接入':'未接入'}</strong><span>当前场景</span></div>
        <p><LayersIcon/>版本固定，发布新版不会覆盖已有场景</p>
      </div>
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
        {loading?<div className="dashboard-loading" role="status"><Spin/><span>正在读取看板模板…</span></div>:visible.length?<div className="dashboard-template-grid">
          {visible.map(item=><article key={item.id} className={`dashboard-template-card${selected?.id===item.id?' is-selected':''}${item.archived?' is-archived':''}`} aria-label={`看板模板 ${item.name}`}>
            <DashboardCardPreview client={client} item={item} disabled={working} onOpen={()=>void action(()=>choose(item))}/>
            <div className="dashboard-template-topline">
              <span className="dashboard-template-icon"><DashboardIcon/></span>
              <div className="dashboard-template-tags">
                <Tag>{item.system}</Tag><Tag>v{item.version}</Tag>{item.archived&&<Tag>已下架</Tag>}
              </div>
              {admin&&<Dropdown trigger={['click']} menu={{items:[
                {key:'version',label:'发布新版',onClick:()=>setUpload({target:item})},
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
              <Button type="primary" ghost disabled={working} onClick={()=>void action(()=>choose(item))}>查看模板</Button>
              <Button icon={<DownloadIcon/>} disabled={working} onClick={()=>void action(async()=>{
                if(client)setNotice(await downloadDashboardSource(client,item)??'已取消导出');
              })}>导出源码</Button>
            </div>
          </article>)}
        </div>:<div className="dashboard-empty"><span className="dashboard-empty-symbol"><DashboardIcon/></span><h3>{query||systemFilter?'没有匹配的看板模板':error?'暂时无法读取模板':'还没有看板模板'}</h3><p>{query||systemFilter?'试试其他关键词或系统，或清除筛选条件。':error?'请检查团队服务连接后重试。':'上传已有静态大屏，保留源码与版本，再选择场景接入。'}</p>{query||systemFilter?<Button onClick={()=>{setQuery('');setSystemFilter('');}}>清除筛选</Button>:!error&&admin?<Button type="primary" icon={<UploadIcon/>} onClick={()=>setUpload({})}>上传第一个看板模板</Button>:null}</div>}
      </section>
      <div className="dashboard-security-note"><CodeIcon/><p>静态源码在隔离环境中运行，不执行服务端构建，不共享登录信息。接入模板仅组合展示，不代表已接通业务数据。</p></div>
      {selected&&previewBinding&&<section ref={detail} className="dashboard-connection" aria-labelledby="dashboard-connection-title">
        <header className="dashboard-connection-heading">
          <div>
            <span className="dashboard-page-eyebrow">模板预览</span>
            <h2 id="dashboard-connection-title">{selected.name} <Tag>v{selected.version}</Tag></h2>
            <p>这里只查看原模板。接入当前场景请在工作台对话输入 /看板 并选择模板。</p>
          </div>
          <Button type="text" onClick={()=>setSelected(undefined)}>关闭预览</Button>
        </header>
        <div className="dashboard-template-preview"><DashboardPresentation pack={selected.package} binding={previewBinding}/></div>
        <p className="dashboard-command-hint">在工作台对话输入 <code>/看板</code>，从模板列表选择后接入当前场景。</p>
      </section>}
      {upload&&<DashboardUploadDialog client={client} target={upload.target} systems={systems} onClose={()=>setUpload(undefined)} onPublished={()=>{setUpload(undefined);setNotice('看板模板已发布，已有场景继续使用原固定版本');void refresh();}}/>}
    </>}
    {viewer&&<DashboardSceneView onClose={()=>setViewer(false)}/>}
  </section>;
}
