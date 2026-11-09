import {inspectMeshUV} from './uvQuality';
import {inspectContactSurfaces} from './contactQuality';
import type {SceneDocument} from './types';
import {connectionReport} from './connections';
export const DETAIL_CRITERIA=[
 {key:'silhouette',name:'外形与比例',standard:'整体轮廓、尺度、主次体积与关键负空间应符合对象身份及用户参考；默认真实可信，明确风格化要求优先，不能只用标签或颜色区分类别。'},
 {key:'structure',name:'功能结构',standard:'按对象身份表达必要的结构、解剖或植物生长关系，以及适用的开口、厚度与工作部位；连续形体不以积木拼接代替，简单实体无需虚构机构，复杂对象不能停在占位外壳。'},
 {key:'connections',name:'连接与接触',standard:'按对象检查装配、关节、生长连接、支承或接触关系，避免无依据的悬空/穿插与连续表面断裂；涉及人物、工具与操作面时关系须合理，须看清腕掌连续、拇指与四指、实际包握/单指按压、工具朝向与无穿插。登记接触点合格不代表握持合理。'},
 {key:'materials',name:'材质与表面',standard:'按真实材料或明确风格区分颜色、粗糙度、金属、涂层与透射关系，检查适用的UV、法线和纹理尺度；微表面不替代形体，不靠强光、随机换色或强加噪声磨损掩盖缺陷。'},
 {key:'details',name:'用途相关细节',standard:'按对象身份、用途和目标画面中的可辨识尺度补足必要细节；先主形与结构再局部细节，不能以多边形数、零件数、无用装饰或无限微细节替代完整性。'},
 {key:'context',name:'完整性与环境关系',standard:'独立模型在用户范围内完整；场景按需核对尺度、落地、朝向、支承、相邻对象及活动空间，保留已有资产与风格，不强加未要求的环境、隐藏结构或其他类别清单；未知与不可实现项如实保留未完成。'},
] as const;
export type DetailCriterion=typeof DETAIL_CRITERIA[number]['key'];
export interface DetailCheck {criterion:DetailCriterion;status:'pass'|'fail'|'unknown'|'not_applicable';evidence:string;nodeIds:string[]}
export interface DetailReview {componentId:string;revision:number;checks:DetailCheck[];visualEvidence:boolean;isolatedEvidence?:boolean;contextEvidence?:boolean;interactionEvidence?:boolean;geometryOnly?:boolean;evidenceRevision?:number;reusedCriteria?:DetailCriterion[];criterionEvidence?:Partial<Record<DetailCriterion,number>>}
export interface DetailAcceptance {revision:number;status:'not_required'|'pending'|'needs_work'|'self_reviewed';targets:{id:string;name:string}[];reviews:DetailReview[];issues:string[]}
/** New geometry must meet the same standard regardless of domain or catalogue membership. */
export function detailTargets(base:SceneDocument,draft:SceneDocument){
 const before=new Map(base.nodes.map(n=>[n.id,n])),after=new Map(draft.nodes.map(n=>[n.id,n])),groups=new Map<string,{id:string;name:string}>();
 const visibleGroups=new Map<string,SceneDocument['nodes'][number]>();for(const n of draft.nodes)if(n.visible&&!visibleGroups.has(n.assemblyId??n.id))visibleGroups.set(n.assemblyId??n.id,n);
 const mark=(n:SceneDocument['nodes'][number])=>{const id=n.assemblyId??n.id;const visible=visibleGroups.get(id);if(visible)groups.set(id,{id,name:visible.assemblyName??visible.name});};
 // Embedded maps can be large and shared by hundreds of parts; serialize each material once.
 const surfaceSignature=(m:SceneDocument['materials'][number])=>JSON.stringify({surface:m.surface,maps:m.maps,normalScale:m.normalScale,clearcoat:m.clearcoat,clearcoatRoughness:m.clearcoatRoughness,transmission:m.transmission,thickness:m.thickness,ior:m.ior});
 const oldMaterials=new Map(base.materials.map(m=>[m.id,surfaceSignature(m)])),newMaterials=new Map(draft.materials.map(m=>[m.id,surfaceSignature(m)]));
 for(const n of draft.nodes){if(!n.visible)continue;const old=before.get(n.id);
  const previous=oldMaterials.get(old?.materialId??''),current=newMaterials.get(n.materialId??'');
  const surfaceChanged=(previous??'{}')!==(current??'{}');
  if(!old||!old.visible||JSON.stringify(old.geometry)!==JSON.stringify(n.geometry)||JSON.stringify(old.transform)!==JSON.stringify(n.transform)||JSON.stringify(old.connection)!==JSON.stringify(n.connection)||surfaceChanged)mark(n);
 }
 // Removing or hiding one part must not exempt the remaining assembly from review.
 for(const old of base.nodes)if(old.visible&&(!after.has(old.id)||!after.get(old.id)!.visible))mark(old);
 // A changed target can separate an otherwise unchanged hand/tool/source assembly.
 for(const n of draft.nodes)if(n.connection){const oldTarget=before.get(n.connection.targetId),target=after.get(n.connection.targetId);if(JSON.stringify(oldTarget?.transform)!==JSON.stringify(target?.transform))mark(n);}

 return [...groups.values()];
}
export function validateDetailReview(doc:SceneDocument,review:DetailReview):string[]{
 const errors:string[]=[];const members=doc.nodes.filter(n=>(n.assemblyId??n.id)===review.componentId);if(!members.length)return ['细节检查目标不存在'];
 if(review.revision!==doc.revision)errors.push('细节检查版本已过期');
 if(review.reusedCriteria?.length&&(!Number.isInteger(review.evidenceRevision)||review.evidenceRevision!>=review.revision||review.reusedCriteria.some(k=>!DETAIL_CRITERIA.some(c=>c.key===k))))errors.push('复用证据来源版本或项目无效');
 if(review.criterionEvidence&&Object.entries(review.criterionEvidence).some(([key,revision])=>!DETAIL_CRITERIA.some(c=>c.key===key)||!Number.isInteger(revision)||revision<0||revision>review.revision||(review.reusedCriteria?.includes(key as DetailCriterion)&&revision>=review.revision)))errors.push('逐项证据版本无效');
 const keys=review.checks.map(c=>c.criterion),missing=DETAIL_CRITERIA.filter(c=>!keys.includes(c.key));if(keys.length!==DETAIL_CRITERIA.length||new Set(keys).size!==DETAIL_CRITERIA.length||missing.length)errors.push('每个对象必须覆盖全部六项标准'+(missing.length?'；缺少：'+missing.map(c=>c.key+'（'+c.name+'）').join('、'):''));
 const ids=new Set(members.map(n=>n.id));
 const offSurface=inspectContactSurfaces(doc,doc.nodes.filter(n=>n.connection&&(ids.has(n.id)||ids.has(n.connection.targetId))).map(n=>n.id)).filter(c=>c.status==='off_surface');
 const materials=new Map(doc.materials.map(m=>[m.id,m]));
 const badUV=members.filter(n=>{const m=materials.get(n.materialId??'');if(!m?.surface&&!m?.maps)return false;const uv=inspectMeshUV(n);return uv.status==='missing'||uv.degenerateUV>Math.max(1,uv.triangles*.005);});
 const brokenConnections=connectionReport(doc).filter(c=>(ids.has(c.sourceId)||ids.has(c.targetId))&&c.status!=='within_tolerance');
 for(const c of review.checks){
  if(!['pass','fail','unknown','not_applicable'].includes(c.status)||!c.evidence?.trim()||c.evidence.length>600)errors.push('检查结论或依据无效');
  if(!Array.isArray(c.nodeIds)||c.nodeIds.length>16||c.nodeIds.some(id=>!ids.has(id)))errors.push('依据必须引用当前组件的真实部件');
  if(review.isolatedEvidence&&['connections','context'].includes(c.criterion)&&['pass','not_applicable'].includes(c.status)&&!(c.criterion==='context'&&review.contextEvidence)&&!review.reusedCriteria?.includes(c.criterion))errors.push('单体隔离图不能通过连接接触或场景关系，需完整上下文画面');
  if(c.criterion==='materials'&&['pass','not_applicable'].includes(c.status)&&review.geometryOnly)errors.push('软件几何检查图不支持材质验收，请使用真实渲染或保留unknown');
  if(c.criterion==='materials'&&['pass','not_applicable'].includes(c.status)&&badUV.length)errors.push('已使用贴图的部件存在缺失或塌缩UV，材质项需要修正后复核');
  if(c.criterion==='connections'&&['pass','not_applicable'].includes(c.status)&&members.some(n=>n.sceneRole==='person')&&!review.interactionEvidence&&!review.reusedCriteria?.includes('connections'))errors.push('人物连接项需当前版本手部与工具的两个局部视角，不能用全身或接触点代替');
  if(c.criterion==='connections'&&['pass','not_applicable'].includes(c.status)&&offSurface.length)errors.push('接触点偏离真实表面，不能以重合中心点当作有效接触');
  if(c.criterion==='connections'&&['pass','not_applicable'].includes(c.status)&&brokenConnections.length)errors.push('已登记接触关系存在分离或缺失，连接项不能通过或跳过');
  if(c.status==='pass'&&((!review.visualEvidence&&!(c.criterion==='context'&&review.contextEvidence)&&!review.reusedCriteria?.includes(c.criterion))||!c.nodeIds.length))errors.push('没有当前多角度近景或真实部件依据，不能标为通过');
  if(c.status==='not_applicable'&&['silhouette','details'].includes(c.criterion))errors.push('外形和用途相关细节始终需要检查；简单实体也应核对边缘/比例/表面，不得跳过');
 }
 return errors;
}
export function evaluateDetailAcceptance(base:SceneDocument,draft:SceneDocument,reviews:DetailReview[]):DetailAcceptance{
 const targets=detailTargets(base,draft),latest=reviews.filter(r=>r.revision===draft.revision&&targets.some(t=>t.id===r.componentId));const issues:string[]=[];let failed=false;
 for(const t of targets){const r=latest.find(r=>r.componentId===t.id);if(!r){issues.push(t.name+'：尚未完成六项细节验收');continue;}const invalid=validateDetailReview(draft,r);issues.push(...invalid.map(x=>t.name+'：'+x));for(const c of r.checks){if(c.status==='fail'){failed=true;issues.push(t.name+'：'+(DETAIL_CRITERIA.find(x=>x.key===c.criterion)?.name??c.criterion)+'不符合，'+c.evidence);}else if(c.status==='unknown')issues.push(t.name+'：'+(DETAIL_CRITERIA.find(x=>x.key===c.criterion)?.name??c.criterion)+'待核对，'+c.evidence);}}
 return {revision:draft.revision,status:!targets.length?'not_required':failed?'needs_work':issues.length?'pending':'self_reviewed',targets,reviews:latest,issues};
}
