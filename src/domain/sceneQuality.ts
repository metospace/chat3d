import {inspectSpatialOccupancy,type SpatialPart} from './spatialQuality';
import {inspectGeometryQuality} from './geometryQuality';
import {connectionReport} from './connections';
import {buildPrimitiveGeometry} from '../scene/geometry';
import {Box3,Matrix4,Quaternion,Vector3} from 'three';
import type {Geometry,SceneDocument,SceneRole} from './types';
export interface CompositionPlan {
 zones:{name:string;purpose:string}[];
 connections:{from:string;to:string;via:string}[];
 support:{name:string;role:SceneRole;count:number;purpose:string}[];
 palette:string[];
 presentation:string;
}
export interface QualityPlan {equipment:{name:string;count:number;features:string[]}[];composition?:CompositionPlan}
export interface QualityReport {revision:number;componentCount:number;roles:Record<string,number>;coverage:{name:string;expected:number;actual:number}[];layout:{id:string;name:string;planKey:string;role?:SceneRole;min:number[];max:number[]}[];issues:string[];notes:string[];spatial:ReturnType<typeof inspectSpatialOccupancy>}
interface Component {id:string;name:string;key:string;role?:SceneRole;nodes:number;bounds:Box3;materials:Set<string>;parts:SpatialPart[]}
export function boundsFor(g:Geometry):Box3{
 let size:[number,number,number];
 switch(g.type){
  case 'sectionLoft':case 'profileSweep':case 'loft':case 'sweepTube': {const geo=buildPrimitiveGeometry(g);geo.computeBoundingBox();const b=geo.boundingBox!.clone();geo.dispose();return b;}
  case 'mesh': {const b=new Box3(),v=new Vector3(),p=g.params.positions;for(let i=0;i<p.length;i+=3)b.expandByPoint(v.set(p[i],p[i+1],p[i+2]));return b;}
  case 'lathe': {const r=Math.max(...g.params.points.map(p=>p[0]));return new Box3(new Vector3(-r,g.params.points[0][1],-r),new Vector3(r,g.params.points[g.params.points.length-1][1],r));}
  case 'profile': return new Box3(new Vector3(Math.min(...g.params.points.map(p=>p[0])),Math.min(...g.params.points.map(p=>p[1])),-g.params.depth/2),new Vector3(Math.max(...g.params.points.map(p=>p[0])),Math.max(...g.params.points.map(p=>p[1])),g.params.depth/2));
  case 'box':case 'roundedPlate':case 'frame':size=[g.params.width,g.params.height,g.params.depth];break;
  case 'trapezoid':size=[Math.max(g.params.widthTop,g.params.widthBottom),g.params.height,g.params.depth];break;
  case 'capsule':size=[g.params.radius*2,g.params.length+g.params.radius*2,g.params.radius*2];break;
  case 'tube':size=[g.params.outerRadius*2,g.params.height,g.params.outerRadius*2];break;
  case 'sphere':size=[g.params.radius*2,g.params.radius*2,g.params.radius*2];break;
  case 'cylinder':{const r=Math.max(g.params.radiusTop,g.params.radiusBottom);size=[r*2,g.params.height,r*2];break;}
  case 'cone':size=[g.params.radius*2,g.params.height,g.params.radius*2];break;
  case 'plane':size=[g.params.width,g.params.depth,0];break;
 }
 const half=new Vector3(...size).multiplyScalar(.5);return new Box3(half.clone().negate(),half);
}
export function inspectSceneQuality(doc:SceneDocument,plan?:QualityPlan):QualityReport{
 const groups=new Map<string,Component>(),cache=new Map<string,Box3>();
 for(const node of doc.nodes){
  if(!node.visible||!node.geometry)continue;
  const id=node.assemblyId??node.id;let group=groups.get(id);
  if(!group){group={id,name:node.assemblyName??node.name,key:node.planKey??node.assemblyName??node.name,role:node.sceneRole,nodes:0,bounds:new Box3(),materials:new Set(),parts:[]};groups.set(id,group);}
  group.nodes++;if(node.materialId)group.materials.add(node.materialId);
  const key=JSON.stringify(node.geometry);let local=cache.get(key);if(!local){local=boundsFor(node.geometry);cache.set(key,local);}
  const matrix=new Matrix4().compose(new Vector3(...node.transform.position),new Quaternion(...node.transform.rotationQuaternion),new Vector3(...node.transform.scale));const world=local.clone().applyMatrix4(matrix);group.bounds.union(world);group.parts.push({id:node.id,name:node.name,bounds:world});
 }
 const components=[...groups.values()],spatial=inspectSpatialOccupancy([...groups.values()]),issues:string[]=[],roles:Record<string,number>={};
 for(const c of components)roles[c.role??'unclassified']=(roles[c.role??'unclassified']??0)+1;
 const expected=[...(plan?.equipment??[]).map(e=>({name:e.name,count:e.count})),...(plan?.composition?.support??[]).map(e=>({name:e.name,count:e.count}))];
 const coverage=expected.map(e=>({name:e.name,expected:e.count,actual:components.filter(c=>c.key===e.name).length}));
 for(const item of coverage)if(item.actual<item.expected)issues.push(`设计清单未满足：${item.name}，计划${item.expected}，已关联${item.actual}。检查是否缺失或planKey未标注`);
 const gap=(a:Box3,b:Box3)=>Math.hypot(Math.max(a.min.x-b.max.x,b.min.x-a.max.x,0),Math.max(a.min.z-b.max.z,b.min.z-a.max.z,0));
 for(const link of plan?.composition?.connections??[]){
  const source=components.filter(c=>c.key===link.from),target=components.filter(c=>c.key===link.to),via=components.filter(c=>c.key===link.via);
  for(const key of [link.from,link.to,link.via])if(!components.some(c=>c.key===key))issues.push(`连接缺少可核对对象：${link.from} → ${link.to}，经 ${link.via}；未找到${key}`);
  if(source.length>200||target.length>200||via.length>200)issues.push(`连接组件数量较多：${link.from} → ${link.to}，本次未检查输送间距，请按区域细分`);
  if(source.length&&target.length&&via.length&&via.every(c=>c.role==='conveyor')&&source.length<=200&&target.length<=200&&via.length<=200){
   const distances=[...source,...target].map(c=>Math.min(...via.map(v=>gap(c.bounds,v.bounds))));const maxGap=Math.max(...distances);
   if(maxGap>1)issues.push(`输送连接间距线索：${link.from} → ${link.to}，部分对象与${link.via}的水平包围盒距离约${maxGap.toFixed(2)}m，请检查是否缺少连接段`);
  }
 }
 const membersByGroup=new Map<string,SceneDocument['nodes']>();for(const n of doc.nodes){if(!n.visible)continue;const key=n.assemblyId??n.id;const group=membersByGroup.get(key)??[];group.push(n);membersByGroup.set(key,group);}
 const allMachines=components.filter(c=>c.role==='equipment'),machines=allMachines.slice(0,200);
 for(const c of components){
  const size=c.bounds.getSize(new Vector3());
  if(c.role==='equipment'&&c.nodes<=3)issues.push(`${c.name}只有${c.nodes}个可见部件，可能仍是占位形体，请近景核对结构`);
  const members=membersByGroup.get(c.id)??[];
  if(c.role==='equipment'&&c.nodes>=4&&c.materials.size===1)issues.push(`${c.name}仅使用一种材质；核对壳体、玻璃、裸金属和操作部位的层次，不要为凑数任意改色`);
  if(c.role==='person'){
    const torso=members.find(n=>/躯干|胸部|身体|body|torso/i.test(n.name));
    if(torso?.geometry?.type==='box')issues.push(`${c.name}躯干仍为矩形块；请核对肩、胸腰、骨盆轮廓与肢体连接，避免积木人`);
    if(!members.some(n=>/手|hand/i.test(n.name)))issues.push(`${c.name}未识别到手部；请检查手与作业台/控制器的实际关系`);
  }
  if(c.role==='person'&&(size.y<1.3||size.y>2.2))issues.push(`${c.name}高度约${size.y.toFixed(2)}m；若为站立成年人，需核对比例（坐姿等可能合理）`);
 }
 // Bounding boxes are conservative candidates, never claims of exact collision.
 let overlapCount=0;
 for(let i=0;i<machines.length;i++)for(let j=i+1;j<machines.length;j++){
  const overlap=machines[i].bounds.clone().intersect(machines[j].bounds);if(overlap.isEmpty())continue;const s=overlap.getSize(new Vector3());
  if(s.x>.05&&s.y>.05&&s.z>.05){overlapCount++;if(overlapCount<=6)issues.push(`设备包围盒交叠：${machines[i].name} / ${machines[j].name}，请视觉检查是否真实穿插`);}
 }
 for(const c of components.filter(c=>c.role==='floor'||c.role==='building')){
  if([...c.materials].some(id=>(doc.materials.find(m=>m.id===id)?.metalness??0)>.7))issues.push(`${c.name}使用高金属度材质，请确认墙地面是否确实需要金属表面`);
 }
 for(const c of connectionReport(doc))if(c.status!=='within_tolerance')issues.push(`连接关系待修正：${c.purpose}，当前距离${c.distance?.toFixed(3)??'未知'}m，允许${c.maxDistance}m；需确认接触面与穿插`);
 return {revision:doc.revision,componentCount:components.length,roles,coverage,layout:components.slice(0,200).map(c=>({id:c.id,name:c.name,planKey:c.key,role:c.role,min:c.bounds.min.toArray(),max:c.bounds.max.toArray()})),spatial,issues:[...new Set([...spatial.candidates.map(c=>`${c.relation==='enclosing_space'?'围护内部空间待核对':c.kind==='body_occupancy'?'人员身体占位风险':'跨组件占位待核对'}：${c.aName} / ${c.bName}，交叠范围 ${c.overlap.join('×')}m；${c.partPairs.length?'已有零件包围盒交叠线索':'可能涉及空腔或预留空间'}，需核对实际几何与用途，不可仅凭接触点判通过`),...inspectGeometryQuality(doc),...issues])].slice(0,24),notes:[...(components.length>200?['布局坐标仅列前200个组件，其他组件需按区域读取']:[]),...(allMachines.length>200?['包围盒交叠检查仅覆盖前200台设备，较大场景需要分区复核']:[]),'清单匹配依赖组件planKey；缺标注不一定代表缺模型','包围盒交叠只是检查线索，不等于实际几何碰撞','连接检查核对对象及输送包围盒间距，不证明接口相接或工艺正确','仍需近景与全景检查结构、人员动作、疏密和统一观感']};
}
