import {sanitizeGenerationText} from './generationFailure';
import {DETAIL_CRITERIA} from './detailAcceptance';
import type {SceneDocument} from './types';
import type {DetailAcceptance,DetailCriterion} from './detailAcceptance';
import type {ReferenceRepairItem} from './referenceRepairs';
import {confirmedCompletionIssues} from './completionIssues';
export type PreviewCheckKind='shape'|'structure'|'connection'|'material'|'label'|'overall';
export const CHECK_GUIDES:Record<PreviewCheckKind,{title:string;method:string;limit:string}>={
 shape:{title:'外形与比例',method:'对照参考图，查看正面、侧面和斜侧面；比较外轮廓、分区高度、凹凸曲面及开口位置。需要精确尺寸时，在属性面板查看选中对象尺寸。',limit:'视角、遮挡和拍摄透视会影响观感。原图未给尺寸时，只能核对比例。'},
 structure:{title:'功能结构',method:'展开结构列表，检查图中可见的导轨、链条、支架和工作部件是否齐全，再从侧面检查前后层次与安装关系。',limit:'部件数量或命名正确不代表造型正确。看不到的背面结构需要补充资料。'},
 connection:{title:'连接与接触',method:'放大连接位置，从两个方向检查是否悬空、穿插、断开或偏离安装面；尤其检查支架端部和部件接缝。',limit:'画面检查不能替代实际装配、公差、强度或制造验收。'},
 material:{title:'材质与表面',method:'在实时三维画面中旋转模型，观察主色、金属反射、粗糙度和表面层次；用相近光照下的参考图对比。',limit:'软件几何预览不能验证材质，光照差异也不能直接当成配色错误。'},
 label:{title:'文字与标识',method:'打开原始参考图并放大对应区域，检查文字、警示图案的位置、方向和可读性。',limit:'原图模糊或文字不可辨认时，需补充清晰局部图，不能猜测品牌或标识内容。'},
 overall:{title:'综合检查',method:'按外形、结构、连接、材质、细节及场景关系逐项对照。已有明确差异应先修正，再检查其余未知项。',limit:'“尚未完成验收”表示证据不足，不等于每一项都错误，也不代表已经通过。'},
};
export interface PreviewCheck {id:string;text:string;kind:PreviewCheckKind;reportedDifference:boolean;limitation:boolean;nodeIds:string[]}
export interface PreviewCheckContext {document:SceneDocument;detailAcceptance?:DetailAcceptance;referenceRepairs?:ReferenceRepairItem[]}
const criterionKind:Record<DetailCriterion,PreviewCheckKind>={silhouette:'shape',structure:'structure',connections:'connection',materials:'material',details:'overall',context:'overall'};
const classify=(text:string):PreviewCheckKind=>/文字|标识|标牌|字样|可读|警示/.test(text)?'label':/材质|配色|反射|粗糙|纹理/.test(text)?'material':/连接|接触|悬空|穿插|支架|链条端/.test(text)?'connection':/轮廓|曲面|比例|凹|凸|外形|形状|尺寸/.test(text)?'shape':/门架|导轨|链条|滑架|货叉|结构|开口/.test(text)?'structure':'overall';
const normalized=(text:string)=>text.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'').replace(/capture-\d+/g,'').replace(/参考形体差异\s*[^：:]+[：:]|需求待核对[：:]|外形与比例(?:不符合|待核对)?[，,:：]?|尚未完成六项细节验收/g,'').replace(/[\s，,。；;：:、（）()“”"·]/g,'');
const sameText=(a:string,b:string)=>{const x=normalized(a),y=normalized(b);return x===y||(Math.min(x.length,y.length)>=8&&(x.includes(y)||y.includes(x)));};
const limited=(text:string)=>/(?:原图|参考|照片|资料|遮挡|尺寸|边界)/.test(text)&&/(?:未知|未给|未提供|无法(?:确认|验证|辨认|判断)|只能.*估|仅.*估|无绝对|没有.*尺寸)/.test(text)&&!/(?:已确认|明确存在|缺失|不符合|不符|穿插|悬空|断开|未还原|未实现)/.test(text);
export function previewChecks(issues:string[]|undefined,summary='',context?:PreviewCheckContext):PreviewCheck[]{
 const marker=summary.search(/(?:^|\n)(?:仍需改进|已知问题|细节验收未完成)[：:]/);
 const raw=issues??(marker<0?[]:summary.slice(marker).replace(/^\s*(?:仍需改进|已知问题|细节验收未完成)[：:]/,'').split(/\n+/));
 const nodes=context?.document.nodes??[];
 const idsFor=(text:string)=>nodes.filter(n=>text.includes(n.id)||(n.assemblyId&&text.includes(n.assemblyId))||(n.assemblyName&&text.includes(n.assemblyName))||(n.name&&text.includes(n.name))).map(n=>n.id);
 const groups=(ids:string[])=>[...new Set(ids.map(id=>{const n=nodes.find(n=>n.id===id);return n?.assemblyId??id;}))].sort().join('|');
 const rows:PreviewCheck[]=[];
 const add=(row:PreviewCheck)=>{const duplicate=rows.find(r=>sameText(r.text,row.text)&&(!r.nodeIds.length||!row.nodeIds.length||groups(r.nodeIds)===groups(row.nodeIds)));
  if(duplicate){duplicate.nodeIds=[...new Set([...duplicate.nodeIds,...row.nodeIds])];duplicate.reportedDifference||=row.reportedDifference;duplicate.limitation&&=row.limitation;return;}
  if(row.limitation&&/尺寸|边界/.test(row.text)){const prior=rows.find(r=>r.limitation&&/尺寸|边界/.test(r.text)&&r.kind===row.kind&&groups(r.nodeIds)===groups(row.nodeIds));if(prior)return;}
  rows.push(row);
 };
 const label=(ids:string[])=>[...new Set(ids.map(id=>{const n=nodes.find(n=>n.id===id);return n?.assemblyName??n?.name;}).filter(Boolean))].join('、');
 const repairs=context?.referenceRepairs??[];
 for(const repair of repairs){const ids=repair.nodeIds.filter(id=>nodes.some(n=>n.id===id));add({id:'reference:'+repair.id,text:(label(ids)?label(ids)+'：':'')+repair.observed,kind:classify(repair.observed+' '+repair.expected),nodeIds:ids,reportedDifference:true,limitation:false});}
 for(const review of context?.detailAcceptance?.reviews??[]){if(review.revision!==context?.document.revision)continue;for(const check of review.checks){if(check.status!=='fail'&&check.status!=='unknown')continue;if(check.evidence==='本项尚未提交复核结论，保持待核对')continue;const ids=nodes.filter(n=>(n.assemblyId??n.id)===review.componentId).map(n=>n.id);add({id:`detail:${review.componentId}:${check.criterion}`,text:(label(ids)?label(ids)+'：':'')+check.evidence,kind:criterionKind[check.criterion],nodeIds:check.nodeIds.length?check.nodeIds:ids,reportedDifference:check.status==='fail',limitation:check.status==='unknown'&&limited(check.evidence)});}}
 for(const text of [...new Set(raw.map(s=>s.trim()).filter(Boolean))]){const ids=idsFor(text),kind=classify(text),reportedDifference=confirmedCompletionIssues([text],true).length>0&&/未(?:还原|实现|生成|补齐)|缺失|缺少|不足|不清晰|不符合|不符|差异|与.{0,24}(?:不同|不符)|穿插|悬空|断开/.test(text);
  const current=context?.detailAcceptance?.reviews.filter(r=>r.revision===context.document.revision&&ids.some(id=>nodes.find(n=>n.id===id)?.assemblyId===r.componentId||id===r.componentId))??[];
  if(current.some(r=>r.checks.some(c=>{const criterion=DETAIL_CRITERIA.find(k=>k.key===c.criterion);return criterion&&text.includes(criterion.name)&&(text.includes(r.componentId)||nodes.some(n=>(n.assemblyId??n.id)===r.componentId&&!!n.assemblyName&&text.startsWith(n.assemblyName+'：')));})))continue;
  if(current.some(r=>r.checks.some(c=>sameText(text,c.evidence))))continue;
  if(context&&/尚未完成.*(?:六项|细节)验收/.test(text)&&ids.length&&current.length)continue;
  add({id:'legacy:'+normalized(text),text,kind,nodeIds:ids,reportedDifference,limitation:limited(text)});
 }
 return rows.flatMap(row=>{const text=sanitizeGenerationText(row.text,{fallback:' '}).trim();return text?[{...row,text}]:[];});
}
