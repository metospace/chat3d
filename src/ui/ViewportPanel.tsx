import './manual-composition.css';
import {useManualComposition,ManualCompositionTools,ManualCompositionHint} from './manualComposition';
import {wholeObjectIds} from '../domain/manualComposition';
import {createPortal} from 'react-dom';
import {Button,Popover,Switch} from 'antd';
import {ChevronDownIcon,EyeOpenIcon,CubeIcon,ViewVerticalIcon,FrameIcon,Cross1Icon} from '@radix-ui/react-icons';
import {useSelectionTool} from './selectionTool';
import {useWorkspaceStore} from '../workspace';
import {resetIsolatedGpuCapture} from '../scene/isolatedGpuCapture';
import {useAppearance} from './Appearance';
import {SoftwareGeometryView} from './SoftwareGeometryView';
import {registerSceneFocus} from '../scene/focus';
import type {PlaybackState} from '../scene/animationPlayback';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { registerSceneCapture } from '../scene/capture';
import { Viewport } from '../scene/Viewport';
import { useDisplayDoc, useEditorStore } from '../store';
// Three.js 视口宿主：React 只负责挂载/销毁，渲染逻辑全在 Viewport 类里（命令式）
// 通过 Zustand store 双向通信：doc 变化 → sync；视口拾取 → store.select
export function ViewportPanel() {
  const box=useSelectionTool(s=>s.box),wholeModel=useSelectionTool(s=>s.wholeModel),through=useSelectionTool(s=>s.through),activeSession=useWorkspaceStore(s=>s.activeId);
  const [cameraPreset,setCameraPreset]=useState<'presentation'|'top'>('presentation');
  const [viewMenuOpen,setViewMenuOpen]=useState(false),[displayOpen,setDisplayOpen]=useState(false),[selectionMenuOpen,setSelectionMenuOpen]=useState(false);
  const openMenu=(event:ReactKeyboardEvent<HTMLElement>,setOpen:(value:boolean)=>void)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpen(true);}};
  const choosePreset=(value:'presentation'|'top')=>{if(viewportStatus!=='ready')return;setCameraPreset(value);if(value==='top')viewportRef.current?.topView();else viewportRef.current?.presentationView();setViewMenuOpen(false);};
  const displayTriggerRef=useRef<HTMLButtonElement>(null),displayPanelRef=useRef<HTMLDivElement>(null);
  const [displayAnchor,setDisplayAnchor]=useState<{left:number;bottom:number}|null>(null);
  const toggleDisplay=()=>{if(viewportStatus!=='ready')return;if(displayOpen){setDisplayOpen(false);return;}const rect=displayTriggerRef.current?.getBoundingClientRect();if(rect)setDisplayAnchor({left:Math.max(8,Math.min(rect.left,Math.max(8,window.innerWidth-296))),bottom:Math.max(8,window.innerHeight-rect.top+10)});setDisplayOpen(true);};
  useEffect(()=>{if(!displayOpen)return;const onDown=(event:MouseEvent)=>{const target=event.target as Node;if(displayPanelRef.current?.contains(target)||displayTriggerRef.current?.contains(target))return;setDisplayOpen(false);};document.addEventListener('pointerdown',onDown,true);return()=>document.removeEventListener('pointerdown',onDown,true);},[displayOpen]);
  const [controlsHost,setControlsHost]=useState<HTMLElement|null>(null);
  useEffect(()=>{setControlsHost(document.querySelector<HTMLElement>('.workbench-view-controls'));},[]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewportError,setViewportError]=useState('');
  const [selectionError,setSelectionError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [gridVisible,setGridVisible]=useState(false);
  const {resolved}=useAppearance();
  const [backdropOverride,setBackdropOverride]=useState<'light'|'slate'|null>(null);
  const backdrop=backdropOverride??(resolved==='dark'?'slate':'light');
  useEffect(()=>setBackdropOverride(null),[resolved]);
  const [playback,setPlayback]=useState<PlaybackState>({playing:false,time:0,speed:1,duration:0,loop:false,error:''});
  const aiStatus=useEditorStore(s=>s.aiStatus);
  const viewportStatus=useEditorStore(s=>s.viewportStatus);
  const busy=['capturing','context','generating','validating','applying'].includes(aiStatus);
  const viewportRef = useRef<Viewport | null>(null);
  const doc = useDisplayDoc(); // 预览期间自动切到预演副本，确认/放弃后回到真实文档
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  useManualComposition({viewportRef,doc,selection,aiStatus,viewportStatus,activeSession,attempt,playing:playback.playing||playback.time>0});

  useEffect(()=>{useSelectionTool.setState({box:false,through:false});setSelectionError('');},[activeSession]);
  useEffect(()=>{const allowed=box&&!['capturing','context','generating','validating','previewing','applying'].includes(aiStatus);viewportRef.current?.setBoxSelection(allowed,(ids,additive)=>{if(useWorkspaceStore.getState().activeId!==activeSession)return;const state=useEditorStore.getState();if(['capturing','context','generating','validating','previewing','applying'].includes(state.aiStatus))return;state.select(additive?[...new Set([...state.selection,...ids])]:ids);},wholeModel,through,setSelectionError);return()=>viewportRef.current?.setBoxSelection(false,null);},[box,wholeModel,through,aiStatus,viewportStatus,activeSession]);
  useEffect(() => {
    if (!hostRef.current) return;
    useEditorStore.setState({viewportStatus:'starting'});
    let vp: Viewport | undefined;
    try { vp = new Viewport(hostRef.current, (nodeId,additive) => {
      // Modifiers toggle nodes across successive clicks; read the live selection.
      const state=useEditorStore.getState(),node=state.doc.nodes.find(n=>n.id===nodeId);
      const picked=nodeId?(node?.modelAsset?wholeObjectIds(state.doc,[nodeId]):[nodeId]):[];
      if(additive){if(nodeId){const ids=new Set(state.selection),remove=picked.every(id=>ids.has(id));picked.forEach(id=>remove?ids.delete(id):ids.add(id));select([...ids]);}}
      else select(picked);
    });
    vp.setPlaybackListener(setPlayback);vp.sync(useEditorStore.getState().previewDoc??useEditorStore.getState().doc);vp.start();
    } catch(e) {vp?.dispose();useEditorStore.setState({viewportStatus:'error'});setViewportError(e instanceof Error?e.message:'无法创建 WebGL 视图');return;}
    setViewportError('');
    useEditorStore.setState({viewportStatus:'ready'});
    viewportRef.current = vp;

    const canvas=hostRef.current.querySelector('canvas');
    const lost=()=>{useEditorStore.setState({viewportStatus:'error'});setViewportError('WebGL 上下文已丢失，请重试视图');};
    canvas?.addEventListener('webglcontextlost',lost);
    const unregisterFocus=registerSceneFocus(ids=>vp!.fitToSelection(ids));
    const unregister = registerSceneCapture(async (document, view, targetIds,time) => {if(useEditorStore.getState().viewportStatus!=='ready')throw new Error('三维画面不可用，无法进行截图复核');return vp!.captureDocument(document, view, targetIds,time);});
    return () => {
      canvas?.removeEventListener('webglcontextlost',lost);
      unregister();unregisterFocus();
      useEditorStore.setState({viewportStatus:'starting'});
      vp!.setPlaybackListener(null);vp!.dispose();
      viewportRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(()=>{viewportRef.current?.setGridVisible(gridVisible);},[gridVisible,attempt]);
  useEffect(()=>{viewportRef.current?.setBackdrop(backdrop);},[backdrop,attempt]);
  useEffect(()=>{if(busy)viewportRef.current?.resetAnimation();},[busy]);
  // 文档变化 → 同步到视口
  useEffect(() => {
    viewportRef.current?.sync(doc);
  }, [doc,attempt]);

  // 选择变化 → 高亮
  useEffect(() => {
    viewportRef.current?.setSelection(new Set(selection));
  }, [selection, doc,attempt]);

  const viewControls=(<div className="viewport-bottom-bar" role="group" aria-label="视图工具"><div className="viewport-view-tools">
       <Popover trigger={['click']} placement="topLeft" open={viewMenuOpen} onOpenChange={setViewMenuOpen} destroyOnHidden content={<div className="studio-control-menu" role="menu" aria-label="视角"><div role="menuitemradio" aria-checked={cameraPreset==='presentation'} aria-label="沙盘视角" tabIndex={0} className="studio-menu-item" onClick={()=>choosePreset('presentation')}><CubeIcon/>沙盘视角</div><div role="menuitemradio" aria-checked={cameraPreset==='top'} aria-label="俯视布局" tabIndex={0} className="studio-menu-item" onClick={()=>choosePreset('top')}><ViewVerticalIcon/>俯视布局</div><div className="studio-menu-separator"/><div role="menuitem" aria-label="适应场景" tabIndex={0} className="studio-menu-item" onClick={()=>{viewportRef.current?.fitToScene();setViewMenuOpen(false)}}><FrameIcon/>适应场景</div></div>}><Button type="text" className="viewport-tool" disabled={viewportStatus!=='ready'} aria-label="切换视角" onKeyDown={event=>openMenu(event,setViewMenuOpen)}>{cameraPreset==='presentation'?<CubeIcon/>:<ViewVerticalIcon/>}{cameraPreset==='presentation'?'沙盘视角':'俯视布局'}<ChevronDownIcon/></Button></Popover>
       <Button ref={displayTriggerRef} type="text" className="viewport-tool" disabled={viewportStatus!=='ready'} aria-label="显示选项" aria-haspopup="dialog" aria-expanded={displayOpen} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDisplay();}}} onClick={toggleDisplay}><EyeOpenIcon/>显示<ChevronDownIcon/></Button>
       {displayOpen&&createPortal(<div ref={displayPanelRef} className="viewport-display-panel" role="dialog" aria-label="显示设置" style={{position:'fixed',left:displayAnchor?.left??12,bottom:displayAnchor?.bottom??88,zIndex:60}}><header><strong>显示设置</strong><Button type="text" aria-label="关闭显示设置" icon={<Cross1Icon/>} onClick={()=>setDisplayOpen(false)}/></header><div className="display-grid-row"><span>网格</span><Switch aria-label="显示网格" checked={gridVisible} disabled={viewportStatus!=='ready'} onChange={checked=>{if(viewportStatus!=='ready')return;setGridVisible(checked);viewportRef.current?.setGridVisible(checked);}}/></div><fieldset className="display-background"><legend>画布背景</legend><div className="display-background-tiles" role="radiogroup" aria-label="画布背景">{([['light','浅色','is-light'],['slate','深色','is-dark']] as const).map(([value,label,swatch])=><button key={value} type="button" role="radio" aria-checked={backdrop===value} disabled={viewportStatus!=='ready'} className={`display-background-tile ${backdrop===value?'is-selected':''}`} onClick={()=>{if(viewportStatus==='ready')setBackdropOverride(value)}}><span className={`background-color-swatch ${swatch}`} aria-hidden="true"/><span>{label}</span></button>)}</div></fieldset></div>,document.body)}
       <ManualCompositionTools playing={playback.playing||playback.time>0}/></div>
       {!!selection.length&&<Popover trigger={['click']} placement="topRight" open={selectionMenuOpen} onOpenChange={setSelectionMenuOpen} destroyOnHidden content={<div className="studio-control-menu" role="menu" aria-label="选中对象"><div role="menuitem" aria-label="聚焦选中" tabIndex={0} className="studio-menu-item" onClick={()=>{viewportRef.current?.fitToSelection(selection);setSelectionMenuOpen(false)}}>聚焦选中</div>{doc.nodes.find(n=>n.id===selection[0])?.assemblyId&&<div role="menuitem" aria-label="选择整台设备" tabIndex={0} className="studio-menu-item" onClick={()=>{select(wholeObjectIds(doc,[selection[0]]));setSelectionMenuOpen(false)}}>选择整台设备</div>}</div>}><Button type="text" className="selection-action-trigger" disabled={viewportStatus!=='ready'} aria-label="选中对象操作" onKeyDown={event=>openMenu(event,setSelectionMenuOpen)}>已选 {selection.length}<ChevronDownIcon/></Button></Popover>}
      </div>);
  return (
    <div style={{isolation:'isolate',zIndex:0}} className="viewport-host relative flex-1 bg-[#202428] min-w-0">
      <ManualCompositionHint/>
      {selectionError&&<p className="viewport-selection-error" role="alert">{selectionError}</p>}
      {doc.animation&&<div className="animation-controls" aria-label="动画播放控制"><div className="animation-controls-row"><strong title={doc.animation.name}>{doc.animation.name}</strong><span>{aiStatus==='previewing'?'待确认动画':'场景动画'} · {doc.animation.tracks.length} 条轨道</span><button disabled={busy||viewportStatus!=='ready'||!!playback.error} onClick={()=>playback.playing?viewportRef.current?.pauseAnimation():viewportRef.current?.playAnimation()}>{playback.playing?'暂停':'播放动画'}</button><button disabled={busy||viewportStatus!=='ready'} onClick={()=>viewportRef.current?.resetAnimation()}>重置</button><select disabled={busy||viewportStatus!=='ready'} aria-label="动画速度" value={playback.speed} onChange={e=>viewportRef.current?.setAnimationSpeed(Number(e.target.value))}>{[.25,.5,1,2,4].map(n=><option key={n} value={n}>{n}×</option>)}</select></div><div className="animation-controls-row"><input aria-label="动画时间" type="range" min={0} max={doc.animation.duration} step={.01} value={playback.time} disabled={busy||viewportStatus!=='ready'} onChange={e=>viewportRef.current?.seekAnimation(Number(e.target.value))}/><span>{playback.time.toFixed(1)} / {doc.animation.duration.toFixed(1)} s{doc.animation.loop?' · 循环':''}</span></div>{viewportStatus!=='ready'&&<p role="status">三维未就绪，暂不能播放；动画配置仍已保留。</p>}{playback.error&&<p role="alert">{playback.error}，请重置后修改动画配置</p>}</div>}
      {controlsHost?createPortal(viewControls,controlsHost):viewControls}
      {viewportError&&<div className="canvas-fallback"><div className="canvas-renderer-notice" role="status"><strong>兼容预览</strong><span>WebGL 不可用 · 通过“结构”选择对象</span><button onClick={()=>{resetIsolatedGpuCapture();setAttempt(v=>v+1);}}>重试三维</button><details><summary>详情</summary><p>{viewportError}</p><p>软件几何检查仅用于查看形体，不能实时旋转或验收材质。</p></details></div><SoftwareGeometryView doc={doc} selection={selection} autoRender/>{!doc.nodes.length&&<div className="canvas-empty"><strong>从一个想法开始</strong><p>在下方描述模型，或打开资产架引用已有资产。</p></div>}</div>}

      <div ref={hostRef} className="absolute inset-0" />
      <div className="viewport-help pointer-events-none absolute top-2 left-2 text-xs text-gray-400 bg-black/40 px-2 py-1 rounded">
        {viewportStatus==='ready'?'点击选择 · 拖动选中对象移动/旋转 · 空白处拖动浏览 · 右键平移 · 滚轮缩放 · 单位：米':'三维未就绪 · 使用对象与属性选择零件，再生成近景检查图'}
      </div>
    </div>
  );
}
