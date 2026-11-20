import {interactionTargets} from './interactionQuality';
import type {SceneDocument} from './types';import {detailTargets} from './detailAcceptance';import {inspectSceneQuality} from './sceneQuality';
/** A deterministic capture agenda. It selects evidence, never manufactures verdicts. */
export function visualReviewPlan(base:SceneDocument,draft:SceneDocument,offset=0,overviewOnly=false){
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('检查偏移无效');
 const targets=detailTargets(base,draft);
 if(overviewOnly){
  return {revision:draft.revision,totalTargets:targets.length,nextOffset:null,interactions:[],wholeViews:['perspective','top'] as const,targets:[],risks:[],accepted:false as const};
 }
 const quality=inspectSceneQuality(draft);
 const priority=new Set(quality.spatial.candidates.filter(c=>c.kind==='body_occupancy').flatMap(c=>[c.a,c.b]));
 const sorted=[...targets].sort((a,b)=>Number(priority.has(b.id))-Number(priority.has(a.id)));
 const selected=sorted.slice(offset,offset+2);
 const references=(id:string)=>{const members=draft.nodes.filter(n=>n.visible&&(n.assemblyId??n.id)===id);return {partReferences:members.slice(0,24).map(n=>({id:n.id,name:n.name,geometry:n.geometry?.type})),remainingParts:Math.max(0,members.length-24),referenceNote:'仅为真实部件引用，不代表合格；需要更多节点时按组件查询，不可猜测ID。'};};
 return {revision:draft.revision,totalTargets:targets.length,nextOffset:offset+2<targets.length?offset+2:null,interactions:interactionTargets(draft).filter(t=>selected.some(s=>s.id===t.id)),wholeViews:offset===0?['perspective','top'] as const:[],targets:selected.map(t=>({id:t.id,name:t.name,...references(t.id),neighborIds:[...new Set(quality.spatial.candidates.filter(c=>c.a===t.id||c.b===t.id).flatMap(c=>[c.a,c.b]))].filter(id=>id!==t.id).slice(0,2),views:['front','back'] as const})),risks:quality.spatial.candidates.filter(c=>selected.some(t=>t.id===c.a||t.id===c.b)).map(c=>({a:c.a,b:c.b,kind:c.kind})),accepted:false as const};
}

/** Framing a component is whole-scene evidence only when it contains every
 * visible geometry node. Never applies to isolated diagnostic documents. */
export function targetCoversVisibleScene(doc:SceneDocument,targetIds?:string[]):boolean{
 if(!targetIds)return true;
 const visible=doc.nodes.filter(n=>n.visible&&n.geometry),ids=new Set(targetIds);
 return visible.length>0&&visible.every(n=>ids.has(n.id));
}
