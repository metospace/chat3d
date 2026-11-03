import {DETAIL_CRITERIA,type DetailCriterion,type DetailReview} from '../domain/detailAcceptance';
import {inspectReferenceRepair,type ReferenceRepairItem} from '../domain/referenceRepairs';
import type {SceneDocument} from '../domain/types';

export const REPAIR_AGENDA_LIMIT=8;
export type RepairNextAction='repair'|'verify-repair'|'review'|'inspect'|'submit';
export interface RepairAgendaInput {
 document:SceneDocument;
 referenceRepairs:ReferenceRepairItem[];
 detailReviews:DetailReview[];
 reviewIssues:string[];
 completionBlockers:string[];
 capturedRevision:number;
 reviewedRevision:number;
 /** Already compact shared source constraints; this helper does not invent or persist a second contract. */
 sharedSceneContract?:Readonly<Record<string,unknown>>;
}
export interface RepairAgendaItem {
 id:string;
 source:'reference-difference'|'detail-fail'|'detail-unknown'|'review-issue'|'completion-blocker';
 name:string;
 componentIds:string[];
 componentNames:string[];
 nodeIds:string[];
 missingNodeIds:string[];
 reportedRevision:number|null;
 /** Only reference differences have a saved geometry/transform/visibility fingerprint. */
 changedSinceReported:boolean|null;
 action:string;
 requiredViews:string[];
 observed?:string;
 expected?:string;
 criterion?:DetailCriterion;
}

/** Advisory selection of the next useful action, not a capture prohibition or an acceptance gate.
 * Explicit failures survive until re-reviewed; screenshots, metadata revisions and material edits
 * cannot establish that a reference shape defect has been repaired. */
export function buildRepairAgenda(input:RepairAgendaInput){
 const {document:doc,referenceRepairs,detailReviews,capturedRevision,reviewedRevision}=input;
 const nodes=new Map(doc.nodes.map(node=>[node.id,node]));
 const groups=new Map<string,{id:string;name:string}>();
 for(const node of doc.nodes){const id=node.assemblyId??node.id;if(!groups.has(id))groups.set(id,{id,name:node.assemblyName??node.name});}
 const references=(ids:string[])=>{
  const nodeIds=[...new Set(ids)].filter(id=>nodes.has(id));
  const componentIds=[...new Set(nodeIds.map(id=>{const node=nodes.get(id)!;return node.assemblyId??node.id;}))];
  return {nodeIds,missingNodeIds:[...new Set(ids)].filter(id=>!nodes.has(id)),componentIds,componentNames:componentIds.map(id=>groups.get(id)!.name)};
 };
 const defects:RepairAgendaItem[]=[],unknownEvidence:RepairAgendaItem[]=[];
 for(const item of referenceRepairs){
  const refs=references(item.nodeIds),inspection=inspectReferenceRepair(doc,item);
  defects.push({id:item.id,source:'reference-difference',name:(refs.componentNames.join('、')||item.featureKey)+'：'+item.featureKey,...refs,reportedRevision:item.reportedRevision,changedSinceReported:inspection.changedSinceReported,action:item.action,requiredViews:[item.view],observed:item.observed,expected:item.expected});
 }
 // An older failure must not override a later review, but an unexamined stale failure must not vanish.
 const latest=new Map<string,{review:DetailReview;check:DetailReview['checks'][number]}>();
 for(const review of detailReviews){
  if(review.revision>doc.revision)continue;
  for(const check of review.checks){const key=review.componentId+':'+check.criterion,previous=latest.get(key);if(!previous||review.revision>=previous.review.revision)latest.set(key,{review,check});}
 }
 for(const [id,{review,check}] of latest){
  if(check.status!=='fail'&&check.status!=='unknown')continue;
  const group=groups.get(review.componentId),refs=references(check.nodeIds),criterionName=DETAIL_CRITERIA.find(item=>item.key===check.criterion)!.name;
  const stale=review.revision!==doc.revision;
  const requiredViews=check.criterion==='context'?['perspective','top']:check.criterion==='connections'?['front','back','perspective']:['front','back'];
  const item:RepairAgendaItem={id,source:check.status==='fail'?'detail-fail':'detail-unknown',name:(group?.name??review.componentId)+'：'+criterionName,...refs,componentIds:group?[group.id]:refs.componentIds,componentNames:group?[group.name]:refs.componentNames,reportedRevision:review.revision,changedSinceReported:null,criterion:check.criterion,action:(check.status==='fail'?(stale?'先复核旧版缺陷，不假定版本增长代表已修复：':'修正已报告缺陷：'):'补充证据并核对：')+check.evidence,requiredViews,observed:check.evidence};
  (check.status==='fail'?defects:unknownEvidence).push(item);
 }
 const reviewIssues=[...new Set(input.reviewIssues)],completionBlockers=[...new Set(input.completionBlockers)];
 for(const [source,issues] of [['review-issue',reviewIssues],['completion-blocker',completionBlockers]] as const){
  for(const [index,issue] of issues.entries())unknownEvidence.push({id:source+':'+index,source,name:issue,componentIds:[],componentNames:[],nodeIds:[],missingNodeIds:[],reportedRevision:null,changedSinceReported:null,action:issue,requiredViews:[]});
 }
 defects.sort((a,b)=>{
  const aPriority=a.source==='reference-difference'?(a.changedSinceReported?2:0):a.reportedRevision===doc.revision?1:3;
  const bPriority=b.source==='reference-difference'?(b.changedSinceReported?2:0):b.reportedRevision===doc.revision?1:3;
  return aPriority-bPriority||a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
 });
 unknownEvidence.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const knownRepair=defects.some(item=>(item.source==='reference-difference'&&!item.changedSinceReported)||(item.source==='detail-fail'&&item.reportedRevision===doc.revision));
 const changedReference=defects.some(item=>item.source==='reference-difference'&&item.changedSinceReported);
 const currentCapture=capturedRevision===doc.revision,currentReview=reviewedRevision===doc.revision;
 let nextAction:RepairNextAction,reason:string;
 if(knownRepair){nextAction='repair';reason='已有明确未修正缺陷，先按差异修改命名部件；必要的诊断取图仍可使用。';}
 else if(changedReference){nextAction='verify-repair';reason='缺陷目标的几何、位置或可见性已变；获取当前同向证据并逐项复核，不自动清除原差异。';}
 else if(currentCapture&&!currentReview){nextAction='review';reason='已有当前版本截图尚未完成判读，先复核现有证据，不重复拍摄相同画面。';}
 else if(defects.length||unknownEvidence.length||!currentCapture||!currentReview){nextAction='inspect';reason='仍有未核对或旧版依据；针对缺失证据检查真实部件，不把unknown当作形体缺陷或合格。';}
 else{nextAction='submit';reason='本修复单未发现待处理项；仅建议尝试提交，仍须通过现有完整性与视觉验收规则。';}
 return {revision:doc.revision,nextAction,reason,defects:defects.slice(0,REPAIR_AGENDA_LIMIT),totalDefects:defects.length,remainingDefects:Math.max(0,defects.length-REPAIR_AGENDA_LIMIT),unknownEvidence:unknownEvidence.slice(0,REPAIR_AGENDA_LIMIT),totalUnknownEvidence:unknownEvidence.length,remainingUnknownEvidence:Math.max(0,unknownEvidence.length-REPAIR_AGENDA_LIMIT),reviewIssues:reviewIssues.slice(0,REPAIR_AGENDA_LIMIT),remainingReviewIssues:Math.max(0,reviewIssues.length-REPAIR_AGENDA_LIMIT),completionBlockers:completionBlockers.slice(0,REPAIR_AGENDA_LIMIT),remainingCompletionBlockers:Math.max(0,completionBlockers.length-REPAIR_AGENDA_LIMIT),...(input.sharedSceneContract?{sharedSceneContract:input.sharedSceneContract}:{}),advisory:true as const,submissionRequiresExistingGates:true as const};
}
