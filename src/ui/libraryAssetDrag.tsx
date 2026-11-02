import {useEffect,useRef,type DragEvent,type RefObject} from 'react';
import {create} from 'zustand';
import {activeConversationStore} from '../conversationStores';
import {useEditorStore,type EditorStore} from '../store';
import {assertLibraryReady} from '../domain/libraryNavigation';
import {readModelAsset} from '../domain/modelAssetStorage';
import type {ModelAssetSummary,ModelAssetVersion} from '../domain/modelAssets';
import {groundAssetCommand,manualEditLocked} from '../domain/manualComposition';
import type {SceneDocument,SceneNode,Vec3} from '../domain/types';
import type {Viewport} from '../scene/Viewport';
import {cancelAssetPlacement,useCompositionTool} from './manualComposition';
import {makeId} from '../util/ids';

export const LIBRARY_ASSET_DRAG_TYPE='application/x-scenivo-local-asset';
type AssetDrag={token:string;name:string;origin:EditorStore;snapshot:SceneDocument;ready:Promise<ModelAssetVersion>;asset?:ModelAssetVersion;nodes?:SceneNode[];dropping:boolean;cancelled:boolean;clearPreview?:()=>void};
let current:AssetDrag|null=null;
export const useLibraryAssetDrag=create<{drag:{name:string;hovering:boolean;dropping:boolean}|null;notice:string}>(()=>({drag:null,notice:''}));
function assertCurrent(task:AssetDrag){
 if(current!==task||task.cancelled)throw Error('拖放已取消');
 assertLibraryReady();
 if(activeConversationStore()!==task.origin||task.origin.getState().doc!==task.snapshot)throw Error('项目或场景已变化，请重新拖入资产');
 if(manualEditLocked(task.origin.getState().aiStatus))throw Error('请先结束生成或处理预览');
 if(useEditorStore.getState().viewportStatus!=='ready')throw Error('三维视图尚未就绪');
}
export function cancelLibraryAssetDrag(){
 if(current){current.cancelled=true;current.clearPreview?.();current=null;}
 useLibraryAssetDrag.setState({drag:null});
}
export function finishLibraryAssetDrag(){if(!current?.dropping)cancelLibraryAssetDrag();}
export function beginLibraryAssetDrag(item:Pick<ModelAssetSummary,'id'|'version'|'name'>,transfer:DataTransfer){
 cancelLibraryAssetDrag();assertLibraryReady();
 const origin=activeConversationStore();
 if(manualEditLocked(origin.getState().aiStatus)||useEditorStore.getState().viewportStatus!=='ready')throw Error('请先结束生成或恢复三维视图，再拖入资产');
 cancelAssetPlacement();
 const task:AssetDrag={token:makeId(),name:item.name,origin,snapshot:origin.getState().doc,ready:readModelAsset(item.id,item.version),dropping:false,cancelled:false};
 task.ready=task.ready.then(asset=>{task.asset=asset;const command=groundAssetCommand(asset,[0,0,0]);if(command.op==='importManualComponent')task.nodes=command.nodes;return asset;});void task.ready.catch(()=>{});
 current=task;transfer.effectAllowed='copy';transfer.setData(LIBRARY_ASSET_DRAG_TYPE,task.token);
 useLibraryAssetDrag.setState({drag:{name:item.name,hovering:false,dropping:false},notice:''});
}
function accepts(transfer:DataTransfer){return !!current&&!current.cancelled&&!current.dropping&&Array.from(transfer.types).includes(LIBRARY_ASSET_DRAG_TYPE);}
export async function commitLibraryAssetDrop(transfer:DataTransfer,point:Vec3,allowed=()=>true){
 const task=current;if(!task||task.dropping||transfer.getData(LIBRARY_ASSET_DRAG_TYPE)!==task.token)return false;
 task.dropping=true;task.clearPreview?.();useLibraryAssetDrag.setState({drag:{name:task.name,hovering:false,dropping:true}});
 try{
  assertCurrent(task);const asset=await task.ready;assertCurrent(task);if(!allowed())throw Error('画布状态已变化，请重新拖入资产');
  const before=new Set(task.snapshot.nodes.map(node=>node.id));const result=task.origin.getState().applyCommandBatch([groundAssetCommand(asset,point)],`拖入 ${asset.name} v${asset.version}`);
  if(!result.ok)throw Error(result.error??'资产放置失败');
  task.origin.getState().select(task.origin.getState().doc.nodes.filter(node=>!before.has(node.id)).map(node=>node.id));
  useLibraryAssetDrag.setState({notice:`已放置 ${asset.name} · 可撤销`});return true;
 }catch(error){if(!task.cancelled&&current===task)useLibraryAssetDrag.setState({notice:error instanceof Error?error.message:'资产拖入失败'});return false;}
 finally{if(current===task)cancelLibraryAssetDrag();}
}
export function useLibraryAssetDrop(viewportRef:RefObject<Viewport|null>,{doc,activeSession,disabled}:{doc:SceneDocument;activeSession:string;disabled:boolean}){
 const enabled=useRef(!disabled);enabled.current=!disabled;
 const drag=useLibraryAssetDrag(state=>state.drag),notice=useLibraryAssetDrag(state=>state.notice);
 useEffect(()=>{if(current)try{assertCurrent(current);if(disabled)cancelLibraryAssetDrag();}catch{cancelLibraryAssetDrag();}},[doc,activeSession,disabled]);
 useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')cancelLibraryAssetDrag();};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);cancelLibraryAssetDrag();};},[]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>useLibraryAssetDrag.setState({notice:''}),4000);return()=>clearTimeout(timer);},[notice]);
 const hover=useRef<{x:number;y:number}|null>(null),waiting=useRef<AssetDrag|null>(null);
 function preview(){const task=current,vp=viewportRef.current,point=hover.current;if(!task||!vp||!point||!enabled.current)return;try{assertCurrent(task);if(task.nodes)vp.previewAssetDrop(task.nodes,point.x,point.y,useCompositionTool.getState().snap?.25:0);}catch{cancelLibraryAssetDrag();}}
 return {drag,notice,
  onDragOver:(event:DragEvent<HTMLDivElement>)=>{
   if(disabled||!accepts(event.dataTransfer)||!viewportRef.current)return;
   const task=current!;try{assertCurrent(task);}catch{cancelLibraryAssetDrag();return;}
   event.preventDefault();event.stopPropagation();const point=viewportRef.current.assetDropPoint(event.clientX,event.clientY,useCompositionTool.getState().snap?.25:0);event.dataTransfer.dropEffect=point?'copy':'none';
   hover.current={x:event.clientX,y:event.clientY};task.clearPreview=()=>viewportRef.current?.clearAssetDropPreview();
   if(!useLibraryAssetDrag.getState().drag?.hovering)useLibraryAssetDrag.setState({drag:{name:task.name,hovering:true,dropping:false}});
   preview();if(waiting.current!==task){waiting.current=task;void task.ready.then(()=>{if(current===task)preview();}).catch(error=>{if(current===task){useLibraryAssetDrag.setState({notice:error instanceof Error?error.message:'资产读取失败'});cancelLibraryAssetDrag();}});}
  },
  onDragLeave:(event:DragEvent<HTMLDivElement>)=>{if(event.relatedTarget instanceof Node&&event.currentTarget.contains(event.relatedTarget))return;hover.current=null;current?.clearPreview?.();const state=useLibraryAssetDrag.getState().drag;if(state&&!state.dropping)useLibraryAssetDrag.setState({drag:{...state,hovering:false}});},
  onDrop:(event:DragEvent<HTMLDivElement>)=>{
   if(disabled||!accepts(event.dataTransfer))return;event.preventDefault();event.stopPropagation();hover.current=null;const vp=viewportRef.current;if(!vp)return;
   const point=vp.assetDropPoint(event.clientX,event.clientY,useCompositionTool.getState().snap?.25:0);if(!point){useLibraryAssetDrag.setState({notice:'请拖到画布中可见的地面位置'});cancelLibraryAssetDrag();return;}
   void commitLibraryAssetDrop(event.dataTransfer,point,()=>enabled.current&&viewportRef.current===vp);
  }
 };
}
