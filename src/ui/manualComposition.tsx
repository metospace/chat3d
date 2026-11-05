import {Button,Popover,Checkbox,Select,InputNumber} from 'antd';
import {Cross1Icon,MoveIcon} from '@radix-ui/react-icons';
import {useEffect,useState,type RefObject} from 'react';
import {create} from 'zustand';
import {activeConversationStore} from '../conversationStores';
import {useEditorStore,type EditorStore} from '../store';
import {useSelectionTool} from './selectionTool';
import {groundAssetCommand,wholeObjectIds,manualEditLocked,groundSelectionCommands,alignSelectionCommands,arraySelectionCommands} from '../domain/manualComposition';
import {selectionPropertyCommands} from '../domain/selectionProperties';
import type {ModelAssetVersion} from '../domain/modelAssets';
import type {SceneDocument} from '../domain/types';
import type {Command} from '../domain/commands';
import type {Viewport} from '../scene/Viewport';

type Placement={asset:ModelAssetVersion;origin:EditorStore;projectId:string;revision:number;snapshot:SceneDocument};
export const useCompositionTool=create<{mode:'move'|'rotate'|'scale'|'orbit';snap:boolean;placement:Placement|null;notice:string;count:number;gap:number;axis:'x'|'z'}>(()=>({mode:'orbit',snap:true,placement:null,notice:'',count:3,gap:.5,axis:'x'}));
export function beginAssetPlacement(asset:ModelAssetVersion){
 const origin=activeConversationStore(),state=origin.getState();
 if(manualEditLocked(state.aiStatus))throw Error('请先结束生成或确认预览');
 if(useEditorStore.getState().viewportStatus!=='ready')throw Error('三维视图尚未就绪，暂不能鼠标放置资产');
 useSelectionTool.setState({box:false});
 useCompositionTool.setState({placement:{asset,origin,projectId:state.doc.projectId,revision:state.doc.revision,snapshot:state.doc},mode:'move',notice:''});
}
export function cancelAssetPlacement(){useCompositionTool.setState({placement:null});}
function current(placement:Placement){const s=placement.origin.getState();return activeConversationStore()===placement.origin&&s.doc.projectId===placement.projectId&&s.doc.revision===placement.revision&&s.doc===placement.snapshot&&!manualEditLocked(s.aiStatus);}
function applyAndSelect(origin:EditorStore,operations:Command[],label:string,selectNew=false){
 const before=new Set(origin.getState().doc.nodes.map(n=>n.id)),result=origin.getState().applyCommandBatch(operations,label);
 if(!result.ok)throw Error(result.error??'修改失败');
 if(selectNew)origin.getState().select(origin.getState().doc.nodes.filter(n=>!before.has(n.id)).map(n=>n.id));
 useCompositionTool.setState({notice:'已完成，可撤销'});
}
export function useManualComposition({viewportRef,doc,selection,aiStatus,viewportStatus,activeSession,attempt,playing=false}:{viewportRef:RefObject<Viewport|null>;doc:SceneDocument;selection:string[];aiStatus:string;viewportStatus:string;activeSession:string|null;attempt:number;playing?:boolean}){
 const {mode,snap,placement}=useCompositionTool(),box=useSelectionTool(s=>s.box);
 useEffect(()=>{cancelAssetPlacement();useCompositionTool.setState({notice:'',mode:'orbit'});},[activeSession]);
 useEffect(()=>{
  const vp=viewportRef.current;if(!vp)return;
  const origin=activeConversationStore(),snapshot=origin.getState().doc;
  if(manualEditLocked(aiStatus)||viewportStatus!=='ready'||box||playing){vp.setComposition(null);if(placement)cancelAssetPlacement();return;}
  if(placement&&!current(placement)){cancelAssetPlacement();vp.setComposition(null);return;}
  const ids=wholeObjectIds(doc,selection),set=new Set(ids),command=placement?groundAssetCommand(placement.asset,[0,0,0]):null;
  // Editing animation poses would persist a transform from a different baseline.
  vp.resetAnimation();
  vp.setComposition({mode,nodes:doc.nodes.filter(n=>set.has(n.id)),placement:command&&command.op==='importManualComponent'?command.nodes:null,snapStep:snap?.25:0,
   onCancel:cancelAssetPlacement,
   onPlace:point=>{if(!placement||useCompositionTool.getState().placement!==placement||!current(placement)){cancelAssetPlacement();return;}try{applyAndSelect(origin,[groundAssetCommand(placement.asset,point)],`放置 ${placement.asset.name} v${placement.asset.version}`,true);cancelAssetPlacement();}catch(e){useCompositionTool.setState({notice:e instanceof Error?e.message:'放置失败'});}},
   onTransform:change=>{if(activeConversationStore()!==origin||origin.getState().doc!==snapshot||manualEditLocked(origin.getState().aiStatus))return;try{applyAndSelect(origin,selectionPropertyCommands(snapshot,ids,change),change.kind==='rotation'?'鼠标旋转整件对象':change.kind==='size'?'鼠标缩放整件对象':'鼠标移动整件对象');}catch(e){useCompositionTool.setState({notice:e instanceof Error?e.message:'变换失败'});}}
  });return()=>vp.setComposition(null);
 },[doc,selection,aiStatus,viewportStatus,activeSession,attempt,mode,snap,placement,box,playing,viewportRef]);
}
export function ManualCompositionTools({playing=false}:{playing?:boolean}={}){
 const tool=useCompositionTool(),status=useEditorStore(s=>s.aiStatus),ready=useEditorStore(s=>s.viewportStatus==='ready'),selection=useEditorStore(s=>s.selection),doc=useEditorStore(s=>s.doc),box=useSelectionTool(s=>s.box);
 const selectedIds=new Set(selection),disabled=manualEditLocked(status)||!ready||playing,groups=new Set(doc.nodes.filter(n=>selectedIds.has(n.id)).map(n=>n.modelAsset?.instanceId??n.assemblyId??n.id));
 function action(kind:'ground'|'x'|'z'|'copy'|'array'){if(disabled||tool.placement)return;const origin=activeConversationStore(),s=origin.getState();try{const ops=kind==='ground'?groundSelectionCommands(s.doc,s.selection):kind==='x'||kind==='z'?alignSelectionCommands(s.doc,s.selection,kind):arraySelectionCommands(s.doc,s.selection,kind==='copy'?2:tool.count,tool.axis,tool.gap);applyAndSelect(origin,ops,kind==='ground'?'选中对象贴地':kind==='x'||kind==='z'?'对齐选中对象':kind==='copy'?'复制整件对象':'排列整件对象',kind==='copy'||kind==='array');}catch(e){useCompositionTool.setState({notice:e instanceof Error?e.message:'操作失败'});}}
 const [panelOpen,setPanelOpen]=useState(false);
 return <Popover trigger={['click']} placement="topRight" open={panelOpen} onOpenChange={setPanelOpen} content={<div className="manual-composition-panel" role="dialog" aria-label="手动摆放工具"><header><strong>手动摆放</strong><Button type="text" aria-label="关闭摆放工具" onClick={()=>setPanelOpen(false)} icon={<Cross1Icon/>}/></header>
  <div className="manual-composition-tools"><div role="group" aria-label="鼠标操作"><Button autoInsertSpace={false} disabled={disabled||!!tool.placement} aria-pressed={tool.mode==='move'&&!box} onClick={()=>{useSelectionTool.setState({box:false});useCompositionTool.setState({mode:'move'});}}>移动</Button><Button autoInsertSpace={false} disabled={disabled||!!tool.placement} aria-pressed={tool.mode==='rotate'&&!box} onClick={()=>{useSelectionTool.setState({box:false});useCompositionTool.setState({mode:'rotate'});}}>旋转</Button><Button autoInsertSpace={false} disabled={disabled||!!tool.placement} aria-pressed={tool.mode==='scale'&&!box} onClick={()=>{useSelectionTool.setState({box:false});useCompositionTool.setState({mode:'scale'});}}>缩放</Button><Button autoInsertSpace={false} disabled={disabled||!!tool.placement} aria-pressed={tool.mode==='orbit'&&!box} onClick={()=>{useSelectionTool.setState({box:false});useCompositionTool.setState({mode:'orbit'});}}>浏览</Button></div><Checkbox checked={tool.snap} disabled={disabled} onChange={e=>useCompositionTool.setState({snap:e.target.checked})}>网格吸附 0.25 m / 旋转吸附 15°</Checkbox>
  {!!selection.length&&!tool.placement&&<div className="manual-composition-actions"><Button disabled={disabled} onClick={()=>action('ground')}>贴地</Button><Button disabled={disabled||groups.size<2} title="以后选对象的中心对齐先选对象" onClick={()=>action('x')}>对齐 X</Button><Button disabled={disabled||groups.size<2} onClick={()=>action('z')}>对齐 Z</Button><label>方向<Select aria-label="排列方向" value={tool.axis} onChange={axis=>useCompositionTool.setState({axis})} options={[{value:"x",label:"X"},{value:"z",label:"Z"}]}/></label><label>总数量<InputNumber aria-label="排列总数量" min={2} precision={0} value={tool.count} onChange={count=>useCompositionTool.setState({count:count??2})}/></label><label>净间距 m<InputNumber aria-label="排列净间距" min={0} step={.25} value={tool.gap} onChange={gap=>useCompositionTool.setState({gap:gap??0})}/></label><Button disabled={disabled} onClick={()=>action('copy')}>复制一件</Button><Button disabled={disabled} onClick={()=>action('array')}>生成排列</Button><small>对齐以先选对象为基准。排列间距基于包围盒，请检查与场景其他对象的碰撞。</small></div>}
  <small>单击选择 · {tool.mode==='orbit'?'左键拖动浏览':`拖动选中对象或蓝色手柄${tool.mode==='rotate'?'旋转':tool.mode==='scale'?'缩放':'移动'} · 其他区域拖动浏览`} · 右键平移 · 滚轮缩放视图 · Esc 取消编辑</small>
  {tool.notice&&<p role="status">{tool.notice}</p>}</div>
 </div>}><Button type="text" aria-label="摆放工具" disabled={disabled}><MoveIcon/>摆放</Button></Popover>;;
}
export function ManualCompositionHint(){const {placement,notice}=useCompositionTool();return placement?<div className="manual-placement-hint" role="status">放置 {placement.asset.name} · 点击地面确认 · Esc 取消{notice&&<span role="alert">{notice}</span>}<Button onClick={cancelAssetPlacement}>取消</Button></div>:null;}
