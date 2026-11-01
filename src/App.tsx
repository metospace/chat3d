import {usePublishUpdateContext} from './ui/appUpdateContext';
import {AppUpdateDialog, AppUpdateNotice} from './ui/AppUpdateNotice';
import {SaveToast,isLibrarySaveNotice} from './ui/SaveToast';
import {StudioShell,StudioMain,type StudioNavPage} from './ui/studio';
import {useSelectionTool} from './ui/selectionTool';
import {DeleteSelectionAction} from './ui/DeleteSelectionAction';
import {ToolbarAction} from './ui/ToolbarAction';
import {makeId} from './util/ids';
import {ConversationResize,useConversationWidth} from './ui/ConversationResize';
import type {CSSProperties} from 'react';
import {CanvasAssetShelf,CanvasInspector,CanvasSelectionSummary,type CanvasPropertyTab} from './ui/CanvasPanels';
import {focusSceneObjects} from './scene/focus';
import {CursorArrowIcon,MoveIcon,RotateCounterClockwiseIcon,SizeIcon,EnterFullScreenIcon,ArrowLeftIcon} from '@radix-ui/react-icons';
import {AppearanceProvider} from './ui/Appearance';
import {ProjectLibrary} from './ui/ProjectLibrary';
import {TeamStudioPage} from './ui/TeamStudioPage';
import {LibraryProjectSaveDialog} from './ui/LibraryMetadataDialog';
import {AssetLibrary} from './ui/AssetLibrary';
import {probeServerRenderer} from './scene/serverCapture';
import {importGlb} from './scene/importGlb';
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
import {Button,Tag,Dropdown,Popover,Spin,Modal} from 'antd';
import {LayersIcon,ChevronDownIcon,GearIcon,CubeIcon,UploadIcon,DownloadIcon,Cross1Icon,CounterClockwiseClockIcon,ReloadIcon,MixerHorizontalIcon,ChatBubbleIcon} from '@radix-ui/react-icons';
import './ui/theme/legacy-tokens.css';
import './workspace.css';
import {TaskPanel} from './ui/TaskPanel';
import {SessionSidebar} from './ui/SessionSidebar';
import {StudioHome} from './ui/StudioHome';
import {TaskCenter,StudioSettings} from './ui/StudioPages';
import './studio-redesign.css';
import './ui-system.css';
import './canvas-studio.css';
import './canvas-conversation.css';
import './option2.css';
import './frosted-studio.css';
import './creative-gallery.css';
import './studio-control-polish.css';
import './graphite-controls.css';
import './thumbnail-layout.css';
import './settings-refresh.css';
import './ui/studio/tokens.css';
import './ui/studio/studio-shell.css';
import './ui/studio/studio-home.css';
import './ui/studio/studio-pages.css';
import './ui/studio/studio-workbench.css';
import './ui/studio/studio-shared.css';
import './ui/studio/studio-account.css';
import './ui/theme/app-shell.css';
import {downloadJson} from './util/downloadJson';
import {exportFile} from './util/exportFile';
import {initializeWorkspace,useWorkspaceStore,createSession,anySessionRunning,exportWorkspaceBackup} from './workspace';
import { MAX_PROJECT_BYTES, parseProject, serializeProject } from './domain/project';

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
  const [projectNotice, setProjectNotice] = useState('');
  const [exportNotice,setExportNotice]=useState<{message:string}|null>(null);
  const closeExportNotice=useCallback(()=>setExportNotice(null),[]);
  const [conflictDismissed,setConflictDismissed]=useState(false),[backupStatus,setBackupStatus]=useState(''),[backupBusy,setBackupBusy]=useState(false);
  async function backupConflict(){setBackupBusy(true);setBackupStatus('');try{setBackupStatus(await downloadJson(exportWorkspaceBackup(),'workspace'));}catch(e){setBackupStatus(e instanceof Error?e.message:String(e));}finally{setBackupBusy(false);}}
  const closeSaveNotice=useCallback(()=>setProjectNotice(''),[]);
  const saveNotice=isLibrarySaveNotice(projectNotice)&&!autosaveError;
  const [modulePage,setModulePage]=useState<StudioNavPage>('home');const [libraryRefresh,setLibraryRefresh]=useState(0);
  const [librarySaving,setLibrarySaving]=useState(false),[showLibrarySave,setShowLibrarySave]=useState(false);

  const [exporting, setExporting] = useState(false);
  const downloadGlb = async () => {
    setExportNotice(null);
    setExporting(true);
    try {
      const data = await exportGlb(structuredClone(useEditorStore.getState().doc));
      const message=await exportFile(data,'glb','scenivo-model.glb');
      if(message)setExportNotice({message});
    } catch (e) { setExportNotice({message:`GLB 导出失败：${e instanceof Error ? e.message : String(e)}`}); }
    finally { setExporting(false); }
  };
  const downloadHtml = async () => {
    setExportNotice(null);
    setExporting(true);
    try {
      const state=useEditorStore.getState(),title=useWorkspaceStore.getState().sessions.find(s=>s.id===useWorkspaceStore.getState().activeId)?.title??'Scenivo 模型';
      const snapshot=structuredClone(state.doc);
      const {exportHtml}=await import('./scene/exportHtml');
      const html=await exportHtml(snapshot,title);
      const message=await exportFile(html,'html',`scenivo-${state.doc.projectId.slice(0,8)}.html`);
      if(message)setExportNotice({message});
    }catch(error){setExportNotice({message:`HTML 导出失败：${error instanceof Error?error.message:String(error)}`});}
    finally{setExporting(false);}
  };
  const saveProject = async () => {
    setExportNotice(null);
    setExporting(true);
    try {
      const doc = useEditorStore.getState().doc;
      const message=await exportFile(serializeProject(doc),'json',`scenivo-${doc.projectId.slice(0,8)}.chat3d.json`);
      if(message){useEditorStore.getState().markSaved();setExportNotice({message});}
    } catch (e) { setExportNotice({message:`项目下载失败：${e instanceof Error ? e.message : String(e)}`}); }
    finally{setExporting(false);}
  };
  const openProject = async (file: File) => {
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('项目文件超过 20 MB');
      const doc = parseProject(await file.text());
      if (!createSession(doc)) throw new Error('请先完成当前操作，或检查会话存储状态');
      setProjectNotice(`已导入新会话，共 ${doc.nodes.length} 个对象`);
    } catch (e) { setProjectNotice(`打开失败：${e instanceof Error ? e.message : String(e)}`); }
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (anySessionRunning() || useWorkspaceStore.getState().saving || !!useWorkspaceStore.getState().error || ['capturing','context','generating','validating','previewing'].includes(useEditorStore.getState().aiStatus)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const [autoStartRequest,setAutoStartRequest]=useState<{id:string;projectId:string}|null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTools,setShowTools]=useState(false);const [showHistory,setShowHistory]=useState(false);

  const workspace=useWorkspaceStore();
  useEffect(()=>{setConflictDismissed(false);setBackupStatus('');},[workspace.error]);
  const active=workspace.sessions.find(s=>s.id===workspace.activeId);
  const [showAssets,setShowAssets]=useState(false);
  const [assistantOpen,setAssistantOpen]=useState(true);
  const [assistantWidth,setAssistantWidth]=useConversationWidth();
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [structureOpen,setStructureOpen]=useState(false),[shelfOpen,setShelfOpen]=useState(false),[advancedOpen,setAdvancedOpen]=useState(false);
  const [propertyTab,setPropertyTab]=useState<CanvasPropertyTab>('position');
  const selectionBox=useSelectionTool(s=>s.box),wholeModelBox=useSelectionTool(s=>s.wholeModel),throughBox=useSelectionTool(s=>s.through);
  const selection=useEditorStore(s=>s.selection);const viewportReady=useEditorStore(s=>s.viewportStatus==='ready');
  function openEditorPanel(panel:'asset'|'structure'|'inspector'){
    setShelfOpen(panel==='asset');setStructureOpen(panel==='structure');setInspectorOpen(panel==='inspector');
    if(window.innerWidth<1200)setAssistantOpen(false);
  }
  function openInspector(){openEditorPanel('inspector');}
  function toggleAssistant(){
    const next=!assistantOpen;setAssistantOpen(next);setAssistantTab('chat');
    if(next&&window.innerWidth<1200){setShelfOpen(false);setStructureOpen(false);setInspectorOpen(false);}
  }
  useEffect(()=>{
    const resize=()=>{if(window.innerWidth<1200&&(shelfOpen||structureOpen||inspectorOpen))setAssistantOpen(false);};
    resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[shelfOpen,structureOpen,inspectorOpen]);
  useEffect(()=>{!selection.length&&setInspectorOpen(false)},[selection.join('|')]);
  const [assistantTab,setAssistantTab]=useState<'chat'|'tasks'>('chat');
  const [focusScene,setFocusScene]=useState(false);
  const navigateStudio=useCallback((page:StudioNavPage)=>{setModulePage(page);setFocusScene(false);},[]);
  useEffect(()=>{void probeServerRenderer();void initializeWorkspace();},[]);
  useEffect(()=>{setAssistantTab('chat');},[workspace.activeId]);
  useEffect(()=>{setProjectNotice('');},[modulePage]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setFocusScene(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{if(locked){setAssistantOpen(true);if(window.innerWidth<1200){setShelfOpen(false);setStructureOpen(false);setInspectorOpen(false);}}},[locked]);
  usePublishUpdateContext();

  /** antd menu model for the export / import actions. */
  const exportItems=[
    {key:'import-json',label:'导入项目 JSON',icon:<UploadIcon/>,onClick:()=>fileRef.current?.click()},
    {key:'import-glb',label:'导入模型 GLB',icon:<CubeIcon/>,onClick:()=>modelFileRef.current?.click()},
    {type:'divider' as const},
    {key:'save-json',label:'下载项目 JSON',icon:<DownloadIcon/>,disabled:exporting,onClick:()=>void saveProject()},
    {key:'export-glb',label:exporting?'导出中…':'导出模型 GLB',icon:<CubeIcon/>,disabled:exporting||nodeCount===0,onClick:()=>void downloadGlb()},
    {key:'export-html',label:exporting?'导出中…':'导出模型 HTML',icon:<DownloadIcon/>,disabled:exporting||nodeCount===0,onClick:()=>void downloadHtml()},
    {type:'divider' as const},
    {key:'backup',label:'备份与恢复',icon:<GearIcon/>,onClick:()=>setShowTools(true)},
  ];

  return <AppearanceProvider>
    <div style={{'--chat-width':`${assistantWidth}px`,'--chat-space':assistantOpen?`${assistantWidth}px`:'0px'} as CSSProperties} className={`studio redesigned-studio canvas-studio frosted-studio ${modulePage==='workbench'?'editor-mode':'manager-mode'} ${focusScene?'focus-scene':''}`}>
      <StudioShell activePage={modulePage} disabled={librarySaving||!workspace.ready} taskQueueRequest={taskQueueRequest} onNavigate={navigateStudio} onTaskOpen={()=>{setModulePage('workbench');setFocusScene(false);setAssistantOpen(true);setAssistantTab('chat');}} onTaskHistory={()=>{setModulePage('tasks');setFocusScene(false);}}/>
      <StudioMain>

        <AppUpdateNotice onBackup={()=>setShowTools(true)}/>
        {saveNotice&&!workspace.error&&<SaveToast message={projectNotice} onClose={closeSaveNotice}/>}
        {exportNotice&&<SaveToast key={exportNotice.message} message={exportNotice.message} onClose={closeExportNotice} duration={4000} verbatim/>}
        {workspace.error&&!conflictDismissed&&<div role="alert" className="workspace-notice is-error"><div className="workspace-conflict-copy"><span>{workspace.error}</span><small>请关闭其他标签页，下载备份后刷新本页。</small>{backupStatus&&<span role="status">{backupStatus}</span>}</div><Button disabled={backupBusy} onClick={()=>void backupConflict()}>下载工作台备份</Button><Button type="primary" onClick={()=>window.location.reload()}>我已备份，刷新本页</Button><Button type="text" aria-label="隐藏冲突提示" icon={<Cross1Icon/>} onClick={()=>setConflictDismissed(true)}/></div>}
        {!workspace.error&&(autosaveError||(projectNotice&&!saveNotice))&&<div role="status" className={`workspace-notice ${autosaveError?'is-error':''}`}><span>{autosaveError||projectNotice}</span>{!autosaveError&&<Button type="text" aria-label="关闭通知" icon={<Cross1Icon/>} onClick={()=>setProjectNotice('')}/>}</div>}
        {!workspace.ready&&<div className="workspace-loading"><Spin size="large"/><p>正在恢复项目…</p></div>}
        {workspace.ready&&<StudioHome onTasks={()=>setTaskQueueRequest(v=>v+1)} onConfigure={()=>setShowSettings(true)} onGenerate={projectId=>setAutoStartRequest({id:makeId(),projectId})} hidden={modulePage!=='home'} onOpen={()=>{setModulePage('workbench');setAssistantOpen(true);setAssistantTab('chat');}} onLibrary={setModulePage}/>}
        {workspace.ready&&(modulePage==='asset'||modulePage==='scene')&&<ProjectLibrary key={modulePage+libraryRefresh} kind={modulePage} onOpen={()=>{setModulePage('workbench');setAssistantOpen(true);}} onManage={()=>setShowAssets(true)}/>}
        {workspace.ready&&modulePage==='team'&&<TeamStudioPage onCopied={()=>setLibraryRefresh(v=>v+1)}/>}
        {workspace.ready&&modulePage==='tasks'&&<TaskCenter locked={locked} onOpen={()=>{setModulePage('workbench');setAssistantOpen(true);setAssistantTab('chat');}}/>}
        {workspace.ready&&modulePage==='settings'&&<StudioSettings onModel={()=>setShowSettings(true)} onBackup={()=>setShowTools(true)} onAssets={()=>setShowAssets(true)} onHistory={()=>setShowHistory(true)}/>}
        {workspace.ready&&<div className={`editor-workspace ${assistantOpen?'assistant-expanded':''} ${inspectorOpen||structureOpen||shelfOpen?'editor-panel-open':''}`} hidden={modulePage!=='workbench'}>
        <header className="studio-header workbench-project-actions" hidden={modulePage!=='workbench'}>
          <Button className="workbench-back" type="text" aria-label="返回首页" icon={<ArrowLeftIcon/>} onClick={()=>navigateStudio('home')}/>
          <div className="workbench-project-summary"><strong title={active?.title}>{active?.title??'未命名项目'}</strong><span className="workbench-kind-tag">{active?.moduleKind==='asset'?'资产':'场景'}</span><span className={`workbench-save-status ${workspace.error?'is-error':''}`}>{workspace.error?'本机保存异常':workspace.saving?'正在保存':'已保存到本机'}<span aria-hidden="true"> · </span>{previewing?'待确认':!active?.librarySavedAt?'草稿':active.savedRevision===revision?'已入库':'修改未入库'}</span></div>
          <div className="workbench-view-controls"/>
          <div className="workbench-document-controls"><Popover trigger="click" placement="topRight" content={<div role="dialog" aria-label="项目信息" className="workbench-project-info">
          <span className="canvas-project-title" title={active?.title}>{active?.title??'正在恢复工作台…'}</span>
          <Tag color={workspace.error?'error':workspace.saving?'warning':'default'} className="save-badge">{workspace.error?'保存异常':workspace.saving?'正在保存':'会话已自动保存到本浏览器'}</Tag>
          {active?.assetSource&&<Tag color={(active.assetCatalogVersion??active.assetSource.version)>active.assetSource.version?'warning':'default'}>编辑 v{active.assetSource.version}{(active.assetCatalogVersion??0)>active.assetSource.version?` · 库内最新 v${active.assetCatalogVersion}，当前草稿未替换`:''}</Tag>}
          <span className="editor-save-state">{active?.snapshot.pendingBatch?'待确认':!active?.librarySavedAt?'草稿':active.savedRevision===useEditorStore.getState().doc.revision?'已保存到库':'未保存到库'}</span></div>}><Button type="text" aria-label="项目状态" title={active?.title} icon={<LayersIcon/>}/></Popover>
          <Button className="workbench-save" type="primary" aria-label={librarySaving?'正在保存…':active?.moduleKind==='asset'?'保存资产':'保存场景'} disabled={locked||librarySaving||!workspace.ready} onClick={()=>{if(active?.moduleKind==='asset'&&!useEditorStore.getState().doc.nodes.length){setProjectNotice('还没有可保存的模型。请先创建或导入模型，再保存到资产库。');setAssistantOpen(true);setAssistantTab('chat');return;}setShowLibrarySave(true);}}>{librarySaving?'保存中…':active?.moduleKind==='asset'?'保存资产':'保存场景'}</Button>
          <Button type="text" aria-label="模型配置" icon={<GearIcon/>} onClick={()=>setShowSettings(true)}/>
          <Button type="text" className="workbench-assistant-toggle" aria-expanded={assistantOpen} aria-label={assistantOpen?'收起 AI 助手':'打开 AI 助手'} onClick={toggleAssistant} icon={<ChatBubbleIcon/>}>AI 助手</Button>
          <Dropdown trigger={['click']} menu={{items:exportItems}} disabled={locked||!workspace.ready}><Button type="text" aria-label="导出与更多" disabled={locked||!workspace.ready}>导出 <ChevronDownIcon/></Button></Dropdown>
          </div>
          <input ref={fileRef} type="file" accept=".json,.chat3d.json" className="hidden" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void openProject(file);}}/>
          <input ref={modelFileRef} type="file" accept=".glb" className="hidden" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{if(file.size>20*1024*1024)throw Error('GLB超过20MB');setProjectNotice('正在校验并导入网格模型…');const result=await importGlb(await file.arrayBuffer(),file.name);if(!createSession(result.doc))throw Error('请结束当前生成后再导入');setProjectNotice(`已导入 ${result.doc.nodes.length} 个网格部件到新会话。${result.warnings.join(' ')}`);}catch(error){setProjectNotice(`网格导入失败：${error instanceof Error?error.message:String(error)}`);}}}/>
        </header>
        <nav className="canvas-tool-rail canvas-surface" aria-label="画布工具"><Button type="text" aria-pressed={shelfOpen} onClick={()=>shelfOpen?setShelfOpen(false):openEditorPanel('asset')} icon={<CubeIcon/>}><span>资产</span></Button><Button type="text" aria-pressed={structureOpen} onClick={()=>structureOpen?setStructureOpen(false):openEditorPanel('structure')} icon={<LayersIcon/>}><span>结构</span></Button><Button type="text" aria-pressed={inspectorOpen} disabled={!selection.length} onClick={()=>inspectorOpen?setInspectorOpen(false):openInspector()} icon={<MixerHorizontalIcon/>}><span>属性</span></Button></nav>
        <div className="canvas-transform-tools canvas-surface" role="group" aria-label="场景编辑工具">
          <ToolbarAction label="选择对象" help="打开场景结构，从列表中选择要编辑的对象" onPress={()=>structureOpen?setStructureOpen(false):openEditorPanel('structure')}><CursorArrowIcon/></ToolbarAction>
          <ToolbarAction pressed={selectionBox} label={selectionBox?'退出框选':'框选对象'} help="默认按可见表面框选；Shift / Ctrl / ⌘ 追加，Esc 取消。本次选择可在旁边开启穿透" disabled={!viewportReady||locked} disabledReason={!viewportReady?'三维视图不可用，可在结构列表中多选':'请先结束生成或处理预览'} onPress={()=>useSelectionTool.setState({box:!selectionBox})}><span aria-hidden="true">▧</span></ToolbarAction>
          {selectionBox&&<button className="box-selection-scope" aria-label={wholeModelBox?'框选范围：完整模型':'框选范围：零件'} title={wholeModelBox?'命中零件后扩展到完整模型，包含隐藏和框外成员':'仅选择框内命中的零件，不扩展同模型成员'} onClick={()=>useSelectionTool.setState({wholeModel:!wholeModelBox})}>{wholeModelBox?'框选模型':'框选零件'}</button>}
          {selectionBox&&<button className="box-selection-scope box-selection-through" aria-label="穿透框选" aria-pressed={throughBox} title={throughBox?'穿透已开启：包括被前方模型遮挡的几何；点击恢复可见表面框选':'穿透已关闭：只选最近几何表面（透明面按实体选取）；孔洞中的后方零件仍可能可见'} onClick={()=>useSelectionTool.setState({through:!throughBox})}>{throughBox?'穿透：开':'穿透：关'}</button>}
          <ToolbarAction label="移动选中对象" help="打开位置设置，调整选中内容的 X、Y、Z 坐标" disabled={!selection.length||locked} disabledReason={!selection.length?'请先选中一个或多个对象':previewing?'请先应用或放弃当前预览':'任务执行中，暂不能修改位置'} onPress={()=>{setPropertyTab('position');openInspector()}}><MoveIcon/></ToolbarAction>
          <ToolbarAction label="旋转选中对象" help="打开旋转设置，调整选中内容的朝向与角度" disabled={!selection.length||locked} disabledReason={!selection.length?'请先选中一个或多个对象':previewing?'请先应用或放弃当前预览':'任务执行中，暂不能旋转对象'} onPress={()=>{setPropertyTab('rotation');openInspector()}}><RotateCounterClockwiseIcon/></ToolbarAction>
          <ToolbarAction label="缩放选中对象" help="打开尺寸设置，调整选中内容的大小" disabled={!selection.length||locked} disabledReason={!selection.length?'请先选中一个或多个对象':previewing?'请先应用或放弃当前预览':'任务执行中，暂不能缩放对象'} onPress={()=>{setPropertyTab('size');openInspector()}}><SizeIcon/></ToolbarAction>
          <ToolbarAction label="聚焦选中对象" help="把镜头移动到选中内容附近，方便查看" disabled={!selection.length||!viewportReady} disabledReason={!selection.length?'请先选中一个或多个对象':'当前三维视图不可用'} onPress={()=>focusSceneObjects(selection)}><EnterFullScreenIcon/></ToolbarAction><span/>
          <DeleteSelectionAction active={workspace.ready&&modulePage==='workbench'} onNotice={setProjectNotice}/>
          <ToolbarAction label="撤销" help="撤回最近一次已应用的模型修改" disabled={!canUndo||locked} disabledReason={locked?(previewing?'请先应用或放弃当前预览':'请等待当前任务结束'):'当前没有可撤销的修改'} onPress={undo}><CounterClockwiseClockIcon/></ToolbarAction>
          <ToolbarAction label="重做" help="恢复刚才撤销的模型修改" disabled={!canRedo||locked} disabledReason={locked?(previewing?'请先应用或放弃当前预览':'请等待当前任务结束'):'当前没有可重做的修改'} onPress={redo}><ReloadIcon/></ToolbarAction>
          <ToolbarAction label={focusScene?'恢复工作台':'专注场景'} help={focusScene?'恢复对话与编辑面板':'暂时收起周边面板，放大模型画布'} onPress={()=>setFocusScene(!focusScene)}><EnterFullScreenIcon/></ToolbarAction>
        </div>
        {shelfOpen&&<CanvasAssetShelf onClose={()=>setShelfOpen(false)} onLibrary={()=>setShowAssets(true)}/>}
        <div className="editor-upper"><aside className="editor-objects canvas-surface" hidden={!structureOpen}><div className="editor-panel-heading">场景结构<Button type="text" aria-label="收起场景结构" icon={<Cross1Icon/>} onClick={()=>setStructureOpen(false)}/></div><ObjectTree/></aside>
          <main className="scene-region">
            <div className="scene-stage"><ViewportPanel/></div>
            <div className="canvas-context-label"><LayersIcon/>{previewing?'修改预览':locked?'正在处理草稿':active?.title??'三维视图'}<small>{nodeCount} 个零件 · m</small></div>
            {nodeCount===0&&!locked&&viewportReady&&<div className="canvas-empty-guide"><span className="canvas-empty-symbol" aria-hidden="true"><CubeIcon/></span><h2>{active?.moduleKind==='asset'?'从一个模型开始':'搭建你的三维场景'}</h2><p>向 AI 描述想法，也可以从本地资源开始。</p><div><Button onClick={()=>openEditorPanel('asset')} icon={<CubeIcon/>}>浏览本地资产</Button><Button onClick={()=>modelFileRef.current?.click()} icon={<UploadIcon/>}>导入 GLB 模型</Button></div><small>模型可继续编辑，并保存为本地资产或场景</small></div>}
            <footer className="scene-footer"><span><span className="status-dot"/>{previewing?'预览尚未提交':locked?'正在处理草稿':'可编辑场景'}</span><span>单位 m · Y 轴向上</span><span>{dirty?'当前修改尚未导出备份':'项目文件无待导出修改'}</span></footer>
          </main>
          {!inspectorOpen&&<CanvasSelectionSummary onEdit={()=>openInspector()}/>}
          {inspectorOpen&&selection.length>0&&<CanvasInspector onClose={()=>setInspectorOpen(false)} onAdvanced={()=>setAdvancedOpen(true)} tab={propertyTab} setTab={setPropertyTab}/>}

        </div>
          <aside className="conversation-region" hidden={!assistantOpen}><ConversationResize width={assistantWidth} onChange={setAssistantWidth}/><header className="conversation-panel-title"><strong>AI 建模</strong><Button type="text" aria-label="收起对话区" icon={<Cross1Icon/>} onClick={()=>setAssistantOpen(false)}/></header><div className="conversation-heading"><div className="assistant-tabs" role="tablist" aria-label="助手工作区" onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'chat':e.key==='End'?'tasks':assistantTab==='chat'?'tasks':'chat';setAssistantTab(next);document.getElementById(next==='chat'?'chat-tab':'task-tab')?.focus();}}}><button role="tab" id="chat-tab" tabIndex={assistantTab==='chat'?0:-1} aria-controls="chat-content" aria-selected={assistantTab==='chat'} onClick={()=>setAssistantTab('chat')}><ChatBubbleIcon/>对话</button><button role="tab" id="task-tab" tabIndex={assistantTab==='tasks'?0:-1} aria-controls="task-content" aria-selected={assistantTab==='tasks'} onClick={()=>setAssistantTab('tasks')}>任务记录{locked&&<span className="tab-activity"/>}</button></div></div><div role="tabpanel" id="chat-content" aria-labelledby="chat-tab" hidden={assistantTab!=='chat'} className="assistant-content"><ChatPanel autoStartRequest={autoStartRequest} onAutoStartConsumed={id=>setAutoStartRequest(current=>current?.id===id?null:current)} key={workspace.activeId} canvasMode expanded onExpand={()=>setAssistantOpen(true)} executionDetails={false} onAssets={()=>setShowAssets(true)} onConfigure={()=>setShowSettings(true)}/></div><div role="tabpanel" id="task-content" aria-labelledby="task-tab" hidden={assistantTab!=='tasks'} className="assistant-content"><TaskPanel onConversation={()=>setAssistantTab('chat')}/></div></aside>
        </div>}
      </StudioMain>
      {advancedOpen&&<Modal open title="对象与属性" onCancel={()=>setAdvancedOpen(false)} width={640} footer={<Button onClick={()=>setAdvancedOpen(false)}>关闭高级属性</Button>}><p>精确编辑几何参数、外观和组件关系。</p><PropertiesPanel/></Modal>}
      {showLibrarySave&&<LibraryProjectSaveDialog onClose={()=>setShowLibrarySave(false)} onBusyChange={setLibrarySaving} onSaved={notice=>{setProjectNotice(notice);setLibraryRefresh(v=>v+1);}}/>}
      {showAssets&&<AssetLibrary intent={modulePage==='workbench'?'insert':'manage'} targetName={active?.title} onClose={()=>{setShowAssets(false);setLibraryRefresh(v=>v+1);}}/>}
      {showHistory&&<Modal open title="项目与回收站" onCancel={()=>setShowHistory(false)} width={600} footer={<Button type="primary" onClick={()=>{setShowHistory(false);setModulePage('workbench');}}>进入选中项目</Button>}><p>历史项目仍保留，可重命名、恢复或继续编辑。</p><div className="history-management"><SessionSidebar locked={locked} onClose={()=>{setShowHistory(false);setModulePage('workbench');}}/></div></Modal>}
      {showTools&&<WorkspaceTools onClose={()=>setShowTools(false)}/>}
      {showSettings&&<SettingsDialog onClose={()=>setShowSettings(false)}/>}
      <AppUpdateDialog/>
    </div>
  </AppearanceProvider>;
}
