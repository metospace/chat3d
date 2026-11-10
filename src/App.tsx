import {DashboardPage,DashboardSceneView} from './ui/DashboardPage';
import {AccessibleModal as Modal} from './ui/kit/AccessibleModal';
import {exportHtml} from './scene/exportHtml';
import './ui/studio/tokens.css';
import './ui/studio/product-structure.css';
import './ui/theme/legacy-tokens.css';
import './ui/theme/product.css';
import {usePublishUpdateContext} from './ui/appUpdateContext';
import {AppUpdateDialog, AppUpdateNotice} from './ui/AppUpdateNotice';
import {SaveToast,isLibrarySaveNotice} from './ui/SaveToast';
import {OperationProgress,nextProgressPaint,type OperationProgressProps} from './ui/OperationProgress';
import {StudioShell,StudioMain,type StudioNavPage} from './ui/studio';
import {useCompositionTool} from './ui/manualComposition';
import {useLibraryAssetDrag} from './ui/libraryAssetDrag';
import {PanelResize,usePanelWidth} from './ui/PanelResize';
import {useSelectionTool} from './ui/selectionTool';
import {DeleteSelectionAction} from './ui/DeleteSelectionAction';
import {ToolbarAction} from './ui/ToolbarAction';
import {makeId} from './util/ids';
import {ConversationResize,useConversationWidth} from './ui/ConversationResize';
import type {CSSProperties} from 'react';
import {CanvasAssetShelf,CanvasInspector,CanvasSelectionSummary,type CanvasPropertyTab} from './ui/CanvasPanels';
import {CanvasEmptyState} from './ui/CanvasEmptyState';
import {focusSceneObjects} from './scene/focus';
import {CursorArrowIcon,MoveIcon,RotateCounterClockwiseIcon,SizeIcon,EnterFullScreenIcon,ArrowLeftIcon} from '@radix-ui/react-icons';
import {AppearanceProvider} from './ui/Appearance';
import {ProjectLibrary} from './ui/ProjectLibrary';
import {TeamStudioPage} from './ui/TeamStudioPage';
import {LibraryProjectSaveDialog} from './ui/LibraryMetadataDialog';
import {AssetLibrary} from './ui/AssetLibrary';
import {probeServerRenderer} from './scene/serverCapture';
import {assertGlbSize,importGlb} from './scene/importGlb';
import {WorkspaceTools} from './ui/WorkspaceTools';
// React owns editor controls; the Three.js viewport remains document-driven.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatPanel } from './ui/ChatPanel';
import { SettingsDialog } from './ui/SettingsDialog';
import {modelingModule} from './modules/modeling';
const ViewportPanel=modelingModule.Viewport;
const ObjectTree=modelingModule.Objects;
const PropertiesPanel=modelingModule.Properties;
import { useEditorStore, useDisplayDoc } from './store';
import { exportGlb } from './scene/export';
import {Button,Tag,Dropdown,Popover,Spin,Drawer} from 'antd';
import {LayersIcon,ChevronDownIcon,GearIcon,CubeIcon,UploadIcon,DownloadIcon,Cross1Icon,CounterClockwiseClockIcon,ReloadIcon,MixerHorizontalIcon,ChatBubbleIcon} from '@radix-ui/react-icons';
import {TaskPanel} from './ui/TaskPanel';
import {SessionSidebar} from './ui/SessionSidebar';
import {StudioHome} from './ui/StudioHome';
import {TaskCenter,StudioSettings} from './ui/StudioPages';
import {downloadJson} from './util/downloadJson';
import {exportFile} from './util/exportFile';
import {initializeWorkspace,useWorkspaceStore,createSession,anySessionRunning,exportWorkspaceBackup} from './workspace';
import { MAX_PROJECT_BYTES, PROJECT_SIZE_ERROR, parseProjectFile, serializeProject } from './domain/project';
import {acquirePublishedCategory} from './domain/teamCategories';
import {activityProgress} from './domain/customerProgress';
import {workspaceRecovery} from './domain/workspaceRecovery';
import {assertLibraryReady} from './domain/libraryNavigation';

function CanvasDraftStatus(){
 const activity=useEditorStore(state=>state.lastRun);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const progress=activityProgress(activity,true,now);
 return <><Tag color="processing" data-phase={progress.phase} data-model-state={progress.modelState} title={progress.reviewNote}>{progress.phase||progress.modelState?progress.label:'AI 正在生成'}</Tag>{progress.modelEditAgeSeconds!==undefined&&<small aria-label="距上次模型修改">距上次模型修改 {progress.modelEditAgeSeconds} 秒</small>}</>;
}

export default function App() {
  const [taskQueueRequest,setTaskQueueRequest]=useState(0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const dirty = useEditorStore((s) => s.dirty);
  const revision = useEditorStore((s) => s.doc.revision);
  const nodeCount = useDisplayDoc().nodes.length;
  const aiStatus = useEditorStore((s) => s.aiStatus);
  const previewing = aiStatus === 'previewing';
  const locked = ['capturing', 'context', 'generating', 'validating', 'previewing', 'applying'].includes(aiStatus);
  const autosaveError = useEditorStore((s) => s.autosaveError);
  const fileRef = useRef<HTMLInputElement>(null);
  const modelFileRef=useRef<HTMLInputElement>(null);
  const assetFileRef=useRef<HTMLInputElement>(null);
  const [assetImportFile,setAssetImportFile]=useState<File>();
  const [projectNotice,updateProjectNotice]=useState('');
  const [projectNoticeTone,setProjectNoticeTone]=useState<'success'|'error'|'info'>('info');
  const setProjectNotice=useCallback((message:string,tone:'success'|'error'|'info'='info')=>{updateProjectNotice(message);setProjectNoticeTone(tone);},[]);
  const [exportNotice,setExportNotice]=useState<{message:string;tone?:'success'|'error'}|null>(null);
  const closeExportNotice=useCallback(()=>setExportNotice(null),[]);
  const [conflictDismissed,setConflictDismissed]=useState(false),[backupStatus,setBackupStatus]=useState(''),[backupBusy,setBackupBusy]=useState(false);
  async function backupConflict(){setBackupBusy(true);setBackupStatus('');try{await nextProgressPaint();setBackupStatus(await downloadJson(exportWorkspaceBackup(),'workspace'));}catch(e){setBackupStatus(e instanceof Error?e.message:String(e));}finally{setBackupBusy(false);}}
  const closeSaveNotice=useCallback(()=>setProjectNotice(''),[]);
  const saveNotice=isLibrarySaveNotice(projectNotice)&&!autosaveError;
  const [modulePage,setModulePage]=useState<StudioNavPage>('home');const [libraryRefresh,setLibraryRefresh]=useState(0);
  const [locatedIds,setLocatedIds]=useState<string[]>();
  function locateLibrary(kind:'asset'|'scene',ids:string[]){setLocatedIds(ids);setLibraryRefresh(value=>value+1);setModulePage(kind);}
  const [librarySaving,setLibrarySaving]=useState(false),[showLibrarySave,setShowLibrarySave]=useState(false);
  const hasAnimation=useEditorStore(state=>!!state.doc.animation?.tracks.length);
  const [dashboardOpen,setDashboardOpen]=useState(false);
  const dashboard=useEditorStore(s=>s.doc.dashboard);

  const [exporting, setExporting] = useState(false);
  const [exportProgress,setExportProgress]=useState<OperationProgressProps|null>(null);
  const [importProgress,setImportProgress]=useState<OperationProgressProps|null>(null);
  const importBusy=useRef(false);
  const htmlExportBusy=useRef(false);
  const downloadGlb = async () => {
    if(htmlExportBusy.current)return;
    htmlExportBusy.current=true;setExportNotice(null);setExporting(true);setExportProgress({title:'导出 GLB',stage:'选择保存位置'});
    const source=useEditorStore.getState().doc;
    try {
      await nextProgressPaint();
      const message=await exportFile(async()=>{
        setExportProgress({title:'导出 GLB',stage:'准备模型数据'});await nextProgressPaint();
        const data=await exportGlb(structuredClone(source),progress=>setExportProgress({title:'导出 GLB',stage:progress.stage==='geometry'?'构建导出模型':progress.stage==='textures'?'处理材质与贴图':'打包 GLB 文件',completed:progress.completed,total:progress.total}));
        setExportProgress({title:'导出 GLB',stage:'保存文件'});await nextProgressPaint();return data;
      },'glb','scenivo-model.glb');
      if(message)setExportNotice({message});
    } catch (e) { setExportNotice({message:`GLB 导出失败：${e instanceof Error ? e.message : String(e)}`,tone:'error'}); }
    finally { htmlExportBusy.current=false;setExporting(false);setExportProgress(null); }
  };
  const downloadHtml = async () => {
    if(htmlExportBusy.current)return;
    htmlExportBusy.current=true;setExportNotice(null);setExporting(true);setExportProgress({title:'导出 HTML',stage:'选择保存位置'});
    const state=useEditorStore.getState(),title=useWorkspaceStore.getState().sessions.find(s=>s.id===useWorkspaceStore.getState().activeId)?.title??'Scenivo 模型';
    const source=state.doc;
    try {
      await nextProgressPaint();
      const message=await exportFile(async()=>{
        setExportProgress({title:'导出 HTML',stage:'准备模型数据'});await nextProgressPaint();
        const html=await exportHtml(structuredClone(source),title,progress=>setExportProgress({title:'导出 HTML',stage:progress.stage==='geometry'?'构建导出模型':progress.stage==='textures'?'处理材质与贴图':'打包离线 HTML',completed:progress.completed,total:progress.total}));
        setExportProgress({title:'导出 HTML',stage:'保存文件'});await nextProgressPaint();return html;
      },'html',`scenivo-${source.projectId.slice(0,8)}.html`);
      if(message)setExportNotice({message});
    }catch(error){setExportNotice({message:`HTML 导出失败：${error instanceof Error?error.message:String(error)}`,tone:'error'});}
    finally{htmlExportBusy.current=false;setExporting(false);setExportProgress(null);}
  };
  const saveProject = async () => {
    if(htmlExportBusy.current)return;
    htmlExportBusy.current=true;setExportNotice(null);setExporting(true);setExportProgress({title:'下载项目 JSON',stage:'选择保存位置'});
    const source=useEditorStore.getState().doc;
    try {
      await nextProgressPaint();
      const message=await exportFile(async()=>{setExportProgress({title:'下载项目 JSON',stage:'序列化项目数据'});await nextProgressPaint();const json=serializeProject(source);setExportProgress({title:'下载项目 JSON',stage:'保存文件'});await nextProgressPaint();return json;},'json',`scenivo-${source.projectId.slice(0,8)}.chat3d.json`);
      if(message){if(useEditorStore.getState().doc===source)useEditorStore.getState().markSaved();setExportNotice({message});}
    } catch (e) { setExportNotice({message:`项目下载失败：${e instanceof Error ? e.message : String(e)}`,tone:'error'}); }
    finally{htmlExportBusy.current=false;setExporting(false);setExportProgress(null);}
  };
  const openProject = async (file: File) => {
    if(importBusy.current)return;
    importBusy.current=true;setProjectNotice('');setImportProgress({title:'导入项目',stage:'读取文件',detail:file.name});
    try {
      await nextProgressPaint();
      if (file.size > MAX_PROJECT_BYTES) throw new Error(PROJECT_SIZE_ERROR);
      const text=await file.text();setImportProgress({title:'导入项目',stage:'校验项目数据',detail:file.name});await nextProgressPaint();
      const {doc,teamCategoryPath}=parseProjectFile(text);
      const sceneCategory=teamCategoryPath===undefined?undefined:await acquirePublishedCategory('scene',teamCategoryPath);
      setImportProgress({title:'导入项目',stage:'创建项目会话',detail:file.name});await nextProgressPaint();
      assertLibraryReady();if (!createSession(doc,{moduleKind:'scene',sceneCategory})) throw new Error('无法新建场景项目，请重试');
      setModulePage('workbench');setProjectNotice(`已导入为新项目，共 ${doc.nodes.length} 个对象。尚未保存到场景库。`,'success');
    } catch (e) { setProjectNotice(`打开失败：${e instanceof Error ? e.message : String(e)}`,'error'); }
    finally{importBusy.current=false;setImportProgress(null);}
  };
  const openGlb=async(file:File)=>{
    if(importBusy.current)return;
    importBusy.current=true;setProjectNotice('');setImportProgress({title:'导入 GLB',stage:'读取文件',detail:file.name});
    try{
      await nextProgressPaint();assertGlbSize(file.size);const data=await file.arrayBuffer();
      const labels={checking:'校验文件结构',parsing:'解析网格与材质',converting:'转换模型部件',validating:'检查模型数据'};
      const result=await importGlb(data,file.name,async stage=>{setImportProgress({title:'导入 GLB',stage:labels[stage],detail:file.name});await nextProgressPaint();});
      setImportProgress({title:'导入 GLB',stage:'创建项目会话',detail:file.name});await nextProgressPaint();
      assertLibraryReady();if(!createSession(result.doc,{moduleKind:'asset',title:file.name.replace(/\.glb$/i,'')||'导入模型',assetCategory:'其他'}))throw Error('无法新建资产项目，请重试');
      setModulePage('workbench');useCompositionTool.setState({mode:'orbit'});setProjectNotice(`已导入为新资产项目，共 ${result.doc.nodes.length} 个网格部件。点击“保存资产”入资产库。${result.warnings.join(' ')}`,'success');
    }catch(error){setProjectNotice(`网格导入失败：${error instanceof Error?error.message:String(error)}`,'error');}
    finally{importBusy.current=false;setImportProgress(null);}
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (anySessionRunning() || useWorkspaceStore.getState().saving || !!useWorkspaceStore.getState().error || ['capturing','context','generating','validating','previewing'].includes(useEditorStore.getState().aiStatus)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const [autoStartRequest,setAutoStartRequest]=useState<{id:string;projectId:string;blenderModeling?:boolean}|null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTools,setShowTools]=useState(false);const [showHistory,setShowHistory]=useState(false),[historyTrash,setHistoryTrash]=useState(false);
  function openTrash(){setHistoryTrash(true);setShowHistory(true);}

  const workspace=useWorkspaceStore();
  const recovery=workspace.error?workspaceRecovery(workspace.error):undefined;
  useEffect(()=>{setConflictDismissed(false);setBackupStatus('');},[workspace.error]);
  const active=workspace.sessions.find(s=>s.id===workspace.activeId);
  const isAsset=active?.moduleKind==='asset',libraryName=isAsset?'资产库':'场景库',structureName=isAsset?'模型结构':'场景结构';
  const localSaveFailed=!!(workspace.error||autosaveError);
  const localSaveLabel=localSaveFailed?'本机草稿自动保存异常':workspace.saving?'本机草稿自动保存中':'本机草稿已自动保存';
  const librarySaveLabel=!active?.librarySavedAt?`尚未保存到${libraryName}`:active.savedRevision===revision?`已保存到${libraryName}`:`当前修改尚未保存到${libraryName}`;
  const [assetDialog,setAssetDialog]=useState<'insert'|'manage'>();
  const [assistantOpen,setAssistantOpen]=useState(true);
  const [assistantWidth,setAssistantWidth]=useConversationWidth();
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [objectsWidth,setObjectsWidth]=usePanelWidth('objects',240,200,360);
  const [inspectorWidth,setInspectorWidth]=usePanelWidth('inspector',280,260,400);
  const compositionMode=useCompositionTool(s=>s.mode);
  const placingAsset=useCompositionTool(s=>!!s.placement),draggingAsset=useLibraryAssetDrag(s=>!!s.drag);
  const [structureOpen,setStructureOpen]=useState(()=>window.innerWidth>1280),[shelfOpen,setShelfOpen]=useState(false),[advancedOpen,setAdvancedOpen]=useState(false);
  const [propertyTab,setPropertyTab]=useState<CanvasPropertyTab>('position');
  const selectionBox=useSelectionTool(s=>s.box),wholeModelBox=useSelectionTool(s=>s.wholeModel),throughBox=useSelectionTool(s=>s.through);
  const selection=useEditorStore(s=>s.selection);const viewportReady=useEditorStore(s=>s.viewportStatus==='ready');
  function openEditorPanel(panel:'asset'|'structure'|'inspector'){
    setInspectorOpen(panel==='inspector');setShelfOpen(panel==='asset');setStructureOpen(panel==='structure');

  }
  function openInspector(){openEditorPanel('inspector');}
  function toggleAssistant(){
    const next=!assistantOpen;setAssistantOpen(next);

  }
  function focusComposer(){setAssistantOpen(true);setFocusScene(false);requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="建模描述"]')?.focus());}
  useEffect(()=>{!selection.length&&setInspectorOpen(false)},[selection.join('|')]);
  const [taskDetailsOpen,setTaskDetailsOpen]=useState(false);
  const [focusScene,setFocusScene]=useState(false);
  const navigateStudio=useCallback((page:StudioNavPage)=>{setLocatedIds(undefined);setModulePage(page);setFocusScene(false);},[]);
  useEffect(()=>{void probeServerRenderer();void initializeWorkspace();},[]);
  useEffect(()=>{setTaskDetailsOpen(false);},[workspace.activeId]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setFocusScene(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{if(locked)setAssistantOpen(true);},[locked]);
  usePublishUpdateContext();

  /** antd menu model for the export / import actions. */
  const exportItems=[
    {key:'import-json',label:'导入项目 JSON',icon:<UploadIcon/>,onClick:()=>fileRef.current?.click()},
    {key:'import-glb',label:'导入 GLB 为新资产',icon:<CubeIcon/>,onClick:()=>modelFileRef.current?.click()},
    {type:'divider' as const},
    {key:'save-json',label:'下载项目 JSON',icon:<DownloadIcon/>,disabled:exporting,onClick:()=>void saveProject()},
    {key:'export-glb',label:exporting?'导出中…':hasAnimation?'导出静态 GLB（不含动画）':'导出模型 GLB',icon:<CubeIcon/>,disabled:exporting||nodeCount===0,onClick:()=>void downloadGlb()},
    {key:'export-html',label:exporting?'导出中…':hasAnimation?'导出静态 HTML（不含动画）':'导出模型 HTML',icon:<DownloadIcon/>,disabled:exporting||nodeCount===0,onClick:()=>void downloadHtml()},
    ...(hasAnimation?[{key:'animation-note',label:'保留动画：保存到库或下载项目 JSON / 工作台备份',disabled:true}]:[]),
    {type:'divider' as const},
    {key:'backup',label:'备份与恢复',icon:<GearIcon/>,onClick:()=>setShowTools(true)},
  ];

  return <AppearanceProvider>
    <div style={{'--objects-width':`${objectsWidth}px`,'--inspector-width':`${inspectorWidth}px`,'--chat-width':`${assistantWidth}px`,'--chat-space':assistantOpen?`${assistantWidth}px`:'0px','--navigator-width':`${inspectorOpen?inspectorWidth:structureOpen?objectsWidth:shelfOpen?300:0}px`} as CSSProperties} className={`studio redesigned-studio canvas-studio frosted-studio pro-v6 product-v3 ${modulePage==='workbench'?'editor-mode':'manager-mode'} ${focusScene?'focus-scene':''}`}>
      <StudioShell activePage={modulePage} disabled={librarySaving||!workspace.ready} taskQueueRequest={taskQueueRequest} onNavigate={navigateStudio} onTaskOpen={()=>{setModulePage('workbench');setFocusScene(false);setAssistantOpen(true);}} onTaskHistory={()=>{setModulePage('tasks');setFocusScene(false);}}>
      {workbenchUtilities=><StudioMain>

        <AppUpdateNotice onBackup={()=>setShowTools(true)}/>
        <aside className="feedback-rail" aria-label="操作反馈">
        {saveNotice&&!workspace.error&&<SaveToast message={projectNotice} onClose={closeSaveNotice} duration={0}/>}
        {exportNotice&&<SaveToast key={exportNotice.message} message={exportNotice.message} tone={exportNotice.tone} onClose={closeExportNotice} duration={exportNotice.tone==='error'?0:5000}/>}
        {exportProgress&&<OperationProgress key={exportProgress.title} {...exportProgress}/>}
        {importProgress&&<OperationProgress key={importProgress.title} {...importProgress}/>}
        {backupBusy&&<OperationProgress title="备份工作台" stage="打包项目并请求保存"/>}
        {workspace.error&&recovery&&!conflictDismissed&&<div role="alert" className="workspace-notice is-error"><div className="workspace-conflict-copy"><span>{workspace.error}</span><small>{recovery.guidance}</small>{backupStatus&&<span role="status">{backupStatus}</span>}</div><Button disabled={backupBusy} onClick={()=>void backupConflict()}>下载工作台备份</Button>{recovery.kind==='quota'&&<Button onClick={()=>setAssetDialog('manage')}>打开资产库备份</Button>}{recovery.kind==='recovery'&&<Button onClick={()=>setShowTools(true)}>备份与恢复</Button>}{recovery.refresh&&<Button type="primary" onClick={()=>window.location.reload()}>我已备份，刷新本页</Button>}<Button type="text" aria-label="隐藏保存异常提示" icon={<Cross1Icon/>} onClick={()=>setConflictDismissed(true)}/></div>}
        {!workspace.error&&autosaveError&&<div className="workspace-notice is-error" role="alert"><div className="workspace-conflict-copy"><span>自动保存失败</span><small>{autosaveError}</small></div><Button onClick={()=>setShowTools(true)}>备份与恢复</Button></div>}
        {!workspace.error&&projectNotice&&!saveNotice&&<SaveToast message={projectNotice} tone={projectNoticeTone} onClose={closeSaveNotice} duration={projectNoticeTone==='error'?0:5000}/>}
        </aside>
        {!workspace.ready&&<div className="workspace-loading"><Spin size="large"/><p>正在恢复项目…</p></div>}
        {workspace.ready&&<StudioHome onImport={()=>modelFileRef.current?.click()} onTasks={()=>setTaskQueueRequest(v=>v+1)} onConfigure={()=>setShowSettings(true)} onGenerate={(projectId,blenderModeling)=>setAutoStartRequest({id:makeId(),projectId,blenderModeling})} hidden={modulePage!=='home'} onOpen={()=>{setModulePage('workbench');setAssistantOpen(true);}}/>}
        {workspace.ready&&(modulePage==='asset'||modulePage==='scene')&&<ProjectLibrary key={modulePage+libraryRefresh} kind={modulePage} onOpen={()=>{setLocatedIds(undefined);setModulePage('workbench');setAssistantOpen(true);}} onManage={()=>setAssetDialog('manage')} onTrash={openTrash} onImport={()=>assetFileRef.current?.click()} locateIds={locatedIds} onLocate={locateLibrary}/>}
        {workspace.ready&&modulePage==='team'&&<TeamStudioPage onLocate={locateLibrary}/>}
        {workspace.ready&&modulePage==='dashboards'&&<DashboardPage onSceneLibrary={()=>navigateStudio('scene')}/>}
        {workspace.ready&&modulePage==='tasks'&&<TaskCenter locked={locked} onOpen={()=>{setModulePage('workbench');setAssistantOpen(true);}}/>}
        {workspace.ready&&modulePage==='settings'&&<StudioSettings onTeam={()=>setModulePage('team')} onModel={()=>setShowSettings(true)} onBackup={()=>setShowTools(true)} onAssets={()=>setAssetDialog('manage')} onHistory={()=>{setHistoryTrash(false);setShowHistory(true);}}/>}
        {workspace.ready&&<div className={`editor-workspace ${assistantOpen?'assistant-expanded':''} ${structureOpen||shelfOpen||inspectorOpen?'editor-panel-open':''} ${inspectorOpen?'inspector-expanded':''}`} hidden={modulePage!=='workbench'}>
        <header className="studio-header workbench-project-actions" hidden={modulePage!=='workbench'}>
          <Button className="workbench-back" type="text" aria-label="返回首页" icon={<ArrowLeftIcon/>} onClick={()=>navigateStudio('home')}/>
          <div className="workbench-project-summary"><strong title={active?.title}>{active?.title??'未命名项目'}</strong><span className="workbench-kind-tag">{isAsset?'资产':'场景'}</span><span className={`workbench-save-status ${localSaveFailed?'is-error':''}`}>{localSaveLabel}<span aria-hidden="true"> · </span>{librarySaveLabel}</span></div>
          <div className="workbench-history-controls" role="group" aria-label="编辑历史"><Button type="text" aria-label="撤销" title="撤销" disabled={!canUndo||locked} onClick={undo} icon={<CounterClockwiseClockIcon/>}/><Button type="text" aria-label="重做" title="重做" disabled={!canRedo||locked} onClick={redo} icon={<ReloadIcon/>}/></div>
          <div className="workbench-view-controls"/>
          <div className="workbench-document-controls" role="group" aria-label="项目操作"><Popover trigger="click" placement="bottomRight" content={<div role="dialog" aria-label="项目信息" className="workbench-project-info">
          <span className="canvas-project-title" title={active?.title}>{active?.title??'正在恢复工作台…'}</span>
          <Tag color={localSaveFailed?'error':workspace.saving?'warning':'default'} className="save-badge">{localSaveLabel}</Tag>
          {active?.assetSource&&<Tag color={(active.assetCatalogVersion??active.assetSource.version)>active.assetSource.version?'warning':'default'}>编辑 v{active.assetSource.version}{(active.assetCatalogVersion??0)>active.assetSource.version?` · 库内最新 v${active.assetCatalogVersion}，当前草稿未替换`:''}</Tag>}
          <span className="editor-save-state">{librarySaveLabel}</span></div>}><Button type="text" aria-label="项目状态" title={active?.title} icon={<LayersIcon/>}/></Popover>
          <Button type="text" className="workbench-assistant-toggle" title={assistantOpen?'收起 AI 助手':'打开 AI 助手'} aria-expanded={assistantOpen} aria-label={assistantOpen?'收起 AI 助手':'打开 AI 助手'} onClick={toggleAssistant} icon={<ChatBubbleIcon/>}/>
          <Button type="text" onClick={()=>setModulePage('dashboards')}>看板库</Button>
          {dashboard&&<Button type="text" onClick={()=>setDashboardOpen(true)}>查看看板</Button>}
          <Button type="text" aria-label="模型配置" icon={<GearIcon/>} onClick={()=>setShowSettings(true)}/>
          <Dropdown trigger={['click']} menu={{items:exportItems}} disabled={locked||!workspace.ready}><Button className="workbench-export" aria-label="导出与更多" disabled={locked||!workspace.ready}>导出 <ChevronDownIcon/></Button></Dropdown>
          <Button className="workbench-save" type="primary" aria-label={librarySaving?'正在保存…':active?.moduleKind==='asset'?'保存资产':'保存场景'} disabled={locked||librarySaving||!workspace.ready} onClick={()=>{if(active?.moduleKind==='asset'&&!useEditorStore.getState().doc.nodes.length){setProjectNotice('还没有可保存的模型。请先创建或导入模型，再保存到资产库。');setAssistantOpen(true);return;}setShowLibrarySave(true);}}>{librarySaving?'保存中…':active?.moduleKind==='asset'?'保存资产':'保存场景'}</Button>
          </div>
          {workbenchUtilities}
          <input ref={fileRef} type="file" accept=".json,.chat3d.json" className="hidden" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void openProject(file);}}/>
          <input ref={modelFileRef} type="file" accept=".glb" className="hidden" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void openGlb(file);}}/>
        </header>
        <nav className="canvas-tool-rail canvas-surface" aria-label="画布工具"><Button type="text" aria-pressed={shelfOpen} onClick={()=>shelfOpen?setShelfOpen(false):openEditorPanel('asset')} icon={<CubeIcon/>}><span>资产</span></Button><Button type="text" aria-pressed={structureOpen} onClick={()=>structureOpen?setStructureOpen(false):openEditorPanel('structure')} icon={<LayersIcon/>}><span>结构</span></Button><Button type="text" aria-pressed={inspectorOpen} disabled={!selection.length} onClick={()=>inspectorOpen?setInspectorOpen(false):openInspector()} icon={<MixerHorizontalIcon/>}><span>属性</span></Button></nav>
        {shelfOpen&&<CanvasAssetShelf onClose={()=>setShelfOpen(false)} onLibrary={()=>setAssetDialog('insert')}/>}
        <div className="editor-upper"><aside className="editor-objects canvas-surface" hidden={!structureOpen}><div className="editor-panel-heading">{structureName}<Button type="text" aria-label={`收起${structureName}`} icon={<Cross1Icon/>} onClick={()=>setStructureOpen(false)}/></div><ObjectTree/><PanelResize label="调整对象面板宽度" width={objectsWidth} min={200} max={360} side="right" onChange={setObjectsWidth}/></aside>
          <main className="scene-region">
            <div className="scene-stage"><ViewportPanel active={modulePage==='workbench'}/></div>
        <div className="canvas-transform-tools canvas-surface" role="group" aria-label={isAsset?'模型编辑工具':'场景编辑工具'}>
          {nodeCount>0&&<>
          <ToolbarAction label={isAsset?'浏览模型':'浏览场景'} help="左键拖动旋转视角，右键平移，滚轮缩放；单击选择不切换编辑模式" pressed={compositionMode==='orbit'&&!selectionBox} onPress={()=>{useSelectionTool.setState({box:false});useCompositionTool.setState({mode:'orbit'});}}><span>浏览</span></ToolbarAction>
          <ToolbarAction label="选择对象" help={`打开${structureName}，从列表中选择要编辑的对象`} onPress={()=>structureOpen?setStructureOpen(false):openEditorPanel('structure')}><CursorArrowIcon/><span>选择</span></ToolbarAction>
          <ToolbarAction pressed={selectionBox} label={selectionBox?'退出框选':'框选对象'} help="默认按可见表面框选；Shift / Ctrl / ⌘ 追加，Esc 取消。本次选择可在旁边开启穿透" disabled={!viewportReady||locked} disabledReason={!viewportReady?'三维视图不可用，可在结构列表中多选':'请先结束生成或处理预览'} onPress={()=>useSelectionTool.setState({box:!selectionBox})}><span aria-hidden="true">▧</span></ToolbarAction>
          {selectionBox&&<button className="box-selection-scope" aria-label={wholeModelBox?'框选范围：完整模型':'框选范围：零件'} title={wholeModelBox?'命中零件后扩展到完整模型，包含隐藏和框外成员':'仅选择框内命中的零件，不扩展同模型成员'} onClick={()=>useSelectionTool.setState({wholeModel:!wholeModelBox})}>{wholeModelBox?'框选模型':'框选零件'}</button>}
          {selectionBox&&<button className="box-selection-scope box-selection-through" aria-label="穿透框选" aria-pressed={throughBox} title={throughBox?'穿透已开启：包括被前方模型遮挡的几何；点击恢复可见表面框选':'穿透已关闭：只选最近几何表面（透明面按实体选取）；孔洞中的后方零件仍可能可见'} onClick={()=>useSelectionTool.setState({through:!throughBox})}>{throughBox?'穿透：开':'穿透：关'}</button>}
          <ToolbarAction label="移动选中对象" pressed={compositionMode==='move'} help="拖动选中对象或蓝色手柄移动；其他区域拖动浏览" disabled={!selection.length||locked} disabledReason={!selection.length?'请先选中一个或多个对象':previewing?'请先应用或放弃当前预览':'任务执行中，暂不能修改位置'} onPress={()=>{useSelectionTool.setState({box:false});useCompositionTool.setState({mode:'move'});setPropertyTab('position');openInspector()}}><MoveIcon/><span>移动</span></ToolbarAction>
          <ToolbarAction label="旋转选中对象" pressed={compositionMode==='rotate'} help="拖动选中对象或蓝色手柄旋转，或在属性中输入角度" disabled={!selection.length||locked} disabledReason={!selection.length?'请先选中一个或多个对象':previewing?'请先应用或放弃当前预览':'任务执行中，暂不能旋转对象'} onPress={()=>{useSelectionTool.setState({box:false});useCompositionTool.setState({mode:'rotate'});setPropertyTab('rotation');openInspector()}}><RotateCounterClockwiseIcon/><span>旋转</span></ToolbarAction>
          <ToolbarAction label="缩放选中对象" pressed={compositionMode==='scale'} help="拖动选中对象或蓝色手柄等比缩放，或在属性中输入倍数" disabled={!selection.length||locked} disabledReason={!selection.length?'请先选中一个或多个对象':previewing?'请先应用或放弃当前预览':'任务执行中，暂不能缩放对象'} onPress={()=>{useSelectionTool.setState({box:false});useCompositionTool.setState({mode:'scale'});setPropertyTab('size');openInspector()}}><SizeIcon/><span>缩放</span></ToolbarAction>
          <ToolbarAction label={isAsset?'适应模型':'适应场景'} help="完整显示当前内容" disabled={!nodeCount||!viewportReady} onPress={()=>focusSceneObjects(useEditorStore.getState().doc.nodes.map(n=>n.id))}><span>适应</span></ToolbarAction>
          <ToolbarAction label="聚焦选中对象" help="把镜头移动到选中内容附近，方便查看" disabled={!selection.length||!viewportReady} disabledReason={!selection.length?'请先选中一个或多个对象':'当前三维视图不可用'} onPress={()=>focusSceneObjects(selection)}><EnterFullScreenIcon/></ToolbarAction><span/>
          <DeleteSelectionAction active={workspace.ready&&modulePage==='workbench'} onNotice={setProjectNotice}/>
          </>}
          <ToolbarAction label={focusScene?'恢复工作台':isAsset?'专注模型':'专注场景'} help={focusScene?'恢复对话与编辑面板':'暂时收起周边面板，放大模型画布'} onPress={()=>setFocusScene(!focusScene)}><EnterFullScreenIcon/></ToolbarAction>
        </div>

            <div className="workbench-review-slot"/>{nodeCount>0&&<div className="canvas-context-label"><LayersIcon/>{previewing?'修改预览':locked?'正在处理草稿':active?.title??'三维视图'}<small>{nodeCount} 个零件 · m</small>{locked&&!previewing?<CanvasDraftStatus/>:<Tag color={previewing?'warning':undefined}>{previewing?'待确认预览':compositionMode==='move'?'移动对象':compositionMode==='rotate'?'旋转对象':compositionMode==='scale'?'缩放对象':selectionBox?'框选对象':isAsset?'浏览模型':'浏览场景'}</Tag>}</div>}
            {nodeCount===0&&!previewing&&viewportReady&&!placingAsset&&!draggingAsset&&<CanvasEmptyState busy={locked} asset={active?.moduleKind==='asset'} onConversation={focusComposer} onAssets={()=>openEditorPanel('asset')} onImport={()=>modelFileRef.current?.click()} onTask={()=>setTaskDetailsOpen(true)}/>}
            <footer className="scene-footer"><span className="mobile-editor-note">移动设备支持查看项目和任务；精确编辑请使用桌面设备。</span><span><span className="status-dot"/>{previewing?'预览尚未提交':locked?'正在处理草稿':isAsset?'可编辑模型':'可编辑场景'}</span><span>单位 m · Y 轴向上</span>{dirty&&<span>当前修改尚未下载为项目文件</span>}</footer>
          </main>
          {!inspectorOpen&&<CanvasSelectionSummary onEdit={()=>openInspector()}/>}
          {inspectorOpen&&selection.length>0&&<CanvasInspector resize={<PanelResize label="调整属性面板宽度" width={inspectorWidth} min={260} max={400} side="right" onChange={setInspectorWidth}/>} onClose={()=>setInspectorOpen(false)} onAdvanced={()=>setAdvancedOpen(true)} tab={propertyTab} setTab={setPropertyTab}/>}

        </div>
          <aside className="conversation-region" aria-label="AI 助手" hidden={!assistantOpen}><ConversationResize width={assistantWidth} onChange={setAssistantWidth}/><header className="conversation-panel-title"><strong><ChatBubbleIcon/>AI 助手</strong><div><Button className="task-record-button" type="text" size="small" aria-label="本项目任务记录" onClick={()=>setTaskDetailsOpen(true)}>任务记录</Button><Button className="close-conversation-button" type="text" aria-label="收起对话区" icon={<Cross1Icon/>} onClick={()=>setAssistantOpen(false)}/></div></header><div id="chat-content" className="assistant-content"><ChatPanel autoStartRequest={autoStartRequest} onAutoStartConsumed={id=>setAutoStartRequest(current=>current?.id===id?null:current)} key={workspace.activeId} canvasMode expanded onExpand={()=>setAssistantOpen(true)} executionDetails={false} onConfigure={()=>setShowSettings(true)} onDashboardOpen={()=>setDashboardOpen(true)}/></div></aside>
        </div>}
      </StudioMain>}
      </StudioShell>
      <Drawer open={taskDetailsOpen} onClose={()=>setTaskDetailsOpen(false)} title="本项目任务记录" size={480}><TaskPanel onConversation={()=>setTaskDetailsOpen(false)}/></Drawer>
      {dashboardOpen&&<DashboardSceneView onClose={()=>setDashboardOpen(false)}/>}
      {advancedOpen&&<Modal open title="对象与属性" onCancel={()=>setAdvancedOpen(false)} width={640} footer={<Button onClick={()=>setAdvancedOpen(false)}>关闭高级属性</Button>}><p>精确编辑几何参数、外观和组件关系。</p><PropertiesPanel/></Modal>}
      {showLibrarySave&&<LibraryProjectSaveDialog onClose={()=>setShowLibrarySave(false)} onBusyChange={setLibrarySaving} onSaved={notice=>{setProjectNotice(notice);setLibraryRefresh(v=>v+1);}}/>}
      <input ref={assetFileRef} type="file" accept=".json,.chat3d-asset.json" hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file){setAssetImportFile(file);setAssetDialog('manage');}}}/>
      {assetDialog&&<AssetLibrary initialImportFile={assetImportFile} intent={assetDialog} targetName={active?.title} onClose={()=>{setAssetDialog(undefined);setAssetImportFile(undefined);setLibraryRefresh(v=>v+1);}}/>}
      {showHistory&&<Modal open title="项目与回收站" onCancel={()=>setShowHistory(false)} width={600} footer={<Button type="primary" onClick={()=>{setShowHistory(false);setModulePage('workbench');}}>进入选中项目</Button>}><p>历史项目仍保留，可重命名、恢复或继续编辑。</p><div className="history-management"><SessionSidebar initialTrash={historyTrash} locked={locked} onClose={()=>{setShowHistory(false);setModulePage('workbench');}}/></div></Modal>}
      {showTools&&<WorkspaceTools onClose={()=>setShowTools(false)}/>}
      {showSettings&&<SettingsDialog onClose={()=>setShowSettings(false)}/>}
      <AppUpdateDialog/>
    </div>
  </AppearanceProvider>;
}
