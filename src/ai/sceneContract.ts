import type {SceneDocument} from '../domain/types';
import type {ObjectBlueprint} from '../domain/objectBlueprint';
import type {CompositionPlan} from '../domain/sceneQuality';
/** Read-only current values. Names are labels, never inferred permissions or quality. */
export function sceneContract(document:SceneDocument,design?:{layout:string;composition?:CompositionPlan},blueprints:ObjectBlueprint[]=[]){
 const counts=new Map<string,number>(),components=new Map<string,{id:string;name:string;parts:number;program:boolean}>();
 for(const n of document.nodes){if(n.materialId)counts.set(n.materialId,(counts.get(n.materialId)??0)+1);const id=n.assemblyId??n.id,group=components.get(id)??{id,name:n.assemblyName??n.name,parts:0,program:false};group.parts++;group.program||=!!n.modelingProgram;components.set(id,group);}
 const used=document.materials.filter(m=>counts.has(m.id)).sort((a,b)=>(counts.get(b.id)??0)-(counts.get(a.id)??0));
 return {revision:document.revision,unit:document.unit,upAxis:document.upAxis,layout:design?.layout,composition:design?.composition,materials:used.slice(0,16).map(m=>({id:m.id,baseColor:m.baseColor,roughness:m.roughness,metalness:m.metalness,opacity:m.opacity??1,usedBy:counts.get(m.id)})),remainingMaterials:Math.max(0,used.length-16),components:[...components.values()].slice(0,32),remainingComponents:Math.max(0,components.size-32),blueprints:blueprints.map(p=>({key:p.key,name:p.name,dimensions:p.dimensions,dimensionsSource:p.dimensionsSource,referenceProportions:p.referenceProportions})),instruction:'沿用当前共享尺寸、方向、配色和用户布局；仅修改目标组件。材质值是现状，不代表全部正确；新要求优先。已有参数化组件读对应源码局部修改，不重建无关设备。'};
}
