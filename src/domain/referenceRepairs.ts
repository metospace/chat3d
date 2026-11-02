import type {SceneDocument} from './types';
export interface ReferenceDifference {id:string;featureKey:string;nodeIds:string[];observed:string;expected:string;action:string;view:'front'|'back'|'side'|'top'|'bottom'|'underside'|'perspective'}
export interface ReferenceRepair extends ReferenceDifference {reportedRevision:number;shape:string}
export interface ReferenceRepairItem extends ReferenceRepair {status:'unresolved';next:string}
const shape=(doc:SceneDocument,ids:string[])=>{const value=JSON.stringify(ids.map(id=>{const node=doc.nodes.find(n=>n.id===id);return node?{id,geometry:node.geometry,transform:node.transform,visible:node.visible}:null;}));let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}return value.length+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16);};
/** A shape defect cannot be cleared by renaming, material changes or more screenshots. */
export function updateReferenceRepairs(doc:SceneDocument,current:ReferenceRepair[],reported:ReferenceDifference[],resolvedIds:string[]){
 const byId=new Map(current.map(item=>[item.id,item]));
 if(new Set(reported.map(item=>item.id)).size!==reported.length||new Set(resolvedIds).size!==resolvedIds.length)throw Error('参考形体差异ID不能重复');
 for(const id of resolvedIds){const item=byId.get(id);if(!item)throw Error('待解决参考形体差异不存在：'+id);if(reported.some(next=>next.id===id))throw Error('同一参考差异不能同时报告和解决');if(item.shape===shape(doc,item.nodeIds))throw Error('参考形体差异尚未实际修改对应几何或位置：'+id);byId.delete(id);}
 for(const item of reported){if(!item.nodeIds.length||new Set(item.nodeIds).size!==item.nodeIds.length||item.nodeIds.some(id=>!doc.nodes.some(node=>node.id===id)))throw Error('参考形体差异必须引用当前真实部件');const previous=byId.get(item.id);if(previous&&(previous.featureKey!==item.featureKey||JSON.stringify(previous.nodeIds)!==JSON.stringify(item.nodeIds)))throw Error('参考差异ID已绑定原始目标，不可改绑以清除缺陷');byId.set(item.id,{...item,nodeIds:[...item.nodeIds],reportedRevision:previous?.reportedRevision??doc.revision,shape:previous?.shape??shape(doc,item.nodeIds)});}
 return [...byId.values()];
}
export function referenceRepairReport(items:ReferenceRepair[]):ReferenceRepairItem[]{return items.map(item=>({...item,nodeIds:[...item.nodeIds],status:'unresolved' as const,next:'先按action修改对应形体，再获取当前版本的同向截图；下一轮review_model用resolvedDifferenceIds逐项复核。不能用新增装饰或改名代替。'}));}
