import {remapPoseRig} from './poseRig';
import {MAX_PROJECT_BYTES,PROJECT_SIZE_LIMIT,TEAM_SCENE_SIZE_LIMIT,serializeProject} from './project';
import {Vector3} from 'three';
import {assemblyBounds} from './assemblyEditing';
import {instantiateAsset,type ModelAssetVersion} from './modelAssets';
import {makeId} from '../util/ids';
import type {Command} from './commands';
import type {SceneDocument,SceneNode,Vec3} from './types';

export const manualEditLocked=(status:string)=>['capturing','context','generating','validating','previewing','applying'].includes(status);
export function compositionGroup(node:SceneNode):string{return node.modelAsset?.instanceId??node.assemblyId??node.id;}
/** Instance takes precedence over subassembly: a saved multi-assembly asset is one object. */
export function wholeObjectIds(doc:SceneDocument,ids:string[]):string[]{
 const selected=new Set(ids),groups=new Set(doc.nodes.filter(n=>selected.has(n.id)).map(compositionGroup));
 return doc.nodes.filter(n=>n.geometry&&groups.has(compositionGroup(n))).map(n=>n.id);
}
export function snapCoordinate(value:number,step:number):number{return step>0?Math.round(value/step)*step:value;}
export function groundAssetCommand(asset:ModelAssetVersion,point:Vec3):Command{
 const box=assemblyBounds(asset.nodes),center=box.getCenter(new Vector3());
 return manualAssetCommand(asset,[point[0]-center.x,-box.min.y,point[2]-center.z]);
}
/** Human entry points share unrestricted-by-part-count import without changing AI instantiation. */
export function manualAssetCommand(asset:ModelAssetVersion,position:Vec3,yaw=0):Command{
 const command=instantiateAsset(asset,position,yaw);if(command.op!=='importComponentDraft')throw Error('资产放置命令无效');return {...command,op:'importManualComponent'};
}
function groups(doc:SceneDocument,ids:string[]):SceneNode[][]{
 const byId=new Map(doc.nodes.map(n=>[n.id,n]));
 if(!ids.length||ids.some(id=>!byId.has(id)))throw Error('选中对象已变化，请重新选择');
 const all=new Set(wholeObjectIds(doc,ids)),map=new Map<string,SceneNode[]>();
 // First selected object is the alignment reference, regardless of document ordering.
 for(const id of ids){const n=byId.get(id);if(n&&!map.has(compositionGroup(n)))map.set(compositionGroup(n),[]);}
 for(const n of doc.nodes)if(all.has(n.id))map.get(compositionGroup(n))!.push(n);
 const result=[...map.values()].filter(g=>g.length);if(!result.length)throw Error('请先选择可编辑对象');return result;
}
export function groundSelectionCommands(doc:SceneDocument,ids:string[]):Command[]{
 const objects=groups(doc,ids);return [{op:'layoutSelection',targetIds:objects.flatMap(nodes=>nodes.map(n=>n.id)),layout:'ground'}];
}
export function alignSelectionCommands(doc:SceneDocument,ids:string[],axis:'x'|'z'):Command[]{
 const objects=groups(doc,ids);if(objects.length<2)throw Error('按住 Shift 选择至少两个完整对象，先选的对象作为对齐基准');
 return [{op:'layoutSelection',targetIds:objects.flatMap(nodes=>nodes.map(n=>n.id)),layout:axis}];
}
export function layoutSelectedNodes(doc:SceneDocument,ids:string[],layout:'ground'|'x'|'z'):SceneNode[]{
 if(!['ground','x','z'].includes(layout))throw Error('不支持的排列操作');
 const objects=groups(doc,ids);if(layout!=='ground'&&objects.length<2)throw Error('请选择至少两个完整对象');
 const reference=assemblyBounds(objects[0]).getCenter(new Vector3()),changes=new Map<string,SceneNode>();
 for(const nodes of objects){const bounds=assemblyBounds(nodes),delta:Vec3=[0,0,0];
  if(layout==='ground')delta[1]=-bounds.min.y;else delta[layout==='x'?0:2]=reference[layout]-bounds.getCenter(new Vector3())[layout];
  for(const n of nodes)changes.set(n.id,{...n,transform:{...n.transform,position:n.transform.position.map((v,i)=>v+delta[i]) as Vec3}});
 }
 return doc.nodes.map(n=>changes.get(n.id)??n);
}
/** Count includes the original; gap separates the copied selections, not unrelated scene content. */
export function arraySelectionCommands(doc:SceneDocument,ids:string[],count:number,axis:'x'|'z',gap:number):Command[]{
 validateArray(count,axis,gap);const nodes=groups(doc,ids).flat();
 return [{op:'duplicateSelection',targetIds:nodes.map(n=>n.id),count,axis,gap}];
}
const MANUAL_ARRAY_OVERFLOW = `本次排列将使项目文件超过 ${PROJECT_SIZE_LIMIT}，请减少本次复制数量或简化模型；没有场景对象总数上限，团队场景发布上限为 ${TEAM_SCENE_SIZE_LIMIT}`;
function validateArray(count:number,axis:'x'|'z',gap:number){if(!Number.isSafeInteger(count)||count<2||!['x','z'].includes(axis)||!Number.isFinite(gap)||gap<0)throw Error('排列总数量需为至少 2 的整数，净间距需为非负米数');}
/** Manual aggregate path: preserve source metadata and internal references without per-import part caps. */
export function duplicateSelectedNodes(doc:SceneDocument,ids:string[],count:number,axis:'x'|'z',gap:number):SceneNode[]{
 validateArray(count,axis,gap);const nodes=groups(doc,ids).flat(),included=new Set(nodes.map(n=>n.id)),size=assemblyBounds(nodes).getSize(new Vector3());
 const bytes=new TextEncoder().encode(JSON.stringify(nodes)).length,baseBytes=new TextEncoder().encode(JSON.stringify(doc)).length;
 if(baseBytes+bytes*(count-1)>MAX_PROJECT_BYTES)throw new Error(MANUAL_ARRAY_OVERFLOW);
 const added:SceneNode[]=[];
 for(let i=1;i<count;i++){
  const instances=new Map<string,string>(),assemblies=new Map<string,string>(),idMap=new Map(nodes.map(n=>[n.id,makeId()]));
  for(const n of nodes){const copy=structuredClone(n),key=compositionGroup(n),assembly=n.assemblyId??n.id;
   if(!instances.has(key))instances.set(key,makeId());if(!assemblies.has(assembly))assemblies.set(assembly,makeId());
   if(n.poseRig){const rig=remapPoseRig(n.poseRig,idMap);if(rig)copy.poseRig=rig;else delete copy.poseRig;}copy.id=idMap.get(n.id)!;copy.assemblyId=assemblies.get(assembly)!;
   if(copy.modelAsset)copy.modelAsset.instanceId=instances.get(key)!;
   if(copy.connection){if(included.has(copy.connection.targetId))copy.connection.targetId=idMap.get(copy.connection.targetId)!;else delete copy.connection;}
   if(copy.parentId)copy.parentId=idMap.get(copy.parentId)??null;
   copy.transform.position[axis==='x'?0:2]+=(size[axis]+gap)*i;added.push(copy);
  }
 }
 serializeProject({...doc,nodes:[...doc.nodes,...added]},MANUAL_ARRAY_OVERFLOW);return added;
}
