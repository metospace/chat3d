import type {CommandWithInverse} from './commands';
import type {SceneDocument} from './types';
export interface ReferenceDifference {id:string;featureKey:string;nodeIds:string[];observed:string;expected:string;action:string;view:'front'|'back'|'side'|'top'|'bottom'|'underside'|'perspective'}
export interface ReferenceRepair extends ReferenceDifference {reportedRevision:number;shape:string;shapeNodeIds?:string[]}
export interface ReferenceRepairItem extends ReferenceRepair {status:'unresolved';next:string}
const shape=(doc:SceneDocument,ids:string[],shapeIds=ids)=>{const value=JSON.stringify(ids.map((id,i)=>{const node=doc.nodes.find(n=>n.id===id);return node?{id:shapeIds[i],geometry:node.geometry,transform:node.transform,visible:node.visible}:null;}));let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}return value.length+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16);};
const targetKey=(item:ReferenceDifference)=>JSON.stringify([item.featureKey,[...item.nodeIds].sort()]);

/** Recover semantic identities only from accepted parameterized delete/import pairs.
 * Match unique names inside that replacement, never elsewhere in the scene. */
export function carryRebuiltReferenceRepairs(repairs:ReferenceRepair[], applied:readonly CommandWithInverse[]):ReferenceRepair[]{
 if(!repairs.length)return repairs;
 let current=repairs;
 for(let i=1;i<applied.length;i++){
  const removed=applied[i-1],added=applied[i];
  if(removed.command.op!=='delete'||added.command.op!=='importComponentDraft')continue;
  const before=removed.before.nodes,after=added.after.nodes,owner=before[0]?.assemblyId;
  const oldProgram=before.find(n=>n.modelingProgram),nextProgram=after.find(n=>n.modelingProgram);
  if(!owner||!oldProgram?.modelStructure||!nextProgram?.modelStructure||oldProgram.modelStructure.blueprintKey!==nextProgram.modelStructure.blueprintKey||before.some(n=>n.assemblyId!==owner)||after.some(n=>n.assemblyId!==nextProgram.assemblyId))continue;
  const oldIds=new Set(before.map(n=>n.id));
  if(!current.some(item=>item.nodeIds.some(id=>oldIds.has(id))))continue;
  const oldNames=new Set<string>(),duplicates=new Set<string>(),newIds=new Map<string,string>();
  for(const {name} of before){if(oldNames.has(name))duplicates.add(name);oldNames.add(name);}
  for(const {name,id} of after){if(newIds.has(name))duplicates.add(name);newIds.set(name,id);}
  const aliases=new Map<string,string>();
  for(const {name,id} of before){const next=newIds.get(name);if(next&&!duplicates.has(name))aliases.set(id,next);}
  if(!aliases.size)continue;
  current=current.map(item=>{
   if(!item.nodeIds.some(id=>aliases.has(id)))return item;
   return {...item,shapeNodeIds:item.shapeNodeIds??item.nodeIds,nodeIds:item.nodeIds.map(id=>aliases.get(id)??id)};
  });
 }
 return current;
}
/** Inspection is advisory: a changed fingerprint permits re-review, never clears a defect. */
export function inspectReferenceRepair(doc:SceneDocument,item:ReferenceRepair){return {changedSinceReported:item.shape!==shape(doc,item.nodeIds,item.shapeNodeIds),missingNodeIds:item.nodeIds.filter(id=>!doc.nodes.some(node=>node.id===id))};}
/** Target identity survives fresh report IDs; only explicit geometric repair can clear it. */
export function updateReferenceRepairs(doc:SceneDocument,current:ReferenceRepair[],reported:ReferenceDifference[],resolvedIds:string[]){
 const byId=new Map(current.map(item=>[item.id,item]));
 const byTarget=new Map(current.map(item=>[targetKey(item),item]));
 if(new Set(reported.map(item=>item.id)).size!==reported.length||new Set(resolvedIds).size!==resolvedIds.length)throw Error('参考形体差异ID不能重复');
 for(const id of resolvedIds){const item=byId.get(id);if(!item)throw Error('待解决参考形体差异不存在：'+id);if(reported.some(next=>next.id===id||targetKey(next)===targetKey(item)))throw Error('同一参考差异不能同时报告和解决');if(!inspectReferenceRepair(doc,item).changedSinceReported)throw Error('参考形体差异尚未实际修改对应几何或位置：'+id);byId.delete(id);byTarget.delete(targetKey(item));}
 for(const item of reported){
  if(!item.nodeIds.length||new Set(item.nodeIds).size!==item.nodeIds.length||item.nodeIds.some(id=>!doc.nodes.some(node=>node.id===id))){
   const bound=byId.get(item.id);
   const currentIds=bound?.nodeIds.filter(id=>doc.nodes.some(node=>node.id===id))??[];
   throw Error('参考形体差异必须引用当前真实部件：'+item.id+(currentIds.length?'。使用该差异当前绑定的部件 '+JSON.stringify(currentIds):'。请从当前版本取景回执或 find_scene_parts 读取真实部件。'));
  }
  const key=targetKey(item),bound=byId.get(item.id);
  if(bound&&targetKey(bound)!==key)throw Error('参考差异ID已绑定原始目标，不可改绑以清除缺陷');
  const previous=byTarget.get(key);
  const next={...item,id:previous?.id??item.id,nodeIds:[...(previous?.nodeIds??item.nodeIds)],reportedRevision:previous?.reportedRevision??doc.revision,shape:previous?.shape??shape(doc,item.nodeIds),...(previous?.shapeNodeIds?{shapeNodeIds:previous.shapeNodeIds}:{})};
  byId.set(next.id,next);byTarget.set(key,next);
 }
 return [...byId.values()];
}
export function referenceRepairReport(items:ReferenceRepair[]):ReferenceRepairItem[]{return items.map(item=>({...item,nodeIds:[...item.nodeIds],status:'unresolved' as const,next:'先按action修改对应形体，再获取当前版本的同向截图；下一轮review_model用resolvedDifferenceIds逐项复核。不能用新增装饰或改名代替。'}));}
