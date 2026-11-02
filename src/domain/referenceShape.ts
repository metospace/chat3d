import {Box3,Matrix4,Quaternion,Vector3} from 'three';
import {buildPrimitiveGeometry} from '../scene/geometry';
import {STRUCTURED_PART_LIMIT} from './structureLimits';
import type {SceneDocument,SceneNode} from './types';
import type {ObjectBlueprint,FeatureBinding,ReferenceExtent,ReferenceProportion} from './objectBlueprint';

/** Measures declared planar profile geometry, never estimates fidelity from pixels. */
export function profileOpeningMetrics(doc:SceneDocument){
 const area=(p:[number,number][])=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1]},0))/2;
 const profiles=doc.nodes.filter(n=>n.visible&&n.geometry?.type==='profile');
 return {items:profiles.slice(0,48).map(n=>{
  const g=n.geometry;if(g?.type!=='profile')throw Error('Expected profile');
  const outerArea=area(g.params.points),holeArea=(g.params.holes??[]).reduce((sum,p)=>sum+area(p),0);
  return {nodeId:n.id,name:n.name,holeCount:g.params.holes?.length??0,openingAreaRatio:outerArea>0?holeArea/outerArea:null,depth:g.params.depth,roundedEdges:!!(g.params.cornerRadius||g.params.edgeRadius)};
 }),remaining:Math.max(0,profiles.length-48),limitation:'开孔率仅为各profile原始二维截面孔面积/外轮廓面积，不含倒角、其他部件遮挡或重叠，不等于整件可见通透率或参考图相似度；多块板的比例不能直接相加。'};
}

export function referenceObservationCoverage(plans:ObjectBlueprint[],hasReference:boolean){
 const features=plans.flatMap(p=>p.features.map(f=>({object:p.name,name:f.name,observation:f.referenceObservation??null})));
 const missing=features.filter(f=>!f.observation);
 const issues:string[]=!hasReference?[]:!features.length?['参考图尚未拆解为可逐项核对的可见结构特征']:missing.map(f=>`${f.object}：${f.name}缺少参考图可见特征记录`);
 // Multi-part machines in a reference photo rarely resolve with 1–2 buckets; push for a real inventory.
 if(hasReference&&features.length>0&&features.length<4)issues.push('参考图结构特征过少（当前'+features.length+'项）：复杂设备应按可见分区拆成更多可核对特征（如底盘、门架/立柱、货叉或载货面、灯具/标牌等），避免单柱或单箱偷懒');
 return {required:hasReference,featureCount:features.length,recordedCount:features.length-missing.length,accepted:false,
  issues,
  limitation:'只统计是否记录参考观察及特征拆分是否过粗，不证明观察正确、几何实现或视觉相似；遮挡部分须注明未知，不能编造精确尺寸。'};
}

export function referenceShapeChanged(before:SceneDocument,after:SceneDocument){
 const previous=new Map(before.nodes.map(n=>[n.id,n]));
 return before.nodes.length!==after.nodes.length||after.nodes.some(n=>{const p=previous.get(n.id);return !p||p.parentId!==n.parentId||JSON.stringify(p.geometry)!==JSON.stringify(n.geometry)||JSON.stringify(p.transform)!==JSON.stringify(n.transform);});
}

const referenceViews=['front','back','side','top','bottom','underside','perspective'];
const nonemptyText=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function validateReferenceProportions(plan:ObjectBlueprint):void{
 const ratios=plan.referenceProportions;if(ratios===undefined)return;
 if(!Array.isArray(ratios)||!ratios.length||ratios.length>16||new Set(ratios.map(r=>r?.key)).size!==ratios.length)throw Error('参考比例需1–16项不重复声明');
 for(const r of ratios){
  if(!r||!nonemptyText(r.key,80)||!nonemptyText(r.name,160)||!nonemptyText(r.observation,360)||!referenceViews.includes(r.view)||!['estimated','user'].includes(r.source))throw Error('参考比例需名称、estimated或user来源、观察视角及说明；不可见或透视不确定时expected用null');
  for(const side of [r.numerator,r.denominator])if(!side||!plan.features.some(f=>f.key===side.featureKey)||!['x','y','z'].includes(side.axis))throw Error('参考比例必须引用当前方案特征及世界包围盒x/y/z轴');
  if(r.expected!==null&&(typeof r.expected!=='number'||!Number.isFinite(r.expected)||r.expected<=0))throw Error('参考比例expected必须为有限正数或null（unknown）');
  if(typeof r.relativeTolerance!=='number'||!Number.isFinite(r.relativeTolerance)||r.relativeTolerance<0||r.relativeTolerance>1)throw Error('参考比例relativeTolerance必须为0–1的相对容差');
 }
}

export interface ReferenceProportionPlanningReport {required:boolean;accepted:false;objects:{key:string;name:string;status:'missing'|'unknown'|'declared';declaredCount:number;unknownKeys:string[]}[];issues:string[];limitations:string}
export function referenceProportionPlanningCoverage(plans:ObjectBlueprint[],hasReference:boolean):ReferenceProportionPlanningReport{
 const objects:ReferenceProportionPlanningReport['objects']=plans.map(p=>({key:p.key,name:p.name,status:!p.referenceProportions?.length?'missing':p.referenceProportions.every(r=>r.expected===null)?'unknown':'declared',declaredCount:p.referenceProportions?.length??0,unknownKeys:(p.referenceProportions??[]).filter(r=>r.expected===null).map(r=>r.key)}));
 return {required:hasReference,accepted:false,objects,issues:!hasReference?[]:!plans.length?['参考图尚未记录主比例声明（含来源、容差和观察说明）']:objects.filter(o=>o.status==='missing').map(o=>`${o.name}：参考图主比例尚未记录`),limitations:'expected由模型依据参考图估计或用户给定，不由程序从像素自动推断。不可见、遮挡或透视不确定可声明null；unknown不代表通过，声明匹配只代表计划自洽。'};
}

export interface ReferenceExtentMeasurement {featureKey:string;axis:'x'|'y'|'z';nodeIds:string[];actual:number|null;bounds:{min:number[];max:number[]}|null;status:'measured'|'missing_binding'|'invalid_binding'|'unmeasurable';reason:string|null}
export type ReferenceProportionStatus='unmeasurable'|'invalid_measurement'|'unknown'|'mismatch'|'matches_declaration';
export interface ReferenceProportionMeasurement extends Omit<ReferenceProportion,'numerator'|'denominator'> {numerator:ReferenceExtentMeasurement;denominator:ReferenceExtentMeasurement;actual:number|null;difference:number|null;relativeDeviation:number|null;status:ReferenceProportionStatus;blocksCompletion:boolean;accepted:false}
export interface ReferenceProportionReport {revision:number;blueprintKey:string;componentId?:string;status:'invalid_declaration'|'not_declared'|'blocked'|'unknown'|'matches_declaration';items:ReferenceProportionMeasurement[];issues:string[];blocksCompletion:boolean;accepted:false;limitations:string}
/** Rebuild world bounds from rendered vertices each call; never cache acceptance across geometry edits. */
export function inspectReferenceProportions(doc:SceneDocument,plan:ObjectBlueprint,binding?:FeatureBinding):ReferenceProportionReport{
 const limitations='按绑定特征所有真实几何顶点的世界轴对齐包围盒测量（米），包含隐藏部件；不是像素、可见轮廓或投影长度测量。旋转会改变轴向跨度，须按声明世界轴复核。estimated匹配仅证明与估计计划自洽；user匹配仅证明符合声明比例，均不是参考图视觉验收。';
 let invalid:string|null=null;try{validateReferenceProportions(plan);}catch(error){invalid=error instanceof Error?error.message:String(error);}
 if(invalid||!plan.referenceProportions?.length){const issues=invalid?[`${plan.name}：参考比例声明无效：${invalid}`]:[];return {revision:doc.revision,blueprintKey:plan.key,componentId:binding?.componentId,status:invalid?'invalid_declaration':'not_declared',items:[],issues,blocksCompletion:!!invalid,accepted:false,limitations};}
 const nodes=new Map(doc.nodes.map(n=>[n.id,n])),matrices=new Map<string,Matrix4>(),boxes=new Map<string,Box3>(),extents=new Map<string,ReferenceExtentMeasurement>();
 const worldMatrix=(node:SceneNode,visiting=new Set<string>()):Matrix4=>{
  const cached=matrices.get(node.id);if(cached)return cached;
  if(visiting.has(node.id))throw Error('父级变换循环');visiting.add(node.id);
  const t=node.transform;if([...t.position,...t.rotationQuaternion,...t.scale].some(v=>!Number.isFinite(v))||t.scale.some(v=>v===0))throw Error('节点或父级存在非法/零缩放变换');
  const matrix=new Matrix4().compose(new Vector3(...t.position),new Quaternion(...t.rotationQuaternion),new Vector3(...t.scale));
  if(node.parentId!==null){const parent=nodes.get(node.parentId);if(!parent)throw Error('父级节点不存在');matrix.premultiply(worldMatrix(parent,visiting));}
  visiting.delete(node.id);matrices.set(node.id,matrix);return matrix;
 };
 const nodeBounds=(node:SceneNode)=>{
  const cached=boxes.get(node.id);if(cached)return cached;
  if(!node.geometry)throw Error('绑定节点没有可测量几何');const geometry=buildPrimitiveGeometry(node.geometry);
  try{const position=geometry.getAttribute('position'),box=new Box3(),point=new Vector3(),matrix=worldMatrix(node);if(!position?.count)throw Error('绑定几何没有顶点');for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(matrix);if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(point.z))throw Error('绑定几何存在非法顶点');box.expandByPoint(point);}boxes.set(node.id,box);return box;}finally{geometry.dispose();}
 };
 const measure=(side:ReferenceExtent):ReferenceExtentMeasurement=>{
  const key=side.featureKey+':'+side.axis,cached=extents.get(key);if(cached)return cached;
  const links=binding?.features.filter(f=>f.key===side.featureKey)??[],ids=links[0]?.nodeIds??[],result:ReferenceExtentMeasurement={...side,nodeIds:ids,actual:null,bounds:null,status:'missing_binding',reason:'特征没有真实节点绑定'};
  if(ids.length){result.status='invalid_binding';result.reason='绑定节点无效、重复或不属于当前组件';if(binding?.blueprintKey===plan.key&&links.length===1&&ids.length<=STRUCTURED_PART_LIMIT&&new Set(ids).size===ids.length&&ids.every(id=>{const n=nodes.get(id);return n&&(n.assemblyId??n.id)===binding.componentId;})){
   try{const box=new Box3();for(const id of ids)box.union(nodeBounds(nodes.get(id)!));const actual=box.max[side.axis]-box.min[side.axis];if(!Number.isFinite(actual)||actual<=0)throw Error('所选轴跨度为零或非法');result.actual=actual;result.bounds={min:box.min.toArray(),max:box.max.toArray()};result.status='measured';result.reason=null;}catch(error){result.status='unmeasurable';result.reason=error instanceof Error?error.message:String(error);}
  }}extents.set(key,result);return result;
 };
 const items=plan.referenceProportions.map<ReferenceProportionMeasurement>(r=>{
  const numerator=measure(r.numerator),denominator=measure(r.denominator),ratio=numerator.actual!==null&&denominator.actual!==null?numerator.actual/denominator.actual:null;
  const actual=ratio!==null&&Number.isFinite(ratio)&&ratio>0?ratio:null;
  const difference=actual!==null&&r.expected!==null?actual-r.expected:null,deviation=difference!==null&&r.expected!==null?Math.abs(difference)/r.expected:null;
  const relativeDeviation=deviation!==null&&Number.isFinite(deviation)?deviation:null;
  const status=ratio===null?'unmeasurable':actual===null?'invalid_measurement':r.expected===null?'unknown':deviation!==null&&deviation>r.relativeTolerance+1e-12?'mismatch':'matches_declaration';
  return {...r,numerator,denominator,actual,difference,relativeDeviation,status,blocksCompletion:status==='mismatch'||status==='unmeasurable'||status==='invalid_measurement',accepted:false};
 });
 const issues=items.filter(r=>r.blocksCompletion).map(r=>`${plan.name}：参考比例“${r.name}”${r.status==='mismatch'?`实测${r.actual}，声明${r.expected}，相对偏差${r.relativeDeviation??'超出有限数值范围'}超过容差${r.relativeTolerance}`:`无法测量：${r.numerator.reason??r.denominator.reason??'比值非法'}`}；需修正真实几何或绑定，不能声明视觉通过`);
 return {revision:doc.revision,blueprintKey:plan.key,componentId:binding?.componentId,status:items.some(r=>r.blocksCompletion)?'blocked':items.some(r=>r.status==='unknown')?'unknown':'matches_declaration',items,issues,blocksCompletion:issues.length>0,accepted:false,limitations};
}
