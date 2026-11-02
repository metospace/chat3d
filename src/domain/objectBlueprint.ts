import {STRUCTURED_PART_LIMIT} from './structureLimits';
import {matchesGeometryApproach} from './geometryApproach';
import {inspectReferenceProportions,validateReferenceProportions} from './referenceShape';
import type {SceneDocument} from './types';
export type DetailLevel='closeup'|'scene'|'background';
export type ReferenceView='front'|'back'|'side'|'top'|'bottom'|'underside'|'perspective';
/** Missing provenance on saved plans retains the legacy hard user constraint. */
export type DimensionsSource='user'|'estimated';
export interface ReferenceExtent {featureKey:string;axis:'x'|'y'|'z'}
/** Reference estimates are declarations, not image-derived measurements or visual acceptance. */
export interface ReferenceProportion {key:string;name:string;numerator:ReferenceExtent;denominator:ReferenceExtent;expected:number|null;source:'estimated'|'user';relativeTolerance:number;view:ReferenceView;observation:string}
export interface ObjectBlueprint {dimensions?:{x?:number;y?:number;z?:number};dimensionsSource?:DimensionsSource;referenceProportions?:ReferenceProportion[];key:string;name:string;purpose:string;detailLevel:DetailLevel;detailReason:string;silhouette:string;features:{key:string;name:string;referenceObservation?:string;role:'form'|'function'|'support'|'connection'|'surface';geometryApproach:'primitive'|'profile'|'lathe'|'sweep'|'mesh'|'assembly'}[];negativeSpaces:string[];views:ReferenceView[]}
export interface FeatureBinding {blueprintKey:string;componentId:string;features:{key:string;nodeIds:string[]}[]}
export const DETAIL_LEVEL_GUIDANCE:Record<DetailLevel,string>={
 closeup:'关键近景：优先真实轮廓曲率、开口与负空间、边缘收口、连接连续性及操作细节。细节需在指定近景辨识；不靠提高零件数代替结构。',
 scene:'场景主体：保持清楚轮廓、主要功能结构、操作界面与连接关系。对关键操作部位补局部细节，避免重复生成不可见小零件。',
 background:'背景配套：保持正确比例、落地和必要开口，使用简洁稳定的结构。保留用户明确要求的全部特征；不为装饰增加无用螺栓或隐蔽机构。',
};
export function validateBlueprints(items:ObjectBlueprint[]):void{
 if(!Array.isArray(items)||!items.length||items.length>24||new Set(items.map(x=>x.key)).size!==items.length)throw Error('结构方案需1–24个不重复对象');
 const text=(s:unknown,max:number)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
 for(const b of items){if(b.dimensionsSource!==undefined&&(!['user','estimated'].includes(b.dimensionsSource)||!b.dimensions))throw Error('尺寸来源需为user或estimated，且必须有声明尺寸');if(b.dimensions){const entries=Object.entries(b.dimensions);if(!entries.length||entries.some(([k,v])=>!['x','y','z'].includes(k)||typeof v!=='number'||!Number.isFinite(v)||v<=0||v>10000))throw Error('声明尺寸需至少一个有效x/y/z轴长度（米）');}if(!text(b.key,80)||!text(b.name,80)||!text(b.purpose,240)||!text(b.silhouette,360)||!text(b.detailReason,240)||!Object.prototype.hasOwnProperty.call(DETAIL_LEVEL_GUIDANCE,b.detailLevel))throw Error('对象身份、用途、轮廓与细节档位说明不完整');
  if(!Array.isArray(b.features)||!b.features.length||b.features.length>16||new Set(b.features.map(f=>f.key)).size!==b.features.length||b.features.some(f=>!text(f.key,80)||!text(f.name,240)||!['form','function','support','connection','surface'].includes(f.role)||!['primitive','profile','lathe','sweep','mesh','assembly'].includes(f.geometryApproach)))throw Error('每个对象需1–16项不重复的用途相关结构特征');
  if(b.features.some(f=>f.referenceObservation!==undefined&&!text(f.referenceObservation,360)))throw Error('参考特征观察应为1–360字可见结构说明');
  validateReferenceProportions(b);
  if(!b.features.some(f=>f.role==='form'))throw Error('结构方案必须包含整体外形特征，不能只有装饰零件');
  if(!Array.isArray(b.negativeSpaces)||b.negativeSpaces.length>8||b.negativeSpaces.some(s=>!text(s,240)))throw Error('开口及负空间说明无效');
  if(!Array.isArray(b.views)||b.views.length<2||b.views.length>4||new Set(b.views).size!==b.views.length||b.views.some(v=>!['front','back','side','top','bottom','underside','perspective'].includes(v)))throw Error('需要2–4个不同验收视角');
 }
}
export function validateFeatureBindings(doc:SceneDocument,blueprints:ObjectBlueprint[],bindings:FeatureBinding[]):void{
 if(!Array.isArray(bindings)||bindings.length>128||new Set(bindings.map(b=>b.blueprintKey+':'+b.componentId)).size!==bindings.length)throw Error('特征关联对象数量或唯一性无效');
 for(const b of bindings){const plan=blueprints.find(p=>p.key===b.blueprintKey);if(!plan)throw Error('结构方案不存在');const nodes=new Set(doc.nodes.filter(n=>(n.assemblyId??n.id)===b.componentId).map(n=>n.id));if(!nodes.size)throw Error('关联组件不存在');if(!b.features.length||new Set(b.features.map(f=>f.key)).size!==b.features.length)throw Error('特征关联不能为空或重复');
  for(const f of b.features)if(!plan.features.some(p=>p.key===f.key)||!f.nodeIds.length||f.nodeIds.length>STRUCTURED_PART_LIMIT||new Set(f.nodeIds).size!==f.nodeIds.length||f.nodeIds.some(id=>!nodes.has(id)))throw Error('结构特征必须关联该组件当前存在的真实部件');
 }
}
export function inspectBlueprintCoverage(doc:SceneDocument,blueprints:ObjectBlueprint[],bindings:FeatureBinding[]){
 const rows=blueprints.flatMap(plan=>{const matches=bindings.filter(b=>b.blueprintKey===plan.key);return (matches.length?matches:[undefined]).map(binding=>{const members=doc.nodes.filter(n=>(n.assemblyId??n.id)===binding?.componentId),ids=new Set(members.map(n=>n.id));const features=plan.features.map(f=>{const references=binding?.features.find(x=>x.key===f.key)?.nodeIds??[];return {...f,nodeIds:references,methodMatches:matchesGeometryApproach(f.geometryApproach,members.filter(n=>references.includes(n.id))),status:references.length&&references.every(id=>ids.has(id))?'linked_needs_visual_review':'missing_binding'};});const reused=new Map<string,number>();for(const f of features)for(const id of f.nodeIds)reused.set(id,(reused.get(id)??0)+1);return {key:plan.key,name:plan.name,componentId:binding?.componentId,...(plan.dimensions?{dimensionsSource:plan.dimensionsSource??'user'}:{}),detailLevel:plan.detailLevel,guidance:DETAIL_LEVEL_GUIDANCE[plan.detailLevel],features,negativeSpaces:plan.negativeSpaces,views:plan.views,sharedFeatureNodes:[...reused].filter(([,n])=>n>1).map(([id])=>id),referenceProportions:inspectReferenceProportions(doc,plan,binding)};});});
 return {revision:doc.revision,accepted:false,objects:rows,issues:rows.flatMap(r=>[...r.features.flatMap(f=>f.status==='missing_binding'?[`${r.name}：结构特征“${f.name}”尚未关联当前真实部件`]:!f.methodMatches?[`${r.name}：结构特征“${f.name}”规划造型方法${f.geometryApproach}与实际几何不匹配`]:[]),...r.referenceProportions.issues]),limitations:'关联只证明部件存在，不证明形状、开口、负空间或功能正确；同一部件承载多项特征需要清晰近景依据。细节档位不允许删减明确需求。参考比例由当前世界轴包围盒重算；估计值匹配只证明与声明计划自洽，不代表参考图视觉验收。'};
}
