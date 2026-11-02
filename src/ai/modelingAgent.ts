import {agentSceneContext,targetedSceneContext,selectedAssemblies,compactAgentContext} from './agentContext';
import {structuredPartSchema,compositionSchema} from './agentSchemas';
import {buildModelingPrompt} from './agentPrompt';
export {agentSceneContext,targetedSceneContext,compactAgentContext} from './agentContext';
export {structuredPartSchema} from './agentSchemas';
import {STRUCTURED_PART_LIMIT} from '../domain/structureLimits';
import {boundSceneRead} from './sceneReadBudget';
import {confirmedCompletionIssues} from '../domain/completionIssues';
import {editReceipt} from '../domain/editReceipt';
import {normalizedUsage,providerHasUsage,executionMetadata,type UsageState} from './executionTelemetry';
import {bendExistingMesh} from '../domain/meshBend';
import {localEditContext} from '../domain/localEditContext';
import {worldPoseRig} from '../domain/poseRig';
import {poseRigContext,poseWithRigCommands} from '../domain/poseRigExecution';
import {assertPreservedAssetShape,preserveAssetShapeIntent,existingPoseCommands,hasAssetPoseChange} from '../domain/preservedPose';
import {listLibraryCategories} from '../domain/libraryCategories';
import {searchLibraryAssets} from '../domain/libraryAssetSearch';
import {FAST_STATIC_REVIEW_IMAGE_LIMIT, normalizeGenerationQuality, type GenerationQuality} from './generationPolicy';
import {generationReviewPlan} from './generationReviewPolicy';
import {validateBlueprintDimensions,validateStructuredRecipe,structuredFeatureBinding,withStructuredParts,restoreModelStructure,structureFrame} from '../domain/structuredComponent';
import {AssemblyValidationError,type AssemblyDefinition} from '../domain/assembly';
import {RepairAttempts,buildQualityRepairQueue} from '../domain/qualityRepair';
import {inspectAssetPreflight} from '../domain/assetPreflight';
import {inspectAssetInstance,alignAssetInstances} from '../domain/assetInstances';
import {assetQualityStatus,validateAssetQuality} from '../domain/assetQuality';
import {validateBlueprints,validateFeatureBindings,inspectBlueprintCoverage,DETAIL_LEVEL_GUIDANCE,type ObjectBlueprint,type FeatureBinding} from '../domain/objectBlueprint';
import {listModelAssets,readModelAsset,readAssetQuality} from '../domain/modelAssetStorage';
import {instantiateAsset} from '../domain/modelAssets';
import {normalizeTaskBudget,taskBudgetReason} from './taskBudget';
import {FailedEditBuffer,type EditPayload} from './failedEdit';
import {carryUnchangedReviews} from '../domain/incrementalReview';
import {suggestVisibleViews} from '../scene/softwareCapture';
import {inspectAccessRoute} from '../domain/accessRoute';
import {inspectTopology} from '../domain/topologyQuality';
import {diagnosticCaptureDocument,intrinsicCaptureDocument} from '../domain/diagnosticCapture';
import {inspectWorkcells} from '../domain/workcellQuality';
import {armEditCommands,type ArmEdit} from '../domain/armEdit';
import {buildHandPose,HAND_POSES} from '../scene/handPose';
import {interactionTargets} from '../domain/interactionQuality';
import {inspectClearance} from '../domain/clearance';
import {exposeTools,toolGroupNeeded,type OptionalToolGroup} from './toolExposure';
import {measureRequestFootprint,type RequestFootprint} from './requestFootprint';
import {targetCoversVisibleScene} from '../domain/visualReviewPlan';
import {CheckReuse} from './checkReuse';
import {inspectGeometryQuality} from '../domain/geometryQuality';
import {profileOpeningMetrics,referenceObservationCoverage,referenceShapeChanged} from '../domain/referenceShape';
import {runBoundedJobs,isolatedDocument,componentDraftCommand,type ChildRun} from './parallelDrafts';
import {inspectContactSurfaces} from '../domain/contactQuality';
import {surfaceBatchCommands} from '../domain/surfaceBatch';
import {projectMeshUV} from '../domain/uvProjection';
import {SURFACE_PRESETS} from '../domain/textures';
import {alignmentOffset,connectionReport,localPoint} from '../domain/connections';
import {findSceneParts,normalizePartQuery} from '../domain/sceneQuery';
import {DETAIL_CRITERIA,detailTargets,validateDetailReview,evaluateDetailAcceptance,type DetailReview,type DetailAcceptance} from '../domain/detailAcceptance';
import {MESH_CATALOG,loadMeshComponent} from '../scene/meshCatalog';
import {processRoute} from '../domain/processMotion';
import {industrialRecipe,RECIPE_NAMES} from '../domain/industrialRecipes';
import {quickEdit} from '../domain/quickEdit';
import {checkRequirements,mergeRequirements,type Requirement,type RequirementReport} from '../domain/requirements';
import {reviewRequirement,visualFingerprint} from '../domain/reviewPolicy';
import {resolveConversationIntent, requestsFullScene} from '../domain/conversationScope';
import {createAnimationEvaluator} from '../domain/animation';
import { Agent, type AgentTool, type StreamFn } from '@earendil-works/pi-agent-core';
import { validateToolArguments, Type, type Model, type ImageContent, type TSchema } from '@earendil-works/pi-ai';
import { stream } from '@earendil-works/pi-ai/api/openai-completions';
import { getFetch, parseModelResponse, type ModelConfig, type ConversationTurn } from './provider';
import { applyBatch, type Command, type CommandBatch, type ExecutionResult } from '../domain/commands';
import type { SceneDocument } from '../domain/types';
import {inspectSceneQuality,type CompositionPlan,type QualityReport} from '../domain/sceneQuality';
import { validateDocument, validateGeometry } from '../domain/types';
import { captureSceneEvidence, isSceneCaptureAvailable, type CaptureView, type EvidenceCapture } from '../scene/capture';
import {checkEditScope,type EditScope} from '../domain/editScope';
import { makeId } from '../util/ids';

import { AGENT_LIMITS } from './agentPolicy';
import { normalizeModelingRequestMessages } from './modelingRequest';
export { AGENT_LIMITS } from './agentPolicy';
export interface ActivityTiming { toolName?:string;repeatedInput?:boolean;argumentsChars?:number;resultChars?:number;sceneRevision?:number;firstContentAt?:number;responseAt?:number;usageState?:UsageState;uncachedInputTokens?:number;cacheReadTokens?:number;cacheWriteTokens?:number; id:string; kind:'model'|'tool'; label:string; startedAt:number; firstDataAt?:number; endedAt?:number; failed?:boolean; detail?:string; inputTokens?:number; outputTokens?:number; requestFootprint?:RequestFootprint }
export interface DesignBrief {flow:string[];layout:string;equipment:{name:string;count:number;features:string[]}[];checks:string[];composition?:CompositionPlan}
export interface AgentActivity {
  executionMeta?:ReturnType<typeof executionMetadata>;
  outcome?:'preview-ready'|'partial'|'answered'|'budget-exhausted'|'cancelled'|'failed';
  generationQuality?: GenerationQuality; // 本次任务开始时的快照，包括本地明确编辑
  generationReview?: {coverage:'basic-overview'|'component-multiview';staticImages:number;staticImageLimit:number|null;basicReviewCompleted:boolean};
  repairQueue?:ReturnType<typeof buildQualityRepairQueue>;
  objectBlueprints?:ObjectBlueprint[];
  featureBindings?:FeatureBinding[];
  blueprintCoverage?:ReturnType<typeof inspectBlueprintCoverage>;
  parallelRuns?:ChildRun[];
  usageIncomplete?:boolean;
  dataDraftSubmitted?:boolean;
  detailAcceptance?:DetailAcceptance;
  explanations?:{id:string;text:string}[];
  design?:DesignBrief;
  quality?:QualityReport;
  requirements?:RequirementReport;
  title: string; turn: number; toolCalls: number; characters: number;
  inputTokens: number; outputTokens: number; usageReported: boolean;
  lastEventAt: number; plan: string[]; events: string[]; timings: ActivityTiming[];
}
export interface AgentControl { steer: (id:string,text:string,images?:string[],mode?:'guide'|'question') => boolean }
export interface AgentResult { batch: CommandBatch; result: ExecutionResult; activity: AgentActivity }
interface AgentOptions {
  budgetState?:{startedAt:number;rounds:number;reportedTokens:number;controller:AbortController};
  workerTask?:boolean;
  workerStreamFn?:(name:string)=>StreamFn;
  qualityBaseline?:SceneDocument;
  text: string; config: ModelConfig; document: SceneDocument; selection: string[];
  images?: string[]; history?: ConversationTurn[]; signal?: AbortSignal; editScope?:EditScope;
  onActivity?: (activity: AgentActivity) => void;
  onPreview?: (doc: SceneDocument) => void;
  onCheckpoint?: (result: AgentResult) => void;
  onControl?: (control:AgentControl|null) => void;
  onSteeringApplied?: (id:string) => void;
  // Dependency injection for automated checks; production uses Pi's OpenAI-compatible adapter.
  streamFn?: StreamFn;
  captureAvailable?: () => boolean;
  captureEvidence?: EvidenceCapture;
  capture?: (doc: SceneDocument, view: CaptureView, targetIds?:string[],time?:number,signal?:AbortSignal) => Promise<string>;
}
const asImage = (url: string): ImageContent => {
  const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if(!m) throw new Error('参考图格式无效，请重新上传');
  return {type:'image',mimeType:m[1],data:m[2]};
};
const textResult = (text: string) => ({content:[{type:'text' as const,text}],details:{}});

export async function runModelingAgent(options: AgentOptions): Promise<AgentResult> {
  const cfg:ModelConfig={...options.config, generationQuality:normalizeGenerationQuality(options.config.generationQuality), taskBudget:options.config.taskBudget?{...options.config.taskBudget}:undefined};
  const generationQuality=normalizeGenerationQuality(cfg.generationQuality),isFast=generationQuality==='fast';
  let staticReviewImages=0;
  const outerSignal=options.signal;
  const budget=normalizeTaskBudget(cfg.taskBudget);
  const budgetState=options.budgetState??{startedAt:Date.now(),rounds:0,reportedTokens:0,controller:new AbortController()};
  const budgetStarted=budgetState.startedAt,budgetController=budgetState.controller;
  const signal=outerSignal?AbortSignal.any([outerSignal,budgetController.signal]):budgetController.signal;
  if(signal?.aborted) throw new DOMException('已停止','AbortError');
  const direct=!options.images?.length?quickEdit(options.text,options.document,options.selection,options.editScope):null;
  if(direct){
    const now=Date.now();const activity:AgentActivity={generationQuality,title:'明确编辑 · 本地执行（0 Token）',explanations:[{id:'local-edit',text:'目标和修改要求明确，已直接校验并完成这项编辑，保留其他场景内容。请查看预览后确认。'}],turn:0,toolCalls:0,characters:0,inputTokens:0,outputTokens:0,usageReported:true,lastEventAt:now,plan:[],events:['明确目标和单项指令通过本地数据及范围校验；未请求模型，仍需确认预览。'],timings:[{id:'direct',kind:'tool',label:'本地明确编辑',startedAt:now,endedAt:now}]};
    options.onActivity?.(activity);options.onPreview?.(direct.result.doc);return {...direct,activity};
  }
  const base=structuredClone(options.document);
  let draft=structuredClone(base);let localFocus:{ids:string[];radius:number}|undefined;
  const originallySelectedAssemblies=new Set(selectedAssemblies(base,options.selection));
  const selectionForDoc=(doc:SceneDocument)=>{const ids=new Set(options.selection);for(const n of doc.nodes)if(n.assemblyId&&originallySelectedAssemblies.has(n.assemblyId))ids.add(n.id);const existing=new Set(doc.nodes.map(n=>n.id));return [...ids].filter(id=>existing.has(id));};
  const resolvedIntent=resolveConversationIntent(options.text,options.history);
  const continuation=resolvedIntent!==options.text;
  let preserveAssetShape=preserveAssetShapeIntent(options.text,options.history);
  let wantsAnimation=/动起来|动画|动作|没有动|没动|运动|循环播放|animate/i.test(resolvedIntent)&&!/(不要|无需|不需要).{0,5}(?:动画|动作)/.test(resolvedIntent);
  const needsDesign=!options.workerTask&&base.nodes.length===0&&requestsFullScene(options.text);
  let requirements:Requirement[]=[];const userTexts=[resolvedIntent];const executionTexts=[resolvedIntent];let questionOnly=false,requirementsNeedRefresh=false;
  const operations: Command[]=[];
  const applied: ExecutionResult['applied']=[];
  let capturedRevision=-1, capturedTurn=-1, reviewedRevision=-1, reviewedWholeRevision=-1, captureScope='whole', submitted=false, summary='';
  let progressVersion=0, observedProgress=0, stagnantTurns=0, failedTurns=0, pauseReason='',lastToolError='';
  let turnActions:string[]=[],turnErrors:string[]=[];const rootToolErrors:string[]=[];
  let readRevision=-1,preparationReads=0,readProgressVisual='';const readScopes=new Set<string>(),knownReadIds=new Set<string>();
  const capturedViews=new Set<string>(),reviewedViews=new Set<string>();
  let latestCaptureKey='',animationCheckedRevision=-1;
  const progress=()=>{progressVersion++;};
  const recordReadProgress=(ids:string[])=>{const visual=visualFingerprint(draft);if(visual!==readProgressVisual){readProgressVisual=visual;knownReadIds.clear();preparationReads=0;}const fresh=ids.filter(id=>!knownReadIds.has(id));ids.forEach(id=>knownReadIds.add(id));if(fresh.length&&preparationReads<24){preparationReads++;progress();}};
  let reviewIssues:string[]=[];
  let submittedQualityIssues:string[]=[];
  let completionBlockers:string[]=[];
  let completionRecoveryTurns=0;
  let completionFingerprint='',completionEvidence='';
  const recordCompletionBlockers=(issues:string[])=>{completionBlockers=issues;completionFingerprint=issues.length?visualFingerprint(draft):'';completionEvidence=issues.length?latestCaptureKey.split(':').slice(1).join(':'):'';};
  let inspectionKey='';
  const reviewedStates=new Set<string>();const markReviewProgress=(reviews:DetailReview[])=>{let changed=false;for(const r of reviews){const key=JSON.stringify([r.componentId,r.revision,r.visualEvidence,r.interactionEvidence,r.isolatedEvidence,r.checks.map(c=>[c.criterion,c.status,[...c.nodeIds].sort()]).sort()]);if(!reviewedStates.has(key)){reviewedStates.add(key);changed=true;}}if(changed)progress();};
  let detailReviews:DetailReview[]=[];const repairAttempts=new RepairAttempts(),componentVersions=new Map<string,number>();
  const qualityBase=structuredClone(options.qualityBaseline??base);
  const refreshDetail=()=>{activity.detailAcceptance=evaluateDetailAcceptance(qualityBase,draft,detailReviews);activity.repairQueue=buildQualityRepairQueue(activity.detailAcceptance,{visual:visualAvailable(),geometryOnly:usedSoftwareCapture},repairAttempts);return activity.detailAcceptance;};
  const repairContext=()=>activity.repairQueue?{...activity.repairQueue,...(isFast?{instruction:'快速模式优先处理明确结构缺陷；inspect项保留待核对，不要求遍历全部细节。基础全景复核后可交付待确认草稿，不把pending当作通过。'}:{}),items:activity.repairQueue.items.slice(0,6).map(x=>({...x,reason:x.reason.slice(0,180)})),remaining:Math.max(0,activity.repairQueue.total-6)}:undefined;
  let visualFailure='',stageReason='';let usedSoftwareCapture=false;
  let parallelController:AbortController|null=null,parallelEpoch=0;
  const visualAvailable=()=>!visualFailure&&(options.captureAvailable?.()??(options.capture||options.captureEvidence?true:isSceneCaptureAvailable()));
  const unavailableStage=()=>{stageReason='三维视图不可用，已确定性结束本轮；'+(operations.length?'阶段草稿已保留，未经视觉验收，可手动确认或继续修改。':'本轮未修改场景，也未完成视觉验收。')+(visualFailure?' 截图错误：'+visualFailure:'');return stageReason;};
  const captureDraft=async(view:CaptureView,targetIds?:string[],time?:number,captureDocument:SceneDocument=draft)=>{
    if(!visualAvailable())throw new Error(unavailableStage());
    if(isFast&&time===undefined&&staticReviewImages>=FAST_STATIC_REVIEW_IMAGE_LIMIT){stageReason=`快速模式已完成${staticReviewImages}张静态检查图，本轮停止继续视觉润色；尚未核对或修复的项目仍未完成，可人工保留草稿或改用精细模式继续。`;throw new Error(stageReason);}
    try{
      const evidence=options.capture?null:await (options.captureEvidence??captureSceneEvidence)(captureDocument,view,targetIds,time,signal);
      if(evidence&&(evidence.projectId!==captureDocument.projectId||evidence.revision!==captureDocument.revision||evidence.view!==view||JSON.stringify(evidence.targetIds??[])!==JSON.stringify(targetIds??[])||evidence.time!==time))throw Error('检查图片与当前任务文档不匹配，不能用于验收');
      const data=evidence?.image??await options.capture!(captureDocument,view,targetIds,time,signal);
      if(time===undefined){staticReviewImages++;if(activity.generationReview)activity.generationReview={...activity.generationReview,staticImages:staticReviewImages};}
      if(evidence?.backend==='software'){usedSoftwareCapture=true;const info=evidence.softwareInfo;emit(info?.degraded?'软件截图因预算降为'+info.width+'×'+info.height+'；看不清的细节必须待验':'已使用软件几何检查图；不支持材质、阴影与动画验收',true);}return data;
    }
    catch(error){if(signal?.aborted)throw error;visualFailure=error instanceof Error?error.message:'截图失败';throw new Error(unavailableStage());}
  };
  let activity: AgentActivity={executionMeta:executionMetadata(cfg.model,cfg.apiKey,base.revision),generationQuality,generationReview:{coverage:isFast?'basic-overview':'component-multiview',staticImages:0,staticImageLimit:isFast?FAST_STATIC_REVIEW_IMAGE_LIMIT:null,basicReviewCompleted:false},title:'准备 Pi 建模任务',turn:0,toolCalls:0,characters:0,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:Date.now(),plan:[],events:[],timings:[]};
  const restoredStructure=restoreModelStructure(base);activity.objectBlueprints=restoredStructure.blueprints;activity.featureBindings=restoredStructure.bindings;
  const emit=(title:string,record=false) => {
    activity={...activity,title,lastEventAt:Date.now(),events:record?[...activity.events,title].slice(-30):activity.events};
    options.onActivity?.({...activity,plan:[...activity.plan],events:[...activity.events],timings:activity.timings.map(t=>({...t})),parallelRuns:activity.parallelRuns?.map(r=>({...r}))});
  };
  const checkpoint=(reason='任务尚未完成') : AgentResult => ({
    batch:{requestId:makeId(),projectId:base.projectId,baseRevision:base.revision,selectedIds:[...options.selection],editScope:options.editScope,
      taskStatus:'partial',incomplete:true,continuation:`继续完成原任务：${executionTexts.join('；补充：') || '根据参考图建模'}。当前场景是已保留的阶段成果，先检查现有对象，保留有效部分，不要重复创建；优先完成下一阶段。${visualAvailable()?'三维可用时截图复核。':'三维不可用，先保留数据修改；恢复视图后再做视觉验收，不要反复请求截图。'}`,
      qualityIssues:[...new Set([...reviewIssues,...completionBlockers,...(activity.detailAcceptance?.issues??[]),...(activity.blueprintCoverage?.issues??[]),...(activity.requirements?.items.filter(r=>r.status!=='pass').map(r=>`需求${r.status==='mismatch'?'不符':'待核对'}：${r.quote}；${r.actual}`)??[])])],
      summary:`${isFast?'快速模式 · ':''}阶段草稿已保留（未完成最终复核）\n${reason}\n已执行 ${operations.length} 项操作，当前 ${draft.nodes.length} 个对象。请人工检查后保留此阶段，或放弃。`+(reviewIssues.length?'\n已知问题：'+reviewIssues.join('；'):''),operations:structuredClone(operations)},
    result:{doc:structuredClone(draft),applied:structuredClone(applied),errors:[]},activity:structuredClone({...activity,outcome:stageReason?'budget-exhausted' as const:'partial' as const})
  });
  const stamp=(id:string,patch:Partial<ActivityTiming>)=>{activity.timings=activity.timings.map(t=>t.id===id?{...t,...patch}:t);};
  const firstData=()=>{const t=activity.timings.find(t=>t.id===`model-${calls}`);if(t && t.firstDataAt===undefined)stamp(t.id,{firstDataAt:Date.now()});};
  const budgetExceeded=(beforeRequest=false)=>taskBudgetReason(budget,Date.now()-budgetStarted,budgetState.rounds,budgetState.reportedTokens,beforeRequest);
  const check=() => {if(budgetController.signal.aborted)throw new Error(stageReason||budgetExceeded());if(signal?.aborted)throw new DOMException('已停止','AbortError');};
  const enabledToolGroups=new Set<OptionalToolGroup>();
  const checkReuse=new CheckReuse(),captureReuse=new CheckReuse();const captureTools=new Set(['capture_view','capture_multiview','capture_component_intrinsic','capture_quality_review']);
  let structuredIssues:number|undefined;const failedStructured=new FailedEditBuffer();const schemaFailures=new Set<string>();let replayingStructured=false;const structuredTools=new Set(['build_structured_component','repair_structured_features']);const structuredRetryScope=()=>JSON.stringify([executionTexts,activity.objectBlueprints]);
  const reusableChecks=new Set(['inspect_view_visibility','audit_model_detail','audit_model_details_batch','inspect_access_route','inspect_part_topology','detail_quality_standard','inspect_connections','inspect_contact_surfaces','check_requirements','inspect_model_quality','inspect_clearance','inspect_workcells']);
  const tool=<T extends TSchema>(name:string,label:string,description:string,parameters:T,execute:AgentTool<T>['execute']):AgentTool<any>=>({name,label,description,parameters,executionMode:'sequential',execute:(async(...args:Parameters<AgentTool<T>['execute']>)=>{
    check();
    const captureArgs=args[1] as {views?:string[]};const captureKey=JSON.stringify([name,Array.isArray(captureArgs.views)?{...captureArgs,views:[...captureArgs.views].sort()}:captureArgs]);if(captureTools.has(name)&&captureReuse.seen(draft.revision,captureKey))return textResult(JSON.stringify({revision:draft.revision,repeated:true,next:'当前版本相同目标和视角的真实图片已返回，请复用图片进行检查；没有几何修改或新增取景目的时不要重复取图。无法判断保留unknown，已有检查完成即可提交预览。'}));
    const key=JSON.stringify([name,args[1],requirements,requirementsNeedRefresh,executionTexts,activity.design,activity.objectBlueprints,activity.featureBindings,detailReviews,visualAvailable()]);
    if(reusableChecks.has(name)&&checkReuse.seen(draft.revision,key))return textResult(JSON.stringify({revision:draft.revision,repeated:true,tool:name,next:'本版本同参数检查结果已返回且没有变化，请复用前面的结果。只修正具体问题，unknown不等于通过，不要重复检查获取进展。'}));
    const toolRevision=draft.revision;try{const result=await execute(...args);
    if(reusableChecks.has(name))checkReuse.remember(draft.revision,JSON.stringify([name,args[1],requirements,requirementsNeedRefresh,executionTexts,activity.design,activity.objectBlueprints,activity.featureBindings,detailReviews,visualAvailable()]));
    if(captureTools.has(name))captureReuse.remember(toolRevision,captureKey);
    if(structuredTools.has(name)&&!replayingStructured)failedStructured.clear();return result;
    }catch(error){if(structuredTools.has(name)&&!replayingStructured&&!signal?.aborted&&draft.revision===toolRevision){structuredIssues=error instanceof AssemblyValidationError?error.issues.length:undefined;const cached=failedStructured.remember(args[0],draft.revision,structuredRetryScope(),{summary:name,operations:[{tool:name,args:args[1]}]});throw Error((error instanceof Error?error.message:String(error))+(cached?' 失败结构ID='+args[0]+'；用retry_structured_component只纠正错误字段，保留原结构计划，最多两次，无需重写整组零件。':''));}throw error;}
  }) as AgentTool['execute']});

  const assertPoseGoal=()=>{if(preserveAssetShape&&base.nodes.some(n=>n.modelAsset)&&!hasAssetPoseChange(base,draft,/手|臂|扶|握|按键|封箱|点赞|hand|grip/i.test([resolvedIntent,...(options.history??[]).slice(-6).map(m=>m.text)].join('\n'))))throw Error('姿态目标尚未实现：命名、结构绑定或整个人物平移不能代替手臂/关节调整。不能提交为已完成；若原模型无法独立转动，请明确说明并保留未完成状态。');};
  const commitEdits=async(args:{summary:string;operations:Command[]},validateResult?:(doc:SceneDocument)=>void,preservationBaseline?:SceneDocument)=>{
      check();if(needsDesign&&!activity.plan.length)throw new Error('完整新场景请先调用 plan_model 说明建模步骤');
      if(submitted)throw new Error('已提交预览，本轮不能继续修改');
      const result=applyBatch(draft,{operations:args.operations});
      if(preserveAssetShape)assertPreservedAssetShape(preservationBaseline??draft,result.doc);
      if(result.errors.length)throw new Error(result.errors.map(e=>e.message).join('；'));
      const scopeErrors=checkEditScope(base,result.doc,options.editScope);if(scopeErrors.length)throw new Error(scopeErrors.join('；'));
      const errors=validateDocument(result.doc);if(errors.length)throw new Error(errors.map(e=>e.message).join('；'));
      validateResult?.(result.doc);check();
      const changed=JSON.stringify(draft.nodes)!==JSON.stringify(result.doc.nodes)||JSON.stringify(draft.materials)!==JSON.stringify(result.doc.materials)||JSON.stringify(draft.animation)!==JSON.stringify(result.doc.animation);
      if(!changed)throw new Error('本次操作未改变场景，请执行计划中的有效修改或复核提交');
      const receipt=editReceipt(draft,result.doc);
      const oldRevision=draft.revision,sameVisual=visualFingerprint(draft)===visualFingerprint(result.doc);
      if(!sameVisual||!args.operations.every(op=>op.op==='rename'))progress();
      for(const t of detailTargets(draft,result.doc))componentVersions.set(t.id,result.doc.revision);detailReviews=carryUnchangedReviews(draft,result.doc,detailReviews);draft=result.doc;
      const saved=restoreModelStructure(draft),plans=new Map((activity.objectBlueprints??[]).map(p=>[p.key,p]));for(const p of saved.blueprints)if(!plans.has(p.key))plans.set(p.key,p);activity.objectBlueprints=[...plans.values()];activity.featureBindings=saved.bindings.filter(b=>JSON.stringify(saved.blueprints.find(p=>p.key===b.blueprintKey))===JSON.stringify(plans.get(b.blueprintKey)));activity.blueprintCoverage=inspectBlueprintCoverage(draft,activity.objectBlueprints,activity.featureBindings);refreshDetail();if(requirements.length)activity.requirements=checkRequirements(draft,requirements);applied.push(...result.applied);operations.push(...args.operations);
      if(sameVisual){for(const evidence of [capturedViews,reviewedViews])for(const key of [...evidence])if(key.startsWith(oldRevision+':'))evidence.add(draft.revision+key.slice(String(oldRevision).length));if(latestCaptureKey.startsWith(oldRevision+':'))latestCaptureKey=draft.revision+latestCaptureKey.slice(String(oldRevision).length);if(capturedRevision===oldRevision)capturedRevision=draft.revision;if(reviewedRevision===oldRevision)reviewedRevision=draft.revision;if(reviewedWholeRevision===oldRevision)reviewedWholeRevision=draft.revision;if(animationCheckedRevision===oldRevision)animationCheckedRevision=draft.revision;}else reviewedRevision=-1;
      options.onCheckpoint?.(checkpoint());options.onPreview?.(draft);emit(`草稿已更新：${args.summary}（共 ${draft.nodes.length} 个对象）`,true);
      return {...textResult(JSON.stringify({revision:draft.revision,scene:receipt,review:reviewRequirement(base,draft),geometryWarnings:inspectGeometryQuality(draft),profileOpenings:profileOpeningMetrics(draft),next:visualAvailable()?'按实际修改复核：none无需截图可提交；local可用受影响组件近景；whole需全景；animation需动态样本。截图后下一轮review_model。完成用户要求即可提交，不要追加无关工序。':'三维不可用。继续完成用户要求的全部数据编辑和数量/尺寸检查；不要遗漏其他对象。完成后调用submit_data_preview保留未视觉验收草稿，不要请求截图。'})),details:{revision:draft.revision}};
  };
  const armSchema=Type.Object({assemblyId:Type.String(),replaceIds:Type.Array(Type.String(),{minItems:1,maxItems:30}),shoulder:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),elbowHint:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),upperLength:Type.Number({minimum:.03,maximum:2}),forearmLength:Type.Number({minimum:.03,maximum:2}),target:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),operation:Type.Union([Type.Literal('press'),Type.Literal('grasp'),Type.Literal('reach'),Type.Literal('support')]),forward:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),dorsal:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),handedness:Type.Union([Type.Literal('left'),Type.Literal('right')]),pose:Type.Union(HAND_POSES.map(p=>Type.Literal(p))),skinMaterialId:Type.String(),sleeveMaterialId:Type.String(),gripDiameter:Type.Optional(Type.Number({minimum:.012,maximum:.08})),contactNormal:Type.Optional(Type.Tuple([Type.Number(),Type.Number(),Type.Number()]))});
  const armArgs=(args:any):ArmEdit=>({...args,hand:{forward:args.forward,dorsal:args.dorsal,handedness:args.handedness,pose:args.pose,gripDiameter:args.gripDiameter}});
  const prepareDetailReview=(args:{componentId:string;checks:DetailReview["checks"]}):DetailReview=>{const targets=detailTargets(qualityBase,draft);if(!targets.some(t=>t.id===args.componentId))throw Error('目标不在本轮细节验收范围');const closeup=new Set([...capturedViews].filter(key=>key.startsWith(draft.revision+':')&&key.endsWith(':'+args.componentId)).map(key=>key.split(':')[1])).size>=2;const intrinsic=new Set([...capturedViews].filter(key=>key.startsWith(draft.revision+':')&&key.endsWith(':intrinsic-'+args.componentId)).map(key=>key.split(':')[1])).size>=2;const singleWhole=targets.length===1&&new Set([...capturedViews].filter(key=>key.startsWith(draft.revision+':')&&key.endsWith(':whole')).map(key=>key.split(':')[1])).size>=2&&new Set(draft.nodes.filter(n=>n.visible).map(n=>n.assemblyId??n.id)).size===1;const previous=detailReviews.find(r=>r.componentId===args.componentId&&r.revision===draft.revision);if(new Set(args.checks.map(c=>c.criterion)).size!==args.checks.length)throw Error('验收标准不能重复');const updated=new Map(args.checks.map(c=>[c.criterion,c]));const merged=previous?.reusedCriteria?.length?previous.checks.map(c=>updated.get(c.criterion)??c):args.checks;const retained=previous?.reusedCriteria?.filter(k=>!updated.has(k));const criterionEvidence=Object.fromEntries(merged.map(c=>[c.criterion,retained?.includes(c.criterion)?(previous?.criterionEvidence?.[c.criterion]??previous?.evidenceRevision??draft.revision):draft.revision]));const review:DetailReview={componentId:args.componentId,checks:merged,criterionEvidence,...(retained?.length?{reusedCriteria:retained,evidenceRevision:Math.min(...retained.map(k=>criterionEvidence[k]))}:{}),geometryOnly:usedSoftwareCapture,isolatedEvidence:intrinsic&&!closeup&&!singleWhole,contextEvidence:visualAvailable()&&calls>capturedTurn&&new Set([...capturedViews].filter(key=>key.startsWith(draft.revision+':')&&key.endsWith(':whole')).map(key=>key.split(':')[1])).size>=2,revision:draft.revision,interactionEvidence:new Set([...capturedViews].filter(key=>key.startsWith(draft.revision+':')&&key.endsWith(':interaction-'+args.componentId)).map(key=>key.split(':')[1])).size>=2,visualEvidence:visualAvailable()&&calls>capturedTurn&&(closeup||singleWhole||intrinsic)};const errors=validateDetailReview(draft,review);if(errors.length)throw Error(errors.join('；'));return review;};
  const failedEdits=new FailedEditBuffer();
  const executeSceneEdit=async(args:EditPayload)=>{
      let parsed:ReturnType<typeof parseModelResponse>;const hint=args.operations.some((op:any)=>op?.op==='translateAssembly')?' 整组平移请优先move_components；edit_scene准确格式为 {op:\'translateAssembly\',targetId:\'真实部件ID\',value:[dx,dy,dz]}，不是offset或position字段。':'';
      const explain=()=>{
        const invalid:string[]=[];
        args.operations.forEach((raw:any,i)=>{const parts=raw?.op==='createAssembly'?raw.parts:[raw];if(!Array.isArray(parts))return;parts.forEach((part:any,j)=>{if(!part?.geometry)return;try{const errors=validateGeometry(part.geometry);if(errors.length)invalid.push(`操作${i+1}${raw.op==='createAssembly'?'部件'+(j+1):''} ${String(part.name??'').slice(0,60)}：${errors.map(e=>e.message).join('；')}`);}catch{invalid.push(`操作${i+1}几何结构无效`);}});});
return invalid.slice(0,8).join('；');};
      try{parsed=parseModelResponse(JSON.stringify(args));}catch(e){throw Error('整组拒绝，未写入任何修改。'+(explain()||(e instanceof Error?e.message:'命令参数无效'))+hint);}
      if(parsed.operations.length!==args.operations.length)throw Error('整组拒绝，未写入任何修改。'+(explain()||parsed.summary||'存在不支持或无效的操作，请检查命令字段。')+hint);
      return commitEdits({summary:args.summary,operations:parsed.operations});
    };
  const tools: AgentTool<any>[]=[
    tool('enable_modeling_tools','启用按需建模工具','按需要启用完整工具组，下一轮提供参数定义：animation为动画/路线/动态预览；surfaces为贴图、表面细节、UV；interaction为手型与肩肘腕联动；assets为已保存资产的读取/插入/检查；connections为连接与接触检查。需要某组能力时先启用，不要用其他工具假装完成。基础材质与造型命令仍在edit_scene。只增加本轮工具说明，不执行修改。',Type.Object({group:Type.Union([Type.Literal('animation'),Type.Literal('surfaces'),Type.Literal('interaction'),Type.Literal('assets'),Type.Literal('connections')])}),async(_id,args)=>{enabledToolGroups.add(args.group);return textResult('工具组已启用，下一轮查看完整参数定义再调用；不改变场景。');}),
    tool('detail_quality_standard','读取通用细节验收标准','适用于任何单独模型和完整场景，不限工业或已有网格。返回六项标准及本轮新增/改结构对象。按用途具体化，不以零件数当质量。无截图时只能待核对；有未达标项应先修正。',Type.Object({}),async()=>textResult(JSON.stringify({criteria:DETAIL_CRITERIA,acceptance:refreshDetail(),instruction:isFast?'快速模式先完整构建明确需求，再做基础全景复核。六项完整验收标准不降低，但未拍近景或无证据的项目保持未验收；不要为了填写清单追加取图。':'先完成全部结构，再按每个目标的近景核对六项；按repairQueue先修明确缺陷，blocked不要重复取图，deferred保留缺陷并停止该项重试；无近景时保留未验收状态。现成网格也不豁免。'}))),
    tool('audit_model_detail','记录对象细节验收','逐对象记录六项验收，componentId用detail_quality_standard返回的真实ID，nodeIds引用当前组件内真实部件。pass必须有当前版本至少两个不同近景视角（优先capture_multiview）且在截图返回的下一轮调用。fail需说明待修正，unknown如实保留，not_applicable说明对象用途为何不需要；外形与细节不能跳过。有明确reusedCriteria时只需补交失效项目；没有可复用记录时仍需六项齐全。自检不是人工验收。',Type.Object({componentId:Type.String(),checks:Type.Array(Type.Object({criterion:Type.Union(DETAIL_CRITERIA.map(c=>Type.Literal(c.key))),status:Type.Union(['pass','fail','unknown','not_applicable'].map(x=>Type.Literal(x))),evidence:Type.String({minLength:5,maxLength:600}),nodeIds:Type.Array(Type.String(),{maxItems:16})}),{minItems:1,maxItems:6})}),async(_id,args)=>{check();const review=prepareDetailReview(args);detailReviews=[...detailReviews.filter(r=>r.componentId!==args.componentId),review];repairAttempts.record([review],componentVersions);markReviewProgress([review]);const report=refreshDetail();emit('已记录对象细节检查；'+report.issues.length+'项未验收',true);return {...textResult(JSON.stringify({revision:report.revision,status:report.status,review,repairQueue:repairContext(),remaining:report.issues.slice(0,12),remainingCount:report.issues.length,unreviewed:report.targets.filter(t=>!report.reviews.some(r=>r.componentId===t.id)).map(t=>({id:t.id,name:t.name}))})),details:{revision:draft.revision,componentId:args.componentId}};}),
    tool('prepare_surface_uv','建立网格投影UV','为缺少UV的现有网格生成平面、圆柱或按面法线分割的盒投影。盒投影适合多面外壳但会产生接缝。按当前世界轴投影并烘焙到网格，不改变形状或位置。仅为基础投影，复杂角色/多面资产仍需专门UV展开和逐面检查，不能冒称无拉伸。axis是平面的法向或圆柱轴，默认Y。',Type.Object({targetId:Type.String(),mode:Type.Union([Type.Literal('planar'),Type.Literal('cylindrical'),Type.Literal('box')]),axis:Type.Optional(Type.Union([Type.Literal('x'),Type.Literal('y'),Type.Literal('z')]))}),async(_id,args)=>{const node=draft.nodes.find(n=>n.id===args.targetId);if(!node)throw Error('目标部件不存在');return commitEdits({summary:'建立表面UV投影',operations:[{op:'updateParameters',targetId:node.id,geometry:projectMeshUV(node,args.mode,args.axis)}]});}),
    tool('set_surface_detail','设置材质表面细节','为选定部件增加可导出的程序化法线/粗糙度细节：拉丝金属、喷粉、橡胶、布料、木纹或混凝土。保留原颜色与材质参数，替换已有法线/粗糙度贴图；不把整机玻璃和人体一并刷成金属。repeat为UV重复次数，strength为0–1；先按材质筛选真实部件。表面纹理不是几何细节的替代。',Type.Object({targetId:Type.String(),preset:Type.Union(SURFACE_PRESETS.map(x=>Type.Literal(x))),repeat:Type.Tuple([Type.Number({exclusiveMinimum:0,maximum:100}),Type.Number({exclusiveMinimum:0,maximum:100})]),strength:Type.Number({minimum:0,maximum:1}),scope:Type.Optional(Type.Literal('assembly')),sourceMaterialIds:Type.Optional(Type.Array(Type.String(),{maxItems:20}))}),async(_id,args)=>{const {targetId,scope,sourceMaterialIds,...surface}=args;return commitEdits({summary:'增加材质表面细节',operations:[{op:'setSurface',targetId,scope,sourceMaterialIds,surface}]});}),
    tool('audit_model_details_batch','批量记录细节验收','看过当前版本同一组图片后，一次记录1–8个真实组件的六项验收。每项仍须真实节点和当前多视角证据，软件图不能材质通过。任一条失败整组不保留，避免半成功。已知unknown如实一次记录，不为无法判断的项重复取图。',Type.Object({reviews:Type.Array(Type.Object({componentId:Type.String(),checks:Type.Array(Type.Object({criterion:Type.Union(DETAIL_CRITERIA.map(c=>Type.Literal(c.key))),status:Type.Union(['pass','fail','unknown','not_applicable'].map(x=>Type.Literal(x))),evidence:Type.String({minLength:5,maxLength:600}),nodeIds:Type.Array(Type.String(),{maxItems:16})}),{minItems:1,maxItems:6})}),{minItems:1,maxItems:8})}),async(_id,args)=>{
      check();if(new Set(args.reviews.map((r:any)=>r.componentId)).size!==args.reviews.length)throw Error('批量检查组件不能重复');
      const reviews=args.reviews.map(prepareDetailReview);const ids=new Set(reviews.map((r:DetailReview)=>r.componentId));detailReviews=[...detailReviews.filter(r=>!ids.has(r.componentId)),...reviews];repairAttempts.record(reviews,componentVersions);markReviewProgress(reviews);
      const report=refreshDetail();emit('已批量记录'+reviews.length+'个对象；'+report.issues.length+'项未验收',true);return {...textResult(JSON.stringify({revision:report.revision,status:report.status,repairQueue:repairContext(),recorded:args.reviews.map((r:any)=>r.componentId),remainingCount:report.issues.length,remaining:report.issues.slice(0,12),unreviewed:report.targets.filter(t=>!report.reviews.some(r=>r.componentId===t.id)).map(t=>({id:t.id,name:t.name}))})),details:{revision:draft.revision,componentIds:args.reviews.map((r:any)=>r.componentId)}};
    }),
    tool('set_surfaces_batch','批量处理材质与缺失UV','为1–32个真实部件一次处理表面。先find_scene_parts确认材质和UV，仅选择确实需要的零件。缺UV时可明确uvIfMissing基础投影；已有UV保持不变。全部成功才提交，不会部分修改。基础投影仍需检查接缝/拉伸，不能宣称专业展开。',Type.Object({items:Type.Array(Type.Object({targetId:Type.String(),surface:Type.Object({preset:Type.Union(SURFACE_PRESETS.map(x=>Type.Literal(x))),repeat:Type.Tuple([Type.Number({exclusiveMinimum:0,maximum:100}),Type.Number({exclusiveMinimum:0,maximum:100})]),strength:Type.Number({minimum:0,maximum:1})}),uvIfMissing:Type.Optional(Type.Object({mode:Type.Union([Type.Literal('planar'),Type.Literal('cylindrical'),Type.Literal('box')]),axis:Type.Optional(Type.Union([Type.Literal('x'),Type.Literal('y'),Type.Literal('z')]))}))}),{minItems:1,maxItems:32})}),async(_id,args)=>commitEdits({summary:'批量处理表面及缺失UV',operations:surfaceBatchCommands(draft,args.items)})),
    tool('connect_scene_parts','记录或对齐对象连接','sourceId为来源部件、targetId为目标部件，sourcePoint/targetPoint为接触点；coordinateSpace默认local，也可明确world由工具转换。需根据实际几何表面选择，不能以包围盒中心冒充接触面。maxDistance为允许间距米。align=true将来源所在整个组件平移使两点重合，不旋转、不做骨骼姿态/碰撞修复。先核对朝向、局部点和编辑范围；默认只记录关系。以后对象移动时inspect_scene会检查是否分离。',Type.Object({sourceId:Type.String(),targetId:Type.String(),sourcePoint:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),targetPoint:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),maxDistance:Type.Number({exclusiveMinimum:0,maximum:10}),purpose:Type.String({minLength:1,maxLength:160}),coordinateSpace:Type.Optional(Type.Union([Type.Literal('local'),Type.Literal('world')])),align:Type.Optional(Type.Boolean())}),async(_id,args)=>{const {sourceId,align,coordinateSpace,...connection}=args;if(coordinateSpace==='world'){const source=draft.nodes.find(n=>n.id===sourceId),target=draft.nodes.find(n=>n.id===connection.targetId);if(!source||!target)throw Error('连接对象不存在');connection.sourcePoint=localPoint(source,connection.sourcePoint);connection.targetPoint=localPoint(target,connection.targetPoint);}const ops:Command[]=[];if(align)ops.push({op:'translateAssembly',targetId:sourceId,value:alignmentOffset(draft,sourceId,connection)});ops.push({op:'setConnection',targetId:sourceId,connection});return commitEdits({summary:'记录连接：'+connection.purpose,operations:ops});}),
    tool('inspect_connections','检查对象连接','按最新变换测量已登记接触点的间距；只说明点距离，不等于工艺、姿态或碰撞验收。',Type.Object({}),async()=>textResult(JSON.stringify(connectionReport(draft)))),
    tool('inspect_contact_surfaces','检查接触点是否落在表面','检查登记点到真实三角面的最近距离，识别两点重合却藏在物体中心的错误连接。sourceIds可限定来源部件；超出计算预算为unknown。结果不代表全模型碰撞检测，不能宣称没有穿模。',Type.Object({sourceIds:Type.Optional(Type.Array(Type.String(),{maxItems:32}))}),async(_id,args)=>textResult(JSON.stringify(inspectContactSurfaces(draft,args.sourceIds)))),
    tool('remove_connection','解除对象连接','解除sourceId部件登记的连接，不移动或删除对象。删除被关联目标前需先明确解除关系。',Type.Object({sourceId:Type.String()}),async(_id,args)=>commitEdits({summary:'解除连接',operations:[{op:'setConnection',targetId:args.sourceId,connection:null}]})),
    tool('move_components','批量平移组件','移动一个或多个现有组件，targetId用其任意真实部件ID。delta是世界坐标位移增量（米），不是绝对目标点；每个组件只能出现一次，保留朝向/尺寸。需要旋转用transformAssembly。',Type.Object({items:Type.Array(Type.Object({targetId:Type.String(),delta:Type.Tuple([Type.Number(),Type.Number(),Type.Number()])}),{minItems:1,maxItems:16})}),async(_id,args)=>{const groups=new Set<string>();for(const item of args.items){const n=draft.nodes.find(n=>n.id===item.targetId);if(!n)throw Error('移动目标不存在');const id=n.assemblyId??n.id;if(groups.has(id))throw Error('同一组件在一批中只能平移一次');groups.add(id);}return commitEdits({summary:'批量调整组件位置',operations:args.items.map(item=>({op:'translateAssembly',targetId:item.targetId,value:item.delta}))});}),
    tool('find_scene_parts_batch','批量定位本次修改对象','一次查齐本次修改涉及的多个组件和交互目标；优先合并人物手臂、衣袖、设备面板、工具握柄等查询，避免逐个往返。返回真实ID、变换和边界，不包含大网格。',Type.Object({queries:Type.Array(Type.Object({assemblyId:Type.Optional(Type.String()),terms:Type.Optional(Type.Array(Type.String({maxLength:80}),{maxItems:12})),limit:Type.Optional(Type.Integer({minimum:1,maximum:48})),offset:Type.Optional(Type.Integer({minimum:0})),fields:Type.Optional(Type.Union([Type.Literal('placement'),Type.Literal('surface'),Type.Literal('all')]))}),{minItems:1,maxItems:8})}),async(_id,args)=>{check();const queries=args.queries.map(normalizePartQuery),scopeKey='parts-batch:'+JSON.stringify(queries);if(readRevision!==draft.revision){readRevision=draft.revision;readScopes.clear();}if(readScopes.has(scopeKey))return textResult(JSON.stringify({repeated:true,revision:draft.revision,next:'该批查询已返回，请复用已有ID，不要重复查询。'}));const results=queries.map(q=>findSceneParts(draft,q));readScopes.add(scopeKey);recordReadProgress(results.flatMap(r=>r.parts.map(p=>p.id)));return {...textResult(JSON.stringify({revision:draft.revision,queries:results.map((r,i)=>({query:queries[i],total:r.total,ids:r.parts.map(p=>p.id),nextOffset:r.nextOffset})),parts:[...new Map(results.flatMap(r=>r.parts).map(p=>[p.id,p])).values()]})),details:{revision:draft.revision,scopeKey,snapshot:true}};}),
    tool('find_scene_parts','定位需要的部件','默认fields=placement只返回布局字段；材质或UV检查时明确fields=surface。一次合并多个目标关键词，避免逐个对象往返。用名称关键词查询真实部件ID、变换和世界包围盒，不读取全部组件。terms为匹配任意一个关键词；空词返回分页。优先用此工具找到控制台/手/接口/门/主轴等局部目标。返回的中心是包围盒中心，不保证是接触面。',Type.Object({assemblyId:Type.Optional(Type.String()),terms:Type.Optional(Type.Array(Type.String({maxLength:80}),{maxItems:12})),offset:Type.Optional(Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER})),limit:Type.Optional(Type.Integer({minimum:1,maximum:48})),fields:Type.Optional(Type.Union([Type.Literal('placement'),Type.Literal('surface'),Type.Literal('all')]))}),async(_id,args)=>{check();args=normalizePartQuery(args);const scopeKey='parts:'+JSON.stringify(args);if(readRevision!==draft.revision){readRevision=draft.revision;readScopes.clear();}if(readScopes.has(scopeKey))return textResult(JSON.stringify({revision:draft.revision,scopeKey,repeated:true,next:'相同查询数据仍在上下文，使用现有ID继续修改或提交；场景未改变无需重复查询。'}));readScopes.add(scopeKey);if(readScopes.size>24)readScopes.delete(readScopes.values().next().value!);const result=findSceneParts(draft,args);recordReadProgress(result.parts.map(p=>p.id));return {...textResult(JSON.stringify(result)),details:{revision:draft.revision,scopeKey,snapshot:true}};}),
    tool('add_mesh_components','批量放置精细模型','批量添加独立组件，减少逐个生成和重复读取；每个组件独立命名/定位/分类，单批1–16项。全部载入和校验成功才更新草稿，任一失败整批不生效。需要读取结果ID后再操作人物接触关系。',Type.Object({items:Type.Array(Type.Object({key:Type.Union(MESH_CATALOG.map(x=>Type.Literal(x.key))),name:Type.String({minLength:1,maxLength:80}),position:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),yaw:Type.Optional(Type.Number()),scaleFactor:Type.Optional(Type.Number({minimum:.1,maximum:10})),planKey:Type.Optional(Type.String({maxLength:120})),zone:Type.Optional(Type.String({maxLength:120}))}),{minItems:1,maxItems:16})}),async(_id,args)=>{check();const ops:Command[]=[];for(const item of args.items){const component=await loadMeshComponent(item,signal);check();ops.push({op:'importMeshComponent',...component});}return commitEdits({summary:'批量放置'+args.items.length+'个精细组件',operations:ops});}),
    tool('read_saved_asset','读取资产用途与连接点','读取明确版本的用途、必要结构、零件绑定连接点和验收状态，不返回完整顶点。验收记录只是人工复核，场景关系仍需检查。',Type.Object({id:Type.String({maxLength:100}),version:Type.Integer({minimum:1,maximum:10000})}),async(_id,args)=>{check();const a=await readModelAsset(args.id,args.version),r=await readAssetQuality(a.id,a.version);if(r)await validateAssetQuality(a,r);check();return textResult(JSON.stringify({id:a.id,version:a.version,name:a.name,size:a.size,contract:a.contract??null,preflight:inspectAssetPreflight(a),quality:assetQualityStatus(r),checks:r?.checks??[],viewCount:r?.views.length??0}));}),
    tool('inspect_asset_instances','检查资产实例与连接点','检查固定版本实例相对原件是否改动，并返回当前世界坐标连接点。不变只表示几何和材质可复用，不能证明场景关系或视觉质量。',Type.Object({instanceIds:Type.Array(Type.String({maxLength:100}),{minItems:1,maxItems:16})}),async(_id,args)=>{check();const rows=[];for(const id of args.instanceIds){const n=draft.nodes.find(n=>n.modelAsset?.instanceId===id);if(!n?.modelAsset)throw Error('实例不存在');const a=await readModelAsset(n.modelAsset.id,n.modelAsset.version);check();const {frame,nodes,...report}=inspectAssetInstance(draft,a,id);const review=await readAssetQuality(a.id,a.version);if(review)await validateAssetQuality(a,review);check();const reusableCriteria=report.intrinsicUnchanged&&review?.origin!=='imported'?review?.checks.filter(c=>['silhouette','structure','materials','details'].includes(c.criterion)&&c.status==='pass')??[]:[];rows.push({...report,reusableCriteria,relationshipReviewRequired:true});}return textResult(JSON.stringify({instances:rows,sceneRelationsRequireReview:true}));}),
    tool('align_saved_instances','按连接点平移对齐资产','在同一场景中以真实零件连接点平移整个源实例。要求用途兼容、法线相对、实例形体与原件一致；不自动旋转，不保证无碰撞，完成后必须检查空间与实际接触。',Type.Object({sourceInstance:Type.String(),sourceAnchor:Type.String(),targetInstance:Type.String(),targetAnchor:Type.String()}),async(_id,args)=>{check();const sn=draft.nodes.find(n=>n.modelAsset?.instanceId===args.sourceInstance),tn=draft.nodes.find(n=>n.modelAsset?.instanceId===args.targetInstance);if(!sn?.modelAsset||!tn?.modelAsset)throw Error('来源或目标实例不存在');const a=await readModelAsset(sn.modelAsset.id,sn.modelAsset.version),b=await readModelAsset(tn.modelAsset.id,tn.modelAsset.version);check();const alignment=alignAssetInstances(draft,a,args.sourceInstance,args.sourceAnchor,b,args.targetInstance,args.targetAnchor);return commitEdits({summary:'按用途兼容的连接点平移对齐，空间与接触待复核',operations:alignment.operations});}),
    tool('list_saved_assets','检索已保存模型资产','按名称或分类检索本浏览器资产库，返回最新版本的元数据，不返回顶点或缩略图。资产仍待验收，只复用用途匹配的结构；固定版本插入后检查关系与画面。',Type.Object({query:Type.Optional(Type.String({maxLength:120})),limit:Type.Optional(Type.Number({minimum:1,maximum:20}))}),async(_id,args)=>{check();const [rows,categories]=await Promise.all([listModelAssets(),listLibraryCategories()]);check();const matching=searchLibraryAssets(rows,categories,args.query);return textResult(JSON.stringify({items:matching.slice(0,Math.floor(args.limit??12)).map(({thumbnail,...row})=>row),total:matching.length,quality:'unreviewed',scope:'current_browser'}));}),
    tool('add_saved_assets','批量插入保存的资产','按检索得到的资产ID及明确版本每批插入1–16个可编辑实例；16是单次调用容量，不是需求或场景总量上限。超过16个必须继续分批，按实际成功批次完成全部位置；不得只填顶层或缩减数量。先全部读取校验，任一失败整批不改。position为米制底面中心，yaw绕Y轴，原件和旧版本不可修改。必须检查实例之间的空间和接触，不能将入库视为验收通过。',Type.Object({items:Type.Array(Type.Object({id:Type.String({maxLength:100}),version:Type.Integer({minimum:1,maximum:10000}),name:Type.Optional(Type.String({minLength:1,maxLength:80})),position:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),yaw:Type.Optional(Type.Number()),planKey:Type.Optional(Type.String({maxLength:120})),zone:Type.Optional(Type.String({maxLength:120}))}),{minItems:1,maxItems:16})}),async(_id,args)=>{check();const operations:Command[]=[];const assets=new Map<string,Awaited<ReturnType<typeof readModelAsset>>>();for(const item of args.items){const key=JSON.stringify([item.id,item.version]);let asset=assets.get(key);if(!asset){asset=await readModelAsset(item.id,item.version);assets.set(key,asset);}check();const command=instantiateAsset({...asset,name:item.name??asset.name},item.position,item.yaw??0);if(command.op==='importComponentDraft')for(const node of command.nodes){node.planKey=item.planKey;node.zone=item.zone;}operations.push(command);}return commitEdits({summary:'插入'+args.items.length+'个固定版本资产实例，质量和组合关系仍需复查',operations});}),
    tool('list_mesh_components','查看精细模型目录','返回经离线建模的可编辑网格组件：七类机加工设备和四类人员等。只返回结构、尺寸、朝向和适用范围，不返回顶点。优先使用匹配组件作为结构起点，禁止冒称厂家精确模型或把不同设备强行套成同一种。',Type.Object({}),async()=>textResult(JSON.stringify(MESH_CATALOG))),
    tool('add_mesh_component','放置精细模型','仅单个对象使用，多对象优先add_mesh_components。按目录key放置分部件精细网格；position为局部原点的世界米坐标，yaw为绕Y轴角度，scaleFactor为统一比例。人员默认面向-Z，机床操作面朝+Z，应面对设备并将手对准实际操作区。返回实际组件和节点ID，可用现有组件命令移动/复制/改材质/修改子部件变换/添加几何细节。不接受远程URL或模型自行编造的顶点。',Type.Object({key:Type.Union(MESH_CATALOG.map(x=>Type.Literal(x.key))),name:Type.String({minLength:1,maxLength:80}),position:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),yaw:Type.Optional(Type.Number()),scaleFactor:Type.Optional(Type.Number({minimum:.1,maximum:10})),planKey:Type.Optional(Type.String({maxLength:120})),zone:Type.Optional(Type.String({maxLength:120}))}),async(_id,args)=>{check();const component=await loadMeshComponent(args,signal);check();return commitEdits({summary:'放置精细模型：'+args.name,operations:[{op:'importMeshComponent',...component}]});}),
    tool('configure_process_route','配置业务路线','为AGV、输送物料或人员生成有停留的路径动画；作用于targetId所在整个组件。offsets是相对初始位置的位移点，以[0,0,0]开始，速度米/秒。carryIds可绑定实际载物零件跟随，不会自动抓取或做碰撞避让。保留其他轨道；延长路线会延长总体循环周期，必须符合用户节拍要求。直接生成并写入草稿，再按能力进行动态复核。',Type.Object({targetId:Type.String(),offsets:Type.Array(Type.Array(Type.Number(),{minItems:3,maxItems:3}),{minItems:2,maxItems:16}),speed:Type.Number({minimum:.01,maximum:5}),dwell:Type.Number({minimum:0,maximum:60}),returnToStart:Type.Boolean(),carryIds:Type.Optional(Type.Array(Type.String(),{maxItems:100}))}),async(id,args)=>{const animation=processRoute(draft,args as import('../domain/processMotion').ProcessRoute);return tools.find(t=>t.name==='edit_scene')!.execute(id,{summary:'配置业务路线与停留',operations:[{op:'setAnimation',animation}]},signal,()=>{});}),
    tool('add_reference_component','添加结构参考组件','仅当用户未提供参考图、且明确只要通用结构占位时使用。用户已上传参考图时禁止调用：必须按参考图观察结果定制几何，不得用本配方替代。无参考图时可添加可继续逐零件修改的人员、空腔机壳、货架或矮平AGV。名称由用户场景决定，position为落地点米坐标，yaw为绕Y角度。返回真实对象ID，可再按尺寸与工艺改造。不是厂家模型或完整产线模板。',Type.Object({kind:Type.Union(RECIPE_NAMES.map(k=>Type.Literal(k))),name:Type.String({minLength:1,maxLength:80}),position:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),yaw:Type.Optional(Type.Number())}),async(id,args)=>{if(options.images?.length)throw Error('用户已提供参考图：禁止用结构配方替代。请先做referenceObservation，再按可见轮廓与结构用plan_object_structure/build_structured_component或edit_scene生成。');const def=industrialRecipe(args.kind);return tools.find(t=>t.name==='edit_scene')!.execute(id,{summary:'添加可编辑参考组件：'+args.name,operations:[{op:'createAssembly',...def,name:args.name,position:args.position,yaw:args.yaw??0}]},signal,()=>{});}),
    tool('submit_data_preview','保留数据草稿','仅在真实渲染不可用时使用。完成全部请求的数据编辑、数量和尺寸检查后，一次性保留未经视觉验收的阶段草稿。不能把计划未完成的对象说成完成；summary明确完成和剩余部分。不会写入正式项目。',Type.Object({summary:Type.String({minLength:1,maxLength:600})}),async(_id,args)=>{check();assertPoseGoal();if(visualAvailable())throw Error('三维可用，请完成正常视觉复核后提交');activity.dataDraftSubmitted=true;const audit=refreshDetail();stageReason=args.summary+'\n'+(audit.issues.length?'细节验收未完成：'+audit.issues.slice(0,12).join('；')+'\n':'')+unavailableStage();emit(stageReason,true);return {...textResult(stageReason),terminate:true};}),
    tool('read_component_recipe','读取可编辑结构参考','可选的结构参考，不自动创建模型。用户已提供参考图时禁止用本配方代替观察建模：必须按参考图可见结构生成。无参考图时：operator为解剖比例及弯曲操作手臂，enclosure为有实际内部空间/观察窗/检修门的通用设备，rack为梁柱货架，agv为带防撞和导航部件的矮平搬运车。返回createAssembly可用的部件定义；按用户尺寸与工艺调整，非厂家认证模型。不要把所有设备套用同一外壳。',Type.Object({kind:Type.Union(RECIPE_NAMES.map(k=>Type.Literal(k)))}),async(_id,args)=>{if(options.images?.length)return textResult(JSON.stringify({refused:true,reason:'用户已提供参考图：禁止用现成配方代替参考图建模。请根据参考图做referenceObservation并定制几何。',kinds:RECIPE_NAMES}));return textResult(JSON.stringify(industrialRecipe(args.kind)));}),
    tool('check_requirements','核对明确需求','整理用户明确的数量、尺寸、配色及布局要求并用真实场景核对。quote必须逐字引用用户原文，target必须出现在用户指令中。kind=count填阿拉伯数字；kind按用户自然维度填写：length=长度、width=宽度、height=总高、depth=深度，expected填米数。长宽高默认对应X/Z/Y（几何width/depth/height）；宽深高对应X/Z/Y。不能把用户长度填成kind=width。quote尽量包含同一目标的完整尺寸描述；明确旋转或其他轴约定标为other待核对；color与other只报告待人工核对。不要把假设加入清单；新要求覆盖同目标同类型旧要求。省略items可复查已有清单；unknown不等于缺失或通过。',Type.Object({items:Type.Optional(Type.Array(Type.Object({quote:Type.String({minLength:1,maxLength:300}),target:Type.String({minLength:1,maxLength:80}),kind:Type.Union(['count','length','height','width','depth','color','other'].map(v=>Type.Literal(v))),expected:Type.String({minLength:1,maxLength:160})}),{maxItems:30}))}),async(_id,args)=>{
      check();const next=mergeRequirements(requirements,(args.items??[]) as Requirement[],userTexts);if(JSON.stringify(next)!==JSON.stringify(requirements))progress();requirements=next;if(args.items?.length)requirementsNeedRefresh=false;activity.requirements=checkRequirements(draft,requirements);emit(`需求核对：${activity.requirements.items.filter(r=>r.status==='mismatch').length}项不符，${activity.requirements.items.filter(r=>r.status==='unknown').length}项待核对`,true);return textResult(JSON.stringify(activity.requirements));
    }),
    tool('plan_object_structure','规划通用对象结构','为单个模型或场景中的不同对象记录身份、用途、轮廓、功能结构、开口负空间及验收视角。closeup为关键近景，scene为场景主体，background为配套；档位不能删减用户明确要求，不能只靠名称或零件数量合格。更新方案保留key、名称、用途角色未变的真实关联；新增或改身份的特征须重新绑定。只写可交付设计摘要。',Type.Object({objects:Type.Array(Type.Object({dimensions:Type.Optional(Type.Object({x:Type.Optional(Type.Number({exclusiveMinimum:0,maximum:10000})),y:Type.Optional(Type.Number({exclusiveMinimum:0,maximum:10000})),z:Type.Optional(Type.Number({exclusiveMinimum:0,maximum:10000}))},{description:'已明确要求的整体轴向尺寸，米，单体局部坐标x宽/y高/z深；只填用户明确的轴，未知尺寸不要猜。创建与局部重建会验证整体范围。'})),key:Type.String({minLength:1,maxLength:80}),name:Type.String({minLength:1,maxLength:80}),purpose:Type.String({minLength:1,maxLength:240}),detailLevel:Type.Union(['closeup','scene','background'].map(v=>Type.Literal(v))),detailReason:Type.String({minLength:1,maxLength:240}),silhouette:Type.String({minLength:1,maxLength:360}),features:Type.Array(Type.Object({key:Type.String({minLength:1,maxLength:80}),name:Type.String({minLength:1,maxLength:240}),referenceObservation:Type.Optional(Type.String({minLength:1,maxLength:360,description:'参考图中此特征的可见形状、分区、相对粗细/间距、连接与开口；不可见部分明确未知。不得仅复述名称。'})),role:Type.Union(['form','function','support','connection','surface'].map(v=>Type.Literal(v))),geometryApproach:Type.Union(['primitive','profile','lathe','sweep','mesh','assembly'].map(v=>Type.Literal(v)))}),{minItems:1,maxItems:16}),negativeSpaces:Type.Array(Type.String({minLength:1,maxLength:240}),{maxItems:8}),views:Type.Array(Type.Union(['front','back','side','top','bottom','underside','perspective'].map(v=>Type.Literal(v))),{minItems:2,maxItems:4})}),{minItems:1,maxItems:24})}),async(_id,args)=>{check();validateBlueprints(args.objects);const previous=new Map((activity.objectBlueprints??[]).map(b=>[b.key,b]));const merged=new Map(previous);for(const b of args.objects)merged.set(b.key,b);if(merged.size>24)throw Error('本次结构方案最多24类对象，请合并同类规格');const changedKeys=new Set(args.objects.filter(p=>JSON.stringify(p)!==JSON.stringify(previous.get(p.key))).map(p=>p.key));const affected=new Set((activity.featureBindings??[]).filter(b=>changedKeys.has(b.blueprintKey)).map(b=>b.componentId));detailReviews=detailReviews.filter(r=>!affected.has(r.componentId));activity.featureBindings=(activity.featureBindings??[]).flatMap(b=>{if(!changedKeys.has(b.blueprintKey))return [b];const old=previous.get(b.blueprintKey),next=merged.get(b.blueprintKey)!;const features=b.features.filter(f=>{const a=old?.features.find(x=>x.key===f.key),n=next.features.find(x=>x.key===f.key);return a&&n&&a.name===n.name&&a.role===n.role&&f.nodeIds.every(id=>draft.nodes.some(node=>node.id===id&&(node.assemblyId??node.id)===b.componentId));});return features.length?[{...b,features}]:[];});activity.objectBlueprints=[...merged.values()];activity.blueprintCoverage=inspectBlueprintCoverage(draft,activity.objectBlueprints,activity.featureBindings);if(args.objects.some(b=>JSON.stringify(previous.get(b.key))!==JSON.stringify(b)))progress();return textResult(JSON.stringify({objects:args.objects,guidance:DETAIL_LEVEL_GUIDANCE,next:'按用途选连续曲面、截面、旋转体、网格或组合结构。先形成整体轮廓和负空间，再补连接及局部细节；优先build_structured_component一次生成并绑定全部必需结构，避免生成后遗漏关联；修改已有模型用bind_object_features。按views复核。'}));}),
    tool('build_structured_component','按结构方案生成单体','将已有对象结构方案直接生成一个组件，并同时绑定全部必需特征。definition使用createAssembly的自定义parts格式：name、geometry、transform、materialId及可选repeat；不是预制设备。features用准确partNames关联特征。profile方案可使用profile或同为轮廓挤出的roundedPlate；不能用box冒充。造型方法与方案不匹配、漏结构、无效几何时整组拒绝，原场景不变。生成成功仍需近景检查，负空间说明不能当作真实开口证明。',Type.Object({blueprintKey:Type.String({minLength:1,maxLength:80}),definition:Type.Object({name:Type.String(),position:Type.Optional(Type.Tuple([Type.Number(),Type.Number(),Type.Number()])),yaw:Type.Optional(Type.Number()),parts:Type.Array(structuredPartSchema,{minItems:1,maxItems:100})}),features:Type.Array(Type.Object({key:Type.String(),partNames:Type.Array(Type.String(),{minItems:1,maxItems:100})}),{minItems:1,maxItems:16})}),async(_id,args)=>{check();const plan=activity.objectBlueprints?.find(p=>p.key===args.blueprintKey);if(!plan)throw Error('先规划该对象的用途、整体轮廓和必需结构');if((activity.featureBindings?.length??0)>=128)throw Error('本轮单体绑定达到128项上限');validateStructuredRecipe(plan,args.definition as AssemblyDefinition,args.features);const before=new Set(draft.nodes.map(n=>n.id));let binding:FeatureBinding|undefined;const result=await commitEdits({summary:'按结构方案生成'+args.definition.name,operations:[{op:'createAssembly',...withStructuredParts(plan,args.definition,args.features)}]},candidate=>{binding=structuredFeatureBinding(candidate,before,plan,args.definition as AssemblyDefinition,args.features);});activity.featureBindings=[...(activity.featureBindings??[]).filter(b=>b.blueprintKey!==binding!.blueprintKey||b.componentId!==binding!.componentId),binding!];activity.blueprintCoverage=inspectBlueprintCoverage(draft,activity.objectBlueprints??[],activity.featureBindings);emit('单体已生成并绑定实际结构，仍待视觉验收',true);return {...result,content:[...result.content,{type:'text' as const,text:JSON.stringify({componentId:binding!.componentId,features:binding!.features,accepted:false,requiredViews:plan.views})}]};}),
    tool('repair_structured_features','局部重建指定结构特征','仅替换已绑定的指定结构特征，并同步真实零件关联。parts采用createAssembly自定义格式，未提供origin/yaw时从保存的局部坐标和当前刚体姿态恢复；若部件已相对移动、整体缩放/倾斜或缺少依据则拒绝猜测，需明确origin和yaw。共享零件必须同时列出所有受影响特征，否则拒绝。保留其他零件、组件、材质和布局，先原子验证再显示预览。',Type.Object({blueprintKey:Type.String(),componentId:Type.String(),featureKeys:Type.Array(Type.String(),{minItems:1,maxItems:16}),parts:Type.Array(structuredPartSchema,{minItems:1,maxItems:100}),features:Type.Array(Type.Object({key:Type.String(),partNames:Type.Array(Type.String(),{minItems:1,maxItems:100})}),{minItems:1,maxItems:16}),origin:Type.Optional(Type.Tuple([Type.Number(),Type.Number(),Type.Number()])),yaw:Type.Optional(Type.Number())}),async(_id,args)=>{check();const plan=activity.objectBlueprints?.find(p=>p.key===args.blueprintKey),binding=activity.featureBindings?.find(b=>b.blueprintKey===args.blueprintKey&&b.componentId===args.componentId);if(!plan||!binding)throw Error('目标缺少当前结构方案或零件关联，先核对并绑定');const selected=binding.features.filter(f=>args.featureKeys.includes(f.key));if(selected.length!==args.featureKeys.length)throw Error('待修复特征未全部绑定');const removed=new Set(selected.flatMap(f=>f.nodeIds));if(binding.features.some(f=>!args.featureKeys.includes(f.key)&&f.nodeIds.some(id=>removed.has(id))))throw Error('待替换零件也承载其他特征，请明确全部受影响特征，避免破坏未选结构');const members=draft.nodes.filter(n=>(n.assemblyId??n.id)===args.componentId);if(!members.length||[...removed].some(id=>!members.some(n=>n.id===id)))throw Error('结构关联已过期，请重新核对真实零件');if((args.origin===undefined)!==(args.yaw===undefined))throw Error('显式重建坐标需同时提供origin和yaw');const frame=args.origin===undefined?structureFrame(members):{origin:args.origin,yaw:args.yaw!};const definition:AssemblyDefinition={name:members[0].assemblyName??members[0].name,parts:args.parts,position:frame.origin,yaw:frame.yaw};validateStructuredRecipe(plan,definition,args.features,args.featureKeys);const before=new Set(draft.nodes.filter(n=>!removed.has(n.id)).map(n=>n.id));let changed:FeatureBinding|undefined;const result=await commitEdits({summary:'局部重建'+args.featureKeys.join('、'),operations:[{op:'replaceAssemblyParts',targetId:members[0].id,partIds:[...removed],blueprint:plan,parts:withStructuredParts(plan,definition,args.features).parts,origin:frame.origin,yaw:frame.yaw}]},candidate=>{changed=structuredFeatureBinding(candidate,before,plan,definition,args.features);validateBlueprintDimensions(plan,candidate.nodes.filter(n=>(n.assemblyId??n.id)===args.componentId),frame);});const combined={...binding,features:[...binding.features.filter(f=>!args.featureKeys.includes(f.key)),...changed!.features]};activity.featureBindings=(activity.featureBindings??[]).map(b=>b.blueprintKey===binding.blueprintKey&&b.componentId===binding.componentId?combined:b);activity.blueprintCoverage=inspectBlueprintCoverage(draft,activity.objectBlueprints??[],activity.featureBindings);emit('已局部重建指定结构；原有视觉结论需按影响范围复查',true);return {...result,content:[...result.content,{type:'text' as const,text:JSON.stringify({updatedFeatures:changed!.features,accepted:false})}]};}),
    tool('bind_object_features','关联结构特征与实际模型','把已规划特征关联到当前组件真实部件；不接受其他组件ID，不因关联成功声称几何或视觉通过。一次可关联多对象，任一无效不写入。关联通过可撤销元数据操作随项目保存，不改变几何，不自动表示验收通过。',Type.Object({bindings:Type.Array(Type.Object({blueprintKey:Type.String(),componentId:Type.String(),features:Type.Array(Type.Object({key:Type.String(),nodeIds:Type.Array(Type.String(),{minItems:1,maxItems:STRUCTURED_PART_LIMIT})}),{minItems:1,maxItems:16})}),{minItems:1,maxItems:24})}),async(_id,args)=>{check();validateFeatureBindings(draft,activity.objectBlueprints??[],args.bindings);const merged=new Map((activity.featureBindings??[]).map(b=>[b.blueprintKey+':'+b.componentId,b]));let changed=false;for(const b of args.bindings){const previous=merged.get(b.blueprintKey+':'+b.componentId);const features=new Map((previous?.componentId===b.componentId?previous.features:[]).map(f=>[f.key,f]));for(const f of b.features)features.set(f.key,f);const combined={...b,features:[...features.values()]};if(JSON.stringify(previous)!==JSON.stringify(combined))changed=true;merged.set(b.blueprintKey+':'+b.componentId,combined);}validateFeatureBindings(draft,activity.objectBlueprints??[],[...merged.values()]);const updatedBindings=[...merged.values()];if(new Set(args.bindings.map(b=>b.componentId)).size!==args.bindings.length)throw Error('同一组件一次只能关联一份结构方案');const persistOps:Command[]=args.bindings.map(b=>{const plan=activity.objectBlueprints!.find(p=>p.key===b.blueprintKey)!,binding=updatedBindings.find(x=>x.blueprintKey===b.blueprintKey&&x.componentId===b.componentId)!,target=draft.nodes.find(n=>(n.assemblyId??n.id)===b.componentId)!;return {op:'setAssemblyMetadata',targetId:target.id,structure:{blueprint:plan,binding}};});const candidate=applyBatch(draft,{operations:persistOps});if(candidate.errors.length)throw Error(candidate.errors.map(e=>e.message).join('；'));if(JSON.stringify(candidate.doc.nodes)!==JSON.stringify(draft.nodes))await commitEdits({summary:'保存结构方案与真实零件关联',operations:persistOps});activity.featureBindings=updatedBindings;activity.blueprintCoverage=inspectBlueprintCoverage(draft,activity.objectBlueprints??[],activity.featureBindings);if(changed)progress();return textResult(JSON.stringify(activity.blueprintCoverage));}),
    tool('plan_model','规划建模步骤','修改前记录操作计划与尺寸假设：steps为1–24项，每类设备features为1–24项。超限请合并同类条目，不能删除用户要求。完整车间/产线/仓库需提供design和composition：工艺顺序、布局、设备特征、分区、连接、配套、配色取景与验收检查。只记录交付设计，不输出内部推理。',Type.Object({steps:Type.Array(Type.String({maxLength:240}),{minItems:1,maxItems:24}),assumptions:Type.String({maxLength:1600}),design:Type.Optional(Type.Object({flow:Type.Array(Type.String({maxLength:100}),{minItems:1,maxItems:12}),layout:Type.String({minLength:5,maxLength:600}),equipment:Type.Array(Type.Object({name:Type.String({minLength:1,maxLength:80}),count:Type.Integer({minimum:1,maximum:100}),features:Type.Array(Type.String({maxLength:240}),{minItems:1,maxItems:24})}),{minItems:1,maxItems:16}),checks:Type.Array(Type.String({maxLength:120}),{minItems:1,maxItems:8}),composition:Type.Optional(compositionSchema)}))}),async(_id,args)=>{
      check();if(needsDesign&&(!args.design||!args.design.composition))throw new Error('完整场景请先补全design：flow、layout、equipment（名称/数量/特征）、checks，以及composition（分区、连接、配套、配色与取景），不能直接堆占位模型');
      if(!activity.plan.length)progress();
      activity.plan=args.steps;activity.design=args.design;emit(`计划：${args.steps.join(' → ')}；${args.assumptions}`,true);return textResult('设计已记录。按设备→输送/转运→工位→物料→人员动作建立关系；先完成各类代表设备近景，再布置同类设备与配套。createAssembly的planKey对应设计清单名称，sceneRole标明类别；不适用的配套不添加。局部编辑严格遵守本次作用范围。');
    }),
    tool('read_scene','读取当前场景','默认只返回组件摘要。assemblyId返回组件全部真实零件的ID与变换，大型结果省略长几何参数；需要精确形状时单独传nodeIds读取指定对象，二者可同时提供，合并去重返回明细。当前版本不同目标的明细会一起保留，重复同一目标不提供新信息；资料齐全后配置动画或修改模型。',Type.Object({assemblyId:Type.Optional(Type.String()),nodeIds:Type.Optional(Type.Array(Type.String(),{maxItems:64}))},{additionalProperties:false}),async(_id,args)=>{
      check();const request={...args,assemblyId:args.assemblyId||undefined,nodeIds:args.nodeIds?.length?args.nodeIds:undefined};
      if(request.assemblyId&&!draft.nodes.some(n=>n.assemblyId===request.assemblyId))throw new Error('设备组件不存在');
      if(request.nodeIds?.some(id=>!draft.nodes.some(n=>n.id===id)))throw new Error('部分节点ID不存在，请使用当前场景返回的真实ID');
      const componentNodes=request.assemblyId?draft.nodes.filter(n=>n.assemblyId===request.assemblyId):[];
      const componentIds=new Set(componentNodes.map(n=>n.id));const extraIds=[...new Set((request.nodeIds??[]).filter(id=>!componentIds.has(id)))];
      const scopeKey=request.assemblyId?'assembly:'+request.assemblyId+(extraIds.length?'|nodes:'+extraIds.slice().sort().join(','):''):request.nodeIds?'nodes:'+[...new Set(request.nodeIds)].sort().join(','):'overview';
      if(readRevision!==draft.revision){readRevision=draft.revision;readScopes.clear();}
      if(readScopes.has(scopeKey))return {...textResult(JSON.stringify({revision:draft.revision,scopeKey,repeated:true,next:'同一版本的这份数据已经读取且仍保留在上下文。请使用已获得的真实ID进入configure_animation或edit_scene；需要其他组件时传不同assemblyId或nodeIds，不要重复空读。'})),details:{revision:draft.revision,scopeKey,snapshot:false}};
      readScopes.add(scopeKey);if(readScopes.size>24)readScopes.delete(readScopes.values().next().value!);
      const requestedIds=new Set([...componentIds,...request.nodeIds??[]]);
      const context=request.nodeIds?targetedSceneContext(draft,selectionForDoc(draft),requestedIds,options.editScope):agentSceneContext(draft,selectionForDoc(draft),request.assemblyId,options.editScope);
      if(scopeKey!=='overview')recordReadProgress(context.nodes.map(n=>n.id));
      const readContext=request.nodeIds?context:boundSceneRead(context,new Map(draft.nodes.map(n=>[n.id,n.geometry?.type??'group'])));
      return {...textResult(JSON.stringify({...readContext,revision:draft.revision,scopeKey,...(wantsAnimation?{animationWorkflow:'configure_animation→preview_animation→下一轮review_model→submit_preview。不同对象明细会同时保留。'}:{})})),details:{revision:draft.revision,scopeKey,snapshot:true}};
    }),
    tool('edit_scene','修改模型草稿','对草稿应用一组建模命令，不会修改用户正式场景。每次最多40项；本次调用内可用tempId，后续调用必须用返回的真实ID。',Type.Object({summary:Type.String({minLength:1,maxLength:300}),operations:Type.Array(Type.Unknown(),{minItems:1,maxItems:40})}),async(_id,args)=>{try{const result=await executeSceneEdit(args);failedEdits.clear();return result;}catch(error){if(signal?.aborted)throw error;const cached=failedEdits.remember(_id,draft.revision,executionTexts.join('\n'),args);throw Error((error instanceof Error?error.message:String(error))+(cached?' 失败批次ID='+_id+'，可用retry_scene_edit仅纠正错误字段，不必重新输出整批命令；最多两次。':''));}}),
    tool('retry_structured_component','纠正失败单体的局部参数','重试缓存的build_structured_component或repair_structured_features，不重写全部零件。failedId使用错误返回的失败结构ID；patches.path从原参数字段开始，如["definition","parts",6,"geometry","params","bevelRadius"]，value为正确值。仅允许definition、parts、features、origin、yaw；不能改目标身份。最多8处、两次，场景、结构计划或任务改变后失效；仍须通过全部结构/尺寸/范围校验。',Type.Object({failedId:Type.String(),patches:Type.Array(Type.Object({path:Type.Array(Type.Union([Type.String(),Type.Integer({minimum:0})]),{minItems:1,maxItems:9}),value:Type.Unknown()}),{minItems:1,maxItems:8})}),async(_id,args)=>{
      if(args.patches.some(p=>!['definition','parts','features','origin','yaw'].includes(String(p.path[0]))))throw Error('结构纠错不能改变方案或目标身份');const corrected=failedStructured.correct(args.failedId,draft.revision,structuredRetryScope(),args.patches.map(p=>({...p,path:['operations',0,'args',...p.path]})));const saved=corrected.operations[0] as {tool:string;args:any};if(!structuredTools.has(saved.tool))throw Error('缓存结构工具无效');const target=tools.find(t=>t.name===saved.tool)!;
      replayingStructured=true;try{const validated=validateToolArguments(target,{type:'toolCall',id:_id+'_retry',name:saved.tool,arguments:saved.args});const result=await target.execute(_id+'_retry',validated,signal,()=>{});failedStructured.clear();structuredIssues=undefined;return result;}catch(error){const remaining=error instanceof AssemblyValidationError?error.issues.length:undefined;if(remaining!==undefined&&structuredIssues!==undefined&&remaining<structuredIssues)progress();structuredIssues=remaining;throw error;}finally{replayingStructured=false;}
    }),
    tool('retry_scene_edit','纠正失败批次的局部字段','仅重试本轮缓存的失败edit_scene。failedId用报错返回ID，patches.path为从operations起的字段路径，如["operations",0,"parts",2,"geometry","params","radialSegments"]，value为正确值。最多8处、两次；场景或任务要求变化后旧批次失效。整批重新校验并原子执行，失败不应用部分内容。',Type.Object({failedId:Type.String(),patches:Type.Array(Type.Object({path:Type.Array(Type.Union([Type.String(),Type.Integer({minimum:0})]),{minItems:3,maxItems:12}),value:Type.Unknown()}),{minItems:1,maxItems:8})}),async(_id,args)=>{
      const next=failedEdits.correct(args.failedId,draft.revision,executionTexts.join('\n'),args.patches);const result=await executeSceneEdit(next);failedEdits.clear();return result;
    }),
    tool('inspect_scene','检查场景完整度','根据当前真实草稿返回组件空间边界并核对设计清单、配套连接间距、设备包围盒交叠、人物尺度和墙地面材质。结果是检查线索，不是工程或视觉合格证明。修改后需重新检查；可与最终截图同一轮调用。',Type.Object({}),async()=>{
      check();const key=JSON.stringify([draft.revision,activity.design]);if(inspectionKey===key&&activity.quality)return textResult(JSON.stringify({revision:draft.revision,repeated:true,issues:activity.quality.issues,next:'当前版本检查结果未变；修正实际缺陷后再复查，无可修正问题时继续提交，不为unknown反复读场景。'}));inspectionKey=key;const report=inspectSceneQuality(draft,activity.design);if(activity.quality?.revision!==draft.revision)progress();activity.quality=report;emit(`场景检查：${report.componentCount}个组件，${report.issues.length}条待核对事项`,true);return textResult(JSON.stringify(report));
    }),
    tool('prepare_local_edit','准备局部修改上下文','一次返回1–8个目标的部件、已保存关节/抓握点、附近障碍候选，以及其他组件摘要。先复用已保存标定，不重复查手臂/握柄。仅缩小上下文，不改变修改权限；远处对象仍保留，边界候选不等于碰撞验收。',Type.Object({assemblyIds:Type.Array(Type.String(),{minItems:1,maxItems:8}),radius:Type.Optional(Type.Number({minimum:0,maximum:10}))}),async(_id,args)=>{check();const result=localEditContext(draft,args.assemblyIds,args.radius??1);localFocus={ids:[...args.assemblyIds],radius:args.radius??1};recordReadProgress(result.targets.flatMap(t=>t.parts.map(p=>p.id)));return {...textResult(JSON.stringify(result)),details:{revision:draft.revision,scopeKey:'local:'+JSON.stringify(localFocus),snapshot:true}};}),
    tool('read_pose_rig','读取已标定关节与抓握点','返回当前世界坐标下的可复用关节、抓握点和有效性。位置/旋转变化后自动跟随部件；几何变化或零件缺失时拒绝复用旧标定。',Type.Object({assemblyId:Type.String()}),async(_id,args)=>textResult(JSON.stringify(poseRigContext(draft,args.assemblyId)))),
    tool('define_pose_rig','保存可复用关节和抓握点','在明确观察或建模依据下标定，不猜测隐藏关节。pivot/axis/point输入当前世界坐标，系统转换为部件局部坐标保存。anchorNodeId为关节参考部件，memberIds为随关节转动的全部下游部件；anchors用于手掌、握柄或接触点。保存后可跨会话和资产实例复用；不代表自动骨骼绑定、碰撞或视觉验收。',Type.Object({assemblyId:Type.String(),joints:Type.Array(Type.Object({key:Type.String(),name:Type.String(),anchorNodeId:Type.String(),pivot:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),axis:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),memberIds:Type.Array(Type.String(),{minItems:1,maxItems:128})}),{maxItems:24}),anchors:Type.Array(Type.Object({key:Type.String(),name:Type.String(),nodeId:Type.String(),point:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),kind:Type.Union([Type.Literal('grip'),Type.Literal('contact'),Type.Literal('custom')])}),{maxItems:64})}),async(_id,args)=>{const nodes=draft.nodes.filter(n=>(n.assemblyId??n.id)===args.assemblyId);if(!nodes.length)throw Error('目标组件不存在');const rig=worldPoseRig(nodes,args.joints,args.anchors);return commitEdits({summary:'保存关节与抓握点标定',operations:[{op:'setPoseRig',targetId:nodes[0].id,rig}]});}),
    tool('pose_with_rig','复用关节批量调整并检查接触','使用已标定jointKey，按顺序给出相对旋转角度。一次完成全部刚体关节变换与已标定接触点距离检查；失败全部不应用。contacts只能验证点距离，不是曲面接触/碰撞验收，仍需视觉复核。可指定2–3个reviewViews合并取图，下一轮再判读；无渲染时仅返回数据。',Type.Object({assemblyId:Type.String(),steps:Type.Array(Type.Object({jointKey:Type.String(),angle:Type.Number({minimum:-180,maximum:180})}),{minItems:1,maxItems:12}),contacts:Type.Optional(Type.Array(Type.Object({sourceKey:Type.String(),targetAssemblyId:Type.String(),targetKey:Type.String(),tolerance:Type.Number({exclusiveMinimum:0,maximum:.5})}),{maxItems:16})),reviewViews:Type.Optional(Type.Array(Type.Union(['perspective','front','side','back','left','top','bottom','underside'].map(x=>Type.Literal(x))),{minItems:2,maxItems:3}))}),async(_id,args)=>{if(args.reviewViews&&new Set(args.reviewViews).size!==args.reviewViews.length)throw Error('检查视角不能重复');const plan=poseWithRigCommands(draft,args.assemblyId,args.steps,args.contacts);const result=await commitEdits({summary:'复用已有标定完成姿态调整及接触点检查',operations:plan.commands});const content:({type:'text';text:string}|ImageContent)[]=[...result.content,{type:'text' as const,text:JSON.stringify({contactChecks:plan.checks,limitations:plan.limitations,rig:poseRigContext(draft,args.assemblyId)})}];if(args.reviewViews&&visualAvailable()){const capture=await tools.find(t=>t.name==='capture_multiview')!.execute(_id+':views',{componentId:args.assemblyId,views:args.reviewViews},signal,()=>{});content.push(...capture.content);}return {...result,content};}),
    tool('bend_existing_mesh','平滑弯曲已有连续网格','仅在已经核实关节中心和活动侧时使用。保持原网格拓扑、UV、ID和材质，按世界坐标pivot/axis平滑弯曲。movingDirection指向下游活动侧，blendWidth为过渡宽度（米），followNodeIds为一起刚体旋转的手/下游零件。无标定依据时不得猜测；自动拒绝过度拉伸，仍需多视角外观与碰撞检查。',Type.Object({assemblyId:Type.String(),nodeId:Type.String(),pivot:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),axis:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),movingDirection:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),blendWidth:Type.Number({minimum:.005,maximum:.5}),angle:Type.Number({minimum:-90,maximum:90}),followNodeIds:Type.Array(Type.String(),{maxItems:32})}),async(_id,args)=>{const plan=bendExistingMesh(draft,args);const result=await commitEdits({summary:'按已核实关节平滑弯曲现有网格',operations:plan.commands},undefined,plan.preservationBaseline);return {...result,content:[...result.content,{type:'text' as const,text:JSON.stringify({metrics:plan.metrics,limitations:plan.limitations})}]};}),
    tool('pose_existing_parts','保留原部件调整姿态','只旋转已有独立部件，不新建或替换几何，不改变比例材质。assemblyId为原组件。joints按顺序执行，每步nodeIds包含该关节带动的所有下游部件；pivot/axis为该步骤当前世界坐标，angle为角度。先批量读出部件与关节依据，不要猜测骨骼。整体网格没有独立关节时不能无损弯曲，应说明需拆分/绑定。结果仍需接触与外观复核。',Type.Object({assemblyId:Type.String(),joints:Type.Array(Type.Object({nodeIds:Type.Array(Type.String(),{minItems:1,maxItems:128}),pivot:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),axis:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),angle:Type.Number({minimum:-360,maximum:360})}),{minItems:1,maxItems:12})}),async(_id,args)=>{const result=await commitEdits({summary:'保留原网格与材质调整部件姿态',operations:existingPoseCommands(draft,args.assemblyId,args.joints)});return {...result,content:[...result.content,{type:'text' as const,text:'已保持原零件几何和材质；这不是骨骼变形，不代表接触、穿插或姿态视觉验收通过。'}]};}),
    tool('pose_arm_interaction','联动调整手臂与手部','按真实肩点、肢段长度和肘弯方向解算手臂。press目标为指尖接触点，grasp为握柄中心，reach为腕点，support为掌面接触点且需要物体真实外法向contactNormal及support手型。显式替换手袖，保留其他部件；不可达拒绝，不代替碰撞或承重验收。',armSchema,async(_id,args)=>{
      const plan=armEditCommands(draft,[armArgs(args)]);const applied=await commitEdits({summary:'联动调整手臂与操作目标',operations:plan.commands});return {...applied,content:[...applied.content,{type:'text' as const,text:JSON.stringify(plan.results.map(r=>({chain:r.chain,target:r.target,limitations:r.limitations})))}]};
    }),
    tool('pose_bimanual_interaction','调整双手搬运姿态','同一人物左右手分别对准物体两侧真实握持或承托点。arms需要一左一右，operation只允许grasp/support；两臂均可达才整体替换，任一失败不修改。物体不自动移动，不代表重心、负载、步态或碰撞通过。',Type.Object({arms:Type.Array(armSchema,{minItems:2,maxItems:2})}),async(_id,args)=>{
      const plan=armEditCommands(draft,args.arms.map(armArgs));const applied=await commitEdits({summary:'调整双手静态搬运接触',operations:plan.commands});return {...applied,content:[...applied.content,{type:'text' as const,text:JSON.stringify({arms:plan.results.map(r=>({chain:r.chain,target:r.target})),accepted:false,limitations:'仅双手静态接触解算，未验证全身平衡、承重或碰撞。'})}]};
    }),
    tool('create_hand_pose','构建通用手部姿态','生成连续腕掌、四指和拇指的可编辑网格，适用于任意人物。wrist/forward/dorsal为世界坐标、腕到指方向、手背法向；不能平行。pose为relaxed/point/power/pinch，gripDiameter为握柄直径米。返回握心与食指端点供定位工具，不自动移动工具。已有手需明确replaceIds，不能只叠加新手。assemblyId选现有人物；先查节点，不替换躯干或袖子。必须近景验证，不自动通过。',Type.Object({name:Type.String({minLength:1,maxLength:80}),assemblyId:Type.String(),materialId:Type.String(),wrist:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),forward:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),dorsal:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),handedness:Type.Union([Type.Literal('left'),Type.Literal('right')]),pose:Type.Union(HAND_POSES.map(p=>Type.Literal(p))),scale:Type.Optional(Type.Number({minimum:.3,maximum:3})),gripDiameter:Type.Optional(Type.Number({minimum:.012,maximum:.08})),replaceIds:Type.Optional(Type.Array(Type.String(),{maxItems:24}))}),async(_id,args)=>{
      const member=draft.nodes.find(n=>(n.assemblyId??n.id)===args.assemblyId);if(!member||member.sceneRole!=='person')throw Error('需要真实人物组件');
      if(!draft.materials.some(m=>m.id===args.materialId))throw Error('材质不存在');const ids=args.replaceIds??[];
      if(new Set(ids).size!==ids.length||ids.some(id=>!draft.nodes.some(n=>n.id===id&&(n.assemblyId??n.id)===args.assemblyId&&/hand|palm|finger|thumb|手掌|手指|拇指|腕/i.test(n.name))))throw Error('只能替换指定人物的已识别手部节点');
      if(draft.nodes.some(n=>n.connection&&ids.includes(n.connection.targetId)&&!ids.includes(n.id)))throw Error('旧手仍被连接引用，请先更新连接后再替换');
      const hand=buildHandPose(args),node={id:makeId(),name:args.name,kind:'primitive' as const,parentId:null,visible:true,geometry:hand.geometry,materialId:args.materialId,transform:{position:[0,0,0] as [number,number,number],rotationQuaternion:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]},assemblyId:args.assemblyId,assemblyName:member.assemblyName,sceneRole:member.sceneRole,planKey:member.planKey};
      const part={name:args.name+' articulated hand',geometry:node.geometry,materialId:args.materialId,transform:node.transform};
      const result=await commitEdits({summary:'调整手部姿态：'+args.name,operations:[ids.length?{op:'replaceAssemblyParts',targetId:member.id,partIds:ids,parts:[part]}:{op:'appendAssemblyParts',targetId:member.id,parts:[part]}]});
      return {...result,content:[...result.content,{type:'text' as const,text:JSON.stringify({nodeId:draft.nodes[draft.nodes.length-1].id,gripCenter:hand.gripCenter,gripAxis:hand.gripAxis,indexTip:hand.indexTip,limitations:hand.limitations})}]};
    }),
    tool('inspect_part_topology','检查通用部件拓扑','按真实节点检查网格开口边、非流形边、法向绕序、退化与重复三角形。适用于任意领域；开口可能为设计需要，结果不自动判定质量通过，不检测壳厚/自相交/装配碰撞。最多4部件，各20万三角面；优先检查具体可疑结构，不遍历全场浪费预算。',Type.Object({nodeIds:Type.Array(Type.String(),{minItems:1,maxItems:4})}),async(_id,args)=>{check();return textResult(JSON.stringify(args.nodeIds.map(id=>{const n=draft.nodes.find(n=>n.id===id);if(!n?.geometry)throw Error('真实几何节点不存在');return {nodeId:id,name:n.name,...inspectTopology(n.geometry)};})));}),
    tool('inspect_workcells','核对通用作业单元完整度','按任务声明工位、人员、物料及操作净空，不按某个行业固定添加对象。stationId/operators/materials必须为真实组件ID；无人单元或有意空货架可明确requiresOperator/requiresMaterials=false。结果为缺项和距离线索，不是工艺验收。',Type.Object({cells:Type.Array(Type.Object({stationId:Type.String(),purpose:Type.String({minLength:1,maxLength:160}),operators:Type.Array(Type.String(),{maxItems:16}),materials:Type.Array(Type.String(),{maxItems:32}),requiresOperator:Type.Boolean(),requiresMaterials:Type.Boolean(),maxOperatorGap:Type.Number({exclusiveMinimum:0,maximum:10}),access:Type.Optional(Type.Object({min:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),max:Type.Tuple([Type.Number(),Type.Number(),Type.Number()])}))}),{minItems:1,maxItems:40})}),async(_id,args)=>textResult(JSON.stringify(inspectWorkcells(draft,args.cells)))),
    tool('inspect_access_route','检查连续通路净空','检查显式指定的连续水平通路中心线各段宽高及占位候选，适用于任意场景的行走/运输路径。点必须同高，width/height按任务真实需求；不自动规划，不证明车辆转弯、地面承载或安全认证。',Type.Object({points:Type.Array(Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),{minItems:2,maxItems:17}),width:Type.Number({minimum:.1,maximum:20}),height:Type.Number({minimum:.1,maximum:20}),excludedGroupIds:Type.Optional(Type.Array(Type.String(),{maxItems:16}))}),async(_id,args)=>textResult(JSON.stringify(inspectAccessRoute(draft,args.points,args.width,args.height,args.excludedGroupIds)))),
    tool('inspect_clearance','检查指定操作净空','检查给定世界坐标体积是否有零件包围盒侵入，用于通道、门前、维护和人员操作空间。min/max为米制XYZ，Y向上；excludedGroupIds只排除明确需要的真实组件。结果是候选，不是安全认证或通路连通证明。',Type.Object({min:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),max:Type.Tuple([Type.Number(),Type.Number(),Type.Number()]),excludedGroupIds:Type.Optional(Type.Array(Type.String(),{maxItems:16}))}),async(_id,args)=>textResult(JSON.stringify(inspectClearance(draft,args.min,args.max,args.excludedGroupIds)))),
    tool('inspect_model_quality','汇总模型质量检查','通用批量检查入口：一次返回真实几何/场景线索、已有明确需求、登记连接与接触面、受影响对象及建议取景。不代替视觉验收，不自动标通过。不用再无变化地逐项重复检查。',Type.Object({}),async()=>{
      check();const report=inspectSceneQuality(draft,activity.design);
      if(activity.quality?.revision!==draft.revision)progress();
      activity.quality=report;inspectionKey=JSON.stringify([draft.revision,activity.design]);
      activity.requirements=checkRequirements(draft,requirements);
      const detail=refreshDetail(),connections=connectionReport(draft),contacts=inspectContactSurfaces(draft);
      activity.blueprintCoverage=inspectBlueprintCoverage(draft,activity.objectBlueprints??[],activity.featureBindings??[]);
      emit(isFast?'已汇总数据检查；快速模式进行基础全景复核，逐项细节仍需证据':'已汇总当前版本质量检查；仍需实际近景与全景核对',true);
      return textResult(JSON.stringify({revision:draft.revision,scene:report,structure:activity.blueprintCoverage,referenceObservations:referenceObservationCoverage(activity.objectBlueprints??[],!!options.images?.length&&referenceShapeChanged(base,draft)),profileOpenings:profileOpeningMetrics(draft),interactions:interactionTargets(draft),requirements:activity.requirements,connections,contacts,detail,repairQueue:repairContext(),
        visual:{available:visualAvailable(),accepted:false,coverage:isFast?'basic-overview':'component-multiview',targets:isFast?[]:detail.targets.slice(0,12).map(t=>({...t,views:['front','back']})),remainingTargets:isFast?detail.targets.length:Math.max(0,detail.targets.length-12),next:visualAvailable()?(isFast?'快速模式用capture_quality_review做基础全景复核；下一轮review_model并提交。未逐项核对的细节保持待验，不遍历组件页。':'按受影响目标拍摄近景，收到真实图片后记录六项验收，再检查全景。'):'当前无法取图，数据检查不等于视觉通过；完成数据后保留未验收草稿。'}}));
    }),
    tool('capture_quality_review','获取本轮验收图组',isFast?'快速模式返回两个真实全景视角用于基础轮廓与布局复核。无组件分页，offset只可为0；逐项细节保持未验收。修正后可重拍，静态图总数最多4张。下一轮才可review_model。':'按本轮实际变更自动安排全景/俯视和受影响组件正反近景，每次最多2个组件；空间风险目标优先。offset从0开始，按nextOffset继续。只返回实际截图，失败不记作已完成，下一轮才可记录检查结论。',Type.Object({offset:Type.Optional(Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER}))}),async(_id,args)=>{
      check();if(!visualAvailable())throw Error(unavailableStage());
      const plan=generationReviewPlan(qualityBase,draft,generationQuality,args.offset??0),content:({type:'text';text:string}|ImageContent)[]=[];
      const evidence:{key:string;scope:string}[]=[];
      for(const target of plan.targets){
        // Frame the subject itself; the renderer still draws the entire scene and its occlusion.
        const ids=draft.nodes.filter(n=>(n.assemblyId??n.id)===target.id).map(n=>n.id);
        const blueprintKey=activity.featureBindings?.find(b=>b.componentId===target.id)?.blueprintKey;const blueprint=activity.objectBlueprints?.find(b=>b.key===blueprintKey);
        for(const view of blueprint?.views??target.views){const data=await captureDraft(view,ids);check();content.push({type:'text',text:`真实检查图 ${usedSoftwareCapture?'software几何检查，可能因预算降低分辨率；看不清须待验，材质未验收 ':''}revision=${draft.revision} scope=${target.id} view=${view}`},asImage(data));evidence.push({key:`${draft.revision}:${view}:${target.id}`,scope:target.id});}
      }
      for(const target of plan.interactions){
        if(!target.nodeIds.length)continue;
        for(const view of ['perspective','side'] as const){const data=await captureDraft(view,target.nodeIds);check();content.push({type:'text',text:`真实手部与工具近景 revision=${draft.revision} scope=interaction-${target.id} view=${view} 检查腕掌、五指、包握、朝向及穿插；看不清必须unknown，可用capture_detail_diagnostic显式隔离手与工具来定位缺陷，但隔离图不作为通过证据`},asImage(data));evidence.push({key:`${draft.revision}:${view}:interaction-${target.id}`,scope:target.id});}
      }
      // Whole-scene evidence last so the following review_model covers global changes.
      for(const view of plan.wholeViews){const data=await captureDraft(view);check();content.push({type:'text',text:`真实检查图 ${usedSoftwareCapture?'software几何检查，可能因预算降低分辨率；看不清须待验，材质未验收 ':''}revision=${draft.revision} scope=whole view=${view}`},asImage(data));evidence.push({key:`${draft.revision}:${view}:whole`,scope:'whole'});}
      if(!evidence.length)throw Error('该偏移没有检查目标；请使用返回的nextOffset或结束检查');
      for(const e of evidence)capturedViews.add(e.key);
      const last=evidence[evidence.length-1];latestCaptureKey=last.key;captureScope=last.scope;capturedRevision=draft.revision;capturedTurn=calls;progress();
      content.unshift({type:'text',text:JSON.stringify({...plan,objectBlueprints:activity.objectBlueprints??[],renderLimitations:usedSoftwareCapture?'软件几何检查，不支持PBR、纹理、阴影、精确透明度，材质项必须unknown':'正常渲染检查',next:isFast?'先读取真实图片，下一轮review_model记录基础外形/布局问题并用completion提交待确认草稿。未近景审查的细节保持待核对；不要求遍历audit，不把全景当作所有细节通过。':'先读取真实图片，下一轮用audit_model_details_batch同时记录本组目标六项验收，并按需review_model；有缺陷则局部修正并重新获取最新版本图组。无法判断必须unknown。'})});
      emit('已获取当前版本验收图组，等待下一轮读取画面',true);return {content,details:{revision:draft.revision,scope:captureScope,reviewPlan:plan}};
    }),
    tool('inspect_view_visibility','选择较少遮挡的视角','当实际近景被遮挡时，按1–96个真实目标节点估计八个视角的可见面积，推荐两个方向。保留完整场景遮挡，不移动或隐藏对象，不代替实际截图或细节验收；透明表面近似。仅为选角，无需对每个对象重复调用。',Type.Object({targetIds:Type.Array(Type.String(),{minItems:1,maxItems:96})}),async(_id,args)=>textResult(JSON.stringify(await suggestVisibleViews(draft,args.targetIds,signal)))),
    tool('capture_detail_diagnostic','隔离局部诊断图','完整场景近景被遮挡时，显式指定targetIds真实节点并可附contextIds如相邻袖口、工具、键盘。只在图中隐藏其他物体，不修改场景。最多2个视角。此图不能作为audit/review的通过证据，修复后需完整场景复查；不得用隔离图声称无穿插。',Type.Object({targetIds:Type.Array(Type.String(),{minItems:1,maxItems:48}),contextIds:Type.Optional(Type.Array(Type.String(),{maxItems:96})),views:Type.Array(Type.Union(['perspective','front','side','back','left','top','bottom','underside'].map(x=>Type.Literal(x))),{minItems:1,maxItems:2})}),async(_id,args)=>{
      check();if(new Set(args.views).size!==args.views.length)throw Error('诊断视角不能重复');const diagnostic=diagnosticCaptureDocument(draft,args.targetIds,args.contextIds);const content:({type:'text';text:string}|ImageContent)[]=[];
      for(const view of args.views){const data=await captureDraft(view,diagnostic.targetIds,undefined,diagnostic.document);content.push({type:'text',text:`隔离诊断图 revision=${draft.revision} scope=diagnostic view=${view} hidden=${diagnostic.hiddenCount} ${diagnostic.limitations}`},asImage(data));}
      return {content,details:{revision:draft.revision,scope:'diagnostic',acceptanceEvidence:false}};
    }),
    tool('capture_component_intrinsic','获取完整单体自身检查图','隔离一个完整组件的全部零件，避免其他组件挡住轮廓。只能用于外形、功能结构和用途细节；材质还需真实渲染。不得据此通过连接接触、场景关系或全景验收。下一轮读取图片后audit记录，关系项仍需完整上下文图，禁止省略本组件零件。朝下开口、底部连接或罩内结构用bottom或斜下方underside视角，不能为了看清而改变正确模型。',Type.Object({componentId:Type.String(),views:Type.Array(Type.Union(['perspective','front','side','back','left','top','bottom','underside'].map(x=>Type.Literal(x))),{minItems:2,maxItems:3})}),async(_id,args)=>{
      check();if(new Set(args.views).size!==args.views.length)throw Error('单体视角不能重复');const isolated=intrinsicCaptureDocument(draft,args.componentId),content:({type:'text';text:string}|ImageContent)[]=[];
      for(const view of args.views){const data=await captureDraft(view,isolated.targetIds,undefined,isolated.document);const key=`${draft.revision}:${view}:intrinsic-${args.componentId}`;capturedViews.add(key);content.push({type:'text',text:`完整单体自身检查图 revision=${draft.revision} scope=intrinsic-${args.componentId} view=${view} hiddenOtherObjects=${isolated.hiddenCount} ${usedSoftwareCapture?'software几何检查，材质未验收。':''}${isolated.limitations}`},asImage(data));}
      capturedTurn=calls;progress();emit('已获取完整单体自身检查图，连接与场景关系仍需上下文证据',true);return {content,details:{revision:draft.revision,scope:'intrinsic-'+args.componentId,intrinsicOnly:true}};
    }),
    tool('capture_multiview','获取多角度检查图','一次返回当前草稿的2–3个真实视角，适用于模型细节验收。componentId为组件/单对象ID，省略为全景；views可用perspective/front/side/back/left/top/bottom/underside且不重复。下一轮读取图片后再audit_model_detail或review_model，不提前编造结论。若被外物遮挡，自身形体用capture_component_intrinsic查看完整单体，连接和场景关系仍需上下文；inspect_view_visibility推荐较少遮挡的方向；仍看不清再用capture_detail_diagnostic显式指定局部真实节点；隔离图只能诊断，不能验收。',Type.Object({componentId:Type.Optional(Type.String()),views:Type.Array(Type.Union(['perspective','front','side','back','left','top','bottom','underside'].map(x=>Type.Literal(x))),{minItems:2,maxItems:3})}),async(_id,args)=>{check();const componentId=args.componentId?.trim()||undefined;if(new Set(args.views).size!==args.views.length)throw Error('检查视角不能重复');const ids=componentId?draft.nodes.filter(n=>(n.assemblyId??n.id)===componentId).map(n=>n.id):undefined;if(ids&&!ids.length)throw Error('截图目标不存在');const content:({type:'text';text:string}|ImageContent)[]=[];const newEvidence=args.views.some(view=>!capturedViews.has(`${draft.revision}:${view}:${componentId??'whole'}`));const pictures:string[]=[];for(const view of args.views)pictures.push(await captureDraft(view,ids));for(const [i,view] of args.views.entries()){const picture=pictures[i];check();const key=`${draft.revision}:${view}:${componentId??'whole'}`;capturedViews.add(key);latestCaptureKey=key;content.push({type:'text',text:`真实检查图 ${usedSoftwareCapture?'software几何检查，可能因预算降低分辨率；看不清须待验，材质未验收 ':''}revision=${draft.revision} view=${view} scope=${componentId??'whole'}`},asImage(picture));}capturedRevision=draft.revision;capturedTurn=calls;captureScope=targetCoversVisibleScene(draft,ids)?'whole':componentId!;if(captureScope==='whole')for(const view of args.views)capturedViews.add(`${draft.revision}:${view}:whole`);if(newEvidence)progress();emit('多角度图片已返回，等待下一轮细节检查',true);return {content,details:{revision:draft.revision,scope:captureScope}};}),
    tool('capture_view','获取模型截图','渲染最新草稿并返回实际截图供视觉检查。必须在最后一次修改后截图。只在关键阶段或修正后截图。按edit_scene返回的review选择范围：结构/布局用scope=scene全景且不传assemblyId；单组件外观可用scope=assembly及assemblyId近景；非视觉修改无需截图。省略scope时兼容旧调用：传assemblyId为近景，否则为全场景。',Type.Object({view:Type.Union([Type.Literal('perspective'),Type.Literal('front'),Type.Literal('side'),Type.Literal('back'),Type.Literal('left'),Type.Literal('top'),Type.Literal('bottom'),Type.Literal('underside')]),scope:Type.Optional(Type.Union([Type.Literal('scene'),Type.Literal('assembly')])),assemblyId:Type.Optional(Type.String())}),async(_id,args)=>{
      check();const assemblyId=args.assemblyId?.trim()||undefined;
      if(args.scope==='scene'&&assemblyId)throw new Error('全场景截图scope=scene时请省略assemblyId，不能把近景称为全景');
      if(args.scope==='assembly'&&!assemblyId)throw new Error('设备近景scope=assembly需要真实assemblyId');
      const targetIds=assemblyId?draft.nodes.filter(n=>(n.assemblyId??n.id)===assemblyId).map(n=>n.id):undefined;
      if(targetIds&&!targetIds.length)throw new Error('截图目标组合不存在，请读取真实assemblyId');
      const data=await captureDraft(args.view,targetIds);check();captureScope=targetCoversVisibleScene(draft,targetIds)?'whole':assemblyId!;const key=`${draft.revision}:${args.view}:${captureScope}`;latestCaptureKey=key;if(!capturedViews.has(key)){capturedViews.add(key);progress();}capturedRevision=draft.revision;capturedTurn=calls;
      emit(`已获取 ${captureScope==='whole'?'全场景':'设备近景 '+captureScope} / ${args.view} 截图（版本 ${draft.revision}），等待模型复核`,true);
      return {content:[{type:'text' as const,text:`这是草稿 revision=${draft.revision} scope=${captureScope} 的真实渲染截图。${usedSoftwareCapture?'当前为软件几何检查图，不能用于材质/阴影验收。':''}对照用户参考图检查。`},asImage(data)],details:{revision:draft.revision,view:args.view,scope:captureScope}};
    }),
    tool('configure_animation','生成或修改动画','直接为现有场景创建可播放动画，不是文字建议。保留布局，用真实对象ID配置运动。需先plan_model。完整替换动画时保留不需修改的轨道。移动/停留/往返用position关键帧；转动用rotation；显隐visibility；跟随释放follow；复杂曲线用受限表达式。完成后preview_animation→下一轮review_model→submit_preview。',Type.Object({summary:Type.String({minLength:1,maxLength:300}),name:Type.String({minLength:1,maxLength:120}),duration:Type.Number({exclusiveMinimum:0,maximum:3600}),loop:Type.Boolean(),tracks:Type.Array(Type.Object({id:Type.String({minLength:1,maxLength:120}),name:Type.String({maxLength:120}),targetIds:Type.Array(Type.String(),{minItems:1,maxItems:512}),channel:Type.Union(['position','rotation','scale','visibility','follow'].map(v=>Type.Literal(v))),keyframes:Type.Optional(Type.Array(Type.Object({time:Type.Number({minimum:0}),value:Type.Union([Type.Number(),Type.Boolean(),Type.Tuple([Type.Number(),Type.Number(),Type.Number()])])}),{minItems:1,maxItems:128})),expression:Type.Optional(Type.Unknown()),axis:Type.Optional(Type.Tuple([Type.Number(),Type.Number(),Type.Number()])),pivot:Type.Optional(Type.Tuple([Type.Number(),Type.Number(),Type.Number()])),sourceId:Type.Optional(Type.String()),start:Type.Optional(Type.Number({minimum:0})),end:Type.Optional(Type.Number({minimum:0}))}),{minItems:1,maxItems:128})}),async(id,args)=>{
      const {summary:description,...program}=args;const editor=tools.find(t=>t.name==='edit_scene')!;
      const result=await editor.execute(id,{summary:description,operations:[{op:'setAnimation',animation:{version:1,...program}}]},signal,()=>{});
      return {...result,content:[...result.content,{type:'text',text:'动画配置已写入草稿。现在必须调用preview_animation检查动态样本，下一轮review_model，然后submit_preview；无需让用户手工编写动画或建立动作库。'}]};
    }),
    tool('preview_animation','检查动态预览','对当前动画实际求值并渲染。默认检查三个时间点；完整搬运等多阶段任务可指定包含0的3–6个不同时间点times及view，覆盖取货、转向、运输、放货等阶段，遮挡时换侧面检查。不能代替完整碰撞或生产仿真。下一轮review_model复核图片。',Type.Object({times:Type.Optional(Type.Array(Type.Number({minimum:0}),{minItems:3,maxItems:6})),view:Type.Optional(Type.Union(['perspective','front','side','back','left','top','bottom','underside'].map(view=>Type.Literal(view))))}),async(_id,args)=>{
      check();if(!draft.animation)throw new Error('尚无动画，请先通过edit_scene的setAnimation配置运动轨道');
      const evaluate=createAnimationEvaluator(draft),candidates=new Set<number>([draft.animation.duration*.381966,draft.animation.duration*.618034,draft.animation.duration]);
      for(const track of draft.animation.tracks){const keys=track.keyframes??[];for(let i=1;i<keys.length;i++)if(JSON.stringify(keys[i].value)!==JSON.stringify(keys[i-1].value)){candidates.add((keys[i].time+keys[i-1].time)/2);candidates.add(keys[i].time);break;}if(track.channel==='follow')candidates.add((track.start!+track.end!)/2);}
      const first=evaluate(0),times=[0];let previous=JSON.stringify([...first]);for(const time of candidates){const current=JSON.stringify([...evaluate(time)]);if(current!==previous){times.push(time);previous=current;if(times.length===3)break;}}if(times.length<3)times.push(draft.animation.duration);
      if(args.times){if(!args.times.includes(0)||new Set(args.times).size!==args.times.length||args.times.some(time=>time>draft.animation!.duration))throw Error('动态样本时间必须包含0、不重复，并处于动画时长以内');times.splice(0,times.length,...[...args.times].sort((a,b)=>a-b));}
      const content:({type:'text';text:string}|ImageContent)[]=[];let moving=false;
      for(const time of times){const poses=evaluate(time);if([...poses].some(([id,p])=>JSON.stringify(p)!==JSON.stringify(first.get(id))))moving=true;const picture=await captureDraft(args.view??'perspective',undefined,time);check();content.push({type:'text',text:`动态样本 time=${time.toFixed(2)}s revision=${draft.revision} scope=whole；不是完整碰撞或动画验收`},asImage(picture));}
      if(!moving)throw new Error('动画样本没有可见变化，请检查目标、关键帧/表达式和时长，不要声称已让场景动起来');
      const key=`${draft.revision}:animation:${args.view??'perspective'}:${times.join(',')}:whole`;if(!capturedViews.has(key)){capturedViews.add(key);progress();}latestCaptureKey=key;capturedRevision=draft.revision;capturedTurn=calls;captureScope='whole';animationCheckedRevision=draft.revision;
      emit(`动态预览：${draft.animation.tracks.length}条轨道，已检查${times.length}个时间样本，等待视觉复核`,true);return {content,details:{revision:draft.revision,times}};
    }),
    tool('review_model','记录视觉检查','看过最新截图后记录外轮廓、比例、悬空/穿插、颜色和参考图差异。存在差距必须如实记录。若本轮修改已完成，传completion合并提交待确认预览，减少再为提交单独请求一轮；仍执行submit_preview的全部检查，未验收项必须保留。',Type.Object({observations:Type.String({minLength:5,maxLength:1200}),issues:Type.Array(Type.String({maxLength:200}),{maxItems:8}),completion:Type.Optional(Type.Object({summary:Type.String({minLength:1,maxLength:1200}),remainingIssues:Type.Array(Type.String({maxLength:200}),{maxItems:8})}))}),async(_id,args)=>{
      check();if(calls<=capturedTurn)throw new Error('截图刚刚返回，请在下一轮读取图片后再调用 review_model，不能提前编造视觉检查');
      if(capturedRevision!==draft.revision)throw new Error('请先获取当前版本截图，再做视觉检查');
      if(!reviewedViews.has(latestCaptureKey)){reviewedViews.add(latestCaptureKey);progress();}
      const nextBlockers=confirmedCompletionIssues(args.issues,true);
      if(completionBlockers.length&&!nextBlockers.length&&completionFingerprint===visualFingerprint(draft)&&completionEvidence===latestCaptureKey.split(':').slice(1).join(':'))throw Error('此前已确认的问题尚未修复或补充新证据，不能只清空问题列表。请实际修改模型，或换视角/动态时间点取证后再复核。');
      reviewedRevision=draft.revision;if(captureScope==='whole')reviewedWholeRevision=draft.revision;reviewIssues=[...args.issues];recordCompletionBlockers(nextBlockers);
      emit(`视觉检查（${captureScope==='whole'?'全场景':'设备近景'} / 版本 ${draft.revision}）：${args.observations}${args.issues.length?'；待改进：'+args.issues.join('；'):''}`,true);
      if(args.completion)return await tools.find(t=>t.name==='submit_preview')!.execute(_id+':submit',args.completion,signal);
      return textResult((args.issues.length?'差异已记录，未解决问题必须在submit_preview明确列出。':'已记录模型自检，不代表人工验收通过。')+(reviewedWholeRevision===draft.revision||(reviewRequirement(base,draft).kind==='local'&&reviewRequirement(base,draft).assemblyId===captureScope)?' 当前所需范围复核已完成，达到本轮要求即可submit_preview；其他限制如实列出，不要反复截图空转。':' 此次修改涉及更广范围，提交前还需capture_view({view:"perspective",scope:"scene"})，下一轮review_model。'));
    }),
    tool('submit_preview','提交待确认预览','结束本轮，把草稿交给用户确认，不能直接写入正式场景。按实际修改范围复核：纯名称/分类无需截图；单组件外观可近景；结构/布局用全景；动画用动态样本。',Type.Object({summary:Type.String({minLength:1,maxLength:1200}),remainingIssues:Type.Array(Type.String({maxLength:200}),{maxItems:8})}),async(_id,args)=>{
      check();assertPoseGoal();if(draft.animation&&JSON.stringify(draft.animation)!==JSON.stringify(base.animation)&&animationCheckedRevision!==draft.revision)throw new Error('动画已修改，请先preview_animation检查运动样本，并在下一轮review_model复核后提交');if(needsDesign&&activity.quality?.revision!==draft.revision)throw new Error('完整场景提交前请调用inspect_scene检查最新草稿的配套、连接与尺度');if(!operations.length)throw new Error('未修改场景，无需提交；直接回答用户即可');
      const requirement=reviewRequirement(base,draft);
      const reviewed=reviewedRevision===draft.revision&&(reviewedWholeRevision===draft.revision||(requirement.kind==='local'&&captureScope===requirement.assemblyId));
      if(requirement.kind==='local'&&!reviewed)throw new Error(`请对修改的组件 capture_view({view:"perspective",scope:"assembly",assemblyId:"${requirement.assemblyId}"})，下一轮 review_model 后提交；无需重复全场景检查。`);
      if(requirement.kind!=='none'&&!reviewed)throw new Error(`尚未完成版本 ${draft.revision} 的全场景复核（最近截图范围：${captureScope==='whole'?'全场景':'设备近景 '+captureScope}；最近全景复核版本：${reviewedWholeRevision<0?'无':reviewedWholeRevision}）。请调用 capture_view({view:"perspective",scope:"scene"})，省略assemblyId；下一轮读取图片并调用review_model，再submit_preview。`);
      const detail=refreshDetail();
      activity.blueprintCoverage=inspectBlueprintCoverage(draft,activity.objectBlueprints??[],activity.featureBindings??[]);
      const remaining=[...new Set([...referenceObservationCoverage(activity.objectBlueprints??[],!!options.images?.length&&referenceShapeChanged(base,draft)).issues,...activity.blueprintCoverage.issues,...reviewIssues,...args.remainingIssues,...(activity.quality?.revision===draft.revision?activity.quality.issues:[])])];
      activity.requirements=checkRequirements(draft,requirements);
      const unchecked=activity.requirements.items.filter(r=>r.status!=='pass');
      if(requirementsNeedRefresh)remaining.push('最新补充要求尚未重新整理核对');
      remaining.push(...unchecked.map(r=>`需求${r.status==='mismatch'?'不符':'待核对'}：${r.quote}；${r.actual}`));
      const detailFailures=detail.reviews.flatMap(review=>review.checks.filter(item=>item.status==='fail').map(item=>`${review.componentId}：${item.evidence}`));
      const blockers=[...new Set([...confirmedCompletionIssues(reviewIssues,true),...confirmedCompletionIssues(args.remainingIssues),...detailFailures,...unchecked.filter(item=>item.status==='mismatch').map(item=>`需求不符：${item.quote}；${item.actual}`)])];
      if(completionBlockers.length&&!blockers.length)throw Error('仍有上次提交记录的未解决问题，请先实际修复并重新复核，不能通过清空剩余问题结束任务。');
      recordCompletionBlockers(blockers);
      if(completionBlockers.length)throw Error('仍有已确认缺陷或未完成的功能，不能作为完成预览提交：'+completionBlockers.join('；')+'。请保留有效草稿，局部修复或补足对应动态样本，再获取最新证据复核。不要把原任务缩成局部诊断；若达到预算或无法继续，系统会保留未完成草稿。');
      submittedQualityIssues=[...new Set([...remaining,...detail.issues])];
      if(activity.generationReview)activity.generationReview={...activity.generationReview,basicReviewCompleted:requirement.kind==='none'||reviewed};
      summary=(isFast?'快速模式草稿\n':'')+args.summary+(remaining.length?'\n仍需改进：'+remaining.join('；'):requirement.kind==='none'?'\n已完成数据校验；本次非视觉修改无需重新截图。':'\n已完成模型自检，仍请人工核对参考图。');
      if(isFast&&detail.issues.length)summary+='\n快速基础复核已完成；六项细节验收仍有未完成项，不代表精细质量通过。';
      submitted=true;activity.outcome='preview-ready';emit((detail.issues.length||activity.blueprintCoverage.issues.length)?'本次修改已提交，等待你确认应用；模型整体仍有待验收项':'已完成本轮，等待你确认应用',true);
      return {...textResult('预览已提交，等待用户确认应用。'),terminate:true};
    }),
  ];
  const parallelEnabled=cfg.parallelDrafts===true&&!options.workerTask&&!options.editScope?.nodeIds&&!options.editScope?.lockPlacement;
  if(parallelEnabled)tools.push(tool('build_components_parallel','并行生成独立组件','实验能力：仅用于2–4个确实需要独立建模的静态新组件，最多2个子代理同时运行。每个只接收自己的brief和公共style，不读取主场景/历史。position是合并时世界平移，子模型围绕原点地面Y=0。主代理负责明确尺寸/风格/接口约束并在合并后统一检查质量、布局和接触。现成目录批量放置、简单调整或相互依赖的动作直接用已有工具，不要启动子代理。可能增加总Token，不保证提速。',Type.Object({style:Type.String({maxLength:500}),items:Type.Array(Type.Object({name:Type.String({minLength:1,maxLength:80}),brief:Type.String({minLength:15,maxLength:1800}),position:Type.Tuple([Type.Number(),Type.Number(),Type.Number()])}),{minItems:2,maxItems:4})}),async(_id,args)=>{
    check();if(needsDesign&&!activity.plan.length)throw Error('完整场景先plan_model，再拆分独立组件');
    const epoch=parallelEpoch,controller=new AbortController();parallelController=controller;
    const abortChildren=()=>controller.abort();signal?.addEventListener('abort',abortChildren,{once:true});
    const rows:ChildRun[]=args.items.map(job=>({id:makeId(),name:job.name,status:'queued',inputTokens:0,outputTokens:0,usageReported:false,rounds:0,toolCalls:0}));
    activity.parallelRuns=[...(activity.parallelRuns??[]),...rows];activity.usageIncomplete=true;emit('已安排独立组件，最多两个子代理并行',true);
    try{
      const results=await runBoundedJobs(args.items,async(job,index)=>{
        const row=rows[index];row.status='running';row.startedAt=Date.now();emit('子代理正在生成：'+job.name);
        try{
          const child=await runModelingAgent({text:'只创建独立组件“'+job.name+'”。'+job.brief+'。共同要求：'+args.style+'。围绕原点建模，Y=0为地面，不创建整个场景、不创建额外地板。任务完毕提交数据草稿，最终视觉质量由主代理检查。',config:{...cfg,parallelDrafts:false},document:isolatedDocument(base),selection:[],workerTask:true,budgetState,images:options.images,signal:controller.signal,captureAvailable:()=>false,streamFn:options.workerStreamFn?.(job.name),onActivity:childActivity=>{
            if(controller.signal.aborted||epoch!==parallelEpoch)return;
            activity.inputTokens+=Math.max(0,childActivity.inputTokens-row.inputTokens);activity.outputTokens+=Math.max(0,childActivity.outputTokens-row.outputTokens);
            row.inputTokens=childActivity.inputTokens;row.outputTokens=childActivity.outputTokens;row.rounds=childActivity.turn;row.toolCalls=childActivity.toolCalls;row.usageReported=childActivity.usageReported;
            activity.usageReported=activity.usageReported||row.usageReported;emit('子代理：'+job.name+' · '+childActivity.title);
          }});
          if(controller.signal.aborted||epoch!==parallelEpoch)throw new DOMException('已停止子代理','AbortError');
          if(!child.activity.dataDraftSubmitted)throw Error('子代理没有提交完整数据草稿；未自动合并');
          const command=componentDraftCommand(child.result.doc,job);row.status='ready';return {command,summary:child.batch.summary.slice(0,500)};
        }catch(e){row.status=controller.signal.aborted?'cancelled':'failed';row.error=(e instanceof Error?e.message:'子任务失败').split(cfg.apiKey||'\u0000').join('[已隐藏]').slice(0,180);throw e;}
        finally{row.endedAt=Date.now();}
      },controller.signal);
      check();if(epoch!==parallelEpoch)throw Error('用户已更新指令，旧子草稿未合并');
      const successful=results.filter((r):r is PromiseFulfilledResult<{command:Command;summary:string}>=>r.status==='fulfilled');
      const result=successful.length?await commitEdits({summary:'合并'+successful.length+'个独立组件草稿',operations:successful.map(r=>r.value.command)}):textResult('所有子任务未产出可合并草稿；未修改主场景');
      for(const row of rows)if(row.status==='ready')row.status='done';
      return {...result,content:[...result.content,{type:'text' as const,text:JSON.stringify({subagents:rows,warning:'所有子草稿均未视觉验收；主代理必须统一检查。失败任务需要补做，不可声称已完成。',summaries:successful.map(r=>r.value.summary)})}]};
    }finally{
      signal?.removeEventListener('abort',abortChildren);if(parallelController===controller)parallelController=null;
      for(const row of rows)if(row.status==='queued'||row.status==='running'||(row.status==='ready'&&controller.signal.aborted)){row.status='cancelled';row.endedAt=Date.now();}
      activity.usageIncomplete=activity.timings.some(t=>t.kind==='model'&&t.usageState==='unknown')||activity.parallelRuns?.some(r=>!r.usageReported||r.status==='failed'||r.status==='cancelled');
      if(!signal?.aborted)emit('子代理阶段结束，保留全部已报告用量',true);
    }
  }));
  if(options.workerTask){const allowed=new Set(['retry_structured_component','bind_object_features','repair_structured_features','build_structured_component','read_saved_asset','inspect_asset_instances','align_saved_instances','plan_object_structure','bind_object_features','list_saved_assets','add_saved_assets','edit_scene','read_scene','find_scene_parts','list_mesh_components','add_mesh_component','add_mesh_components','read_component_recipe','add_reference_component','set_surface_detail','set_surfaces_batch','prepare_surface_uv','detail_quality_standard','inspect_scene','check_requirements','submit_data_preview']);for(let i=tools.length-1;i>=0;i--)if(!allowed.has(tools[i].name))tools.splice(i,1);}
  const model:Model<'openai-completions'>={id:cfg.model,name:cfg.model,api:'openai-completions',provider:'chat3d-gateway',baseUrl:cfg.baseURL.trim().replace(/\/+$/,''),reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:AGENT_LIMITS.outputPerTurn,compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,supportsStore:false,supportsUsageInStreaming:true,maxTokensField:'max_tokens'}};
  const prompt=buildModelingPrompt({draft,base,selection:selectionForDoc(draft),editScope:options.editScope,history:options.history,workerTask:options.workerTask,generationQuality,generationStyle:cfg.generationStyle,wantsAnimation,visualAvailable:visualAvailable(),parallelEnabled,preserveAssetShape,hasReferenceImages:!!options.images?.length});
  const underlyingFetch=options.streamFn?undefined:await getFetch();
  let transportFailure='';
  const f:typeof fetch|undefined=underlyingFetch?async(input,init)=>{try{return await underlyingFetch(input,init);}catch(error){
    if(!signal?.aborted)transportFailure=(error instanceof Error?error.message:'网络请求失败').split(cfg.apiKey||'\u0000').join('[已隐藏]').slice(0,700);throw error;
  }}:undefined;
  let calls=0;
  const seenCalls=new Set<string>();
  const steeringMessages=new Map<number,{id:string;text:string;mode:'guide'|'question'}>();
  let steeringTimestamp=Date.now(),acceptingSteering=true,respondingToSteering=false;
  const providerUsageRounds=new Set<number>();
  const toolInputs=new Set<string>();
  const runner=new Agent({
    initialState:{model,systemPrompt:prompt,tools,thinkingLevel:'off'},toolExecution:'sequential',
    transformContext:async messages=>compactAgentContext(messages),
    streamFn:async(m,context,streamOptions)=>{
      check();if(submitted)throw new Error('本轮已完成');
      if(pauseReason)throw new Error(pauseReason);
      const exceeded=budgetExceeded(true);if(exceeded){stageReason=exceeded;throw new Error(exceeded);}
      if(JSON.stringify(context).length>2*1024*1024)throw new Error('本轮上下文超过2MB上限，请减少参考图或拆分场景');
      transportFailure='';budgetState.rounds++;calls++;turnActions=[];turnErrors=[];activity.turn=calls;activity.timings=[...activity.timings,{id:`model-${calls}`,kind:'model',label:`模型第 ${calls} 轮`,startedAt:Date.now()}];emit(`第 ${calls} 轮：等待模型决定下一步`);
      const recoveryNote=stagnantTurns>=2?'\n已连续无有效进展：不要重复read_scene或plan_model。若有校验错误，先修正失败参数；若计划已记录，执行一个最小有效edit_scene；若模型已完成，按review要求检查并提交；非视觉修改可直接提交。无法继续应明确说明阻碍。':'';
      const animationNext=wantsAnimation?(!activity.plan.length?'本轮用户要求实际动画：先plan_model，然后configure_animation。':JSON.stringify(draft.animation)===JSON.stringify(base.animation)?'本轮动画尚未创建或修改：下一步应configure_animation，不要只反复read_scene/capture_view。':animationCheckedRevision!==draft.revision?'动画已配置：下一步preview_animation。':reviewedWholeRevision!==draft.revision?'动态样本已返回：下一轮review_model。':'动态复核已完成：若需求已满足，下一步submit_preview。'):'';
      const completionNote=completionBlockers.length?'\n上次提交被拦截，仍须处理：'+completionBlockers.join('；')+'。先修正并重新取证，不要直接结束文字回复或把未完成任务说成完成。':'';
      const budgetNote=`\n${continuation?'本轮继续此前用户需求：'+resolvedIntent.slice(0,500)+'。':''}当前第${calls}轮，连续${stagnantTurns}轮没有有效进展。继续完成计划与细节；本次上限${budget.maxRounds}轮、${budget.maxMinutes}分钟、${budget.maxReportedTokens}已报告Token，到限应保留未完成草稿。当前输入${activity.inputTokens}、输出${activity.outputTokens} Token；避免无效重复。${animationNext}${recoveryNote}${completionNote}`;
      context={...context,messages:context.messages.map((message,index)=>index===0 && message.role==='system'?{...message,content:typeof message.content==='string'?message.content+budgetNote:[...message.content,{type:'text' as const,text:budgetNote}]}:message)};
      if(!visualAvailable()){
        const unavailable=new Set(['capture_view','capture_multiview','capture_quality_review','capture_detail_diagnostic','capture_component_intrinsic','preview_animation','review_model','audit_model_detail','audit_model_details_batch','submit_preview']);
        context={...context,messages:context.messages.map(message=>message.role==='system'?{...message,toolsAdded:message.toolsAdded?.filter(t=>!unavailable.has(t.name)),content:typeof message.content==='string'?message.content+'\n本次工具可用性覆盖：三维不可用，视觉工具不提供。忽略上文通用截图与逐项视觉审查步骤。系统会自动把全部细节标准标为未验收，不要调用audit_model_detail逐个填写unknown，也不要为凑验收字段反复读部件。继续完成所有数据对象与尺寸核对，再用submit_data_preview；不要在首个组件后结束。':message.content}:message)};
      }
      if(draft.nodes.some(n=>n.modelAsset))enabledToolGroups.add('assets');
      if(draft.nodes.some(n=>n.connection))enabledToolGroups.add('connections');
      if(preserveAssetShape)enabledToolGroups.add('interaction');
      for(const group of ['animation','surfaces','interaction','assets','connections'] as const)if(toolGroupNeeded(group,executionTexts.join('\n')))enabledToolGroups.add(group);
      context={...context,messages:context.messages.map(message=>message.role==='system'?{...message,toolsAdded:message.toolsAdded?exposeTools(message.toolsAdded,enabledToolGroups):undefined}:message)};
      if(!draft.nodes.some(n=>n.visible&&n.geometry))context={...context,messages:context.messages.map(message=>message.role==='system'?{...message,toolsAdded:message.toolsAdded?.filter(t=>t.name!=='detail_quality_standard')}:message)};
      if(preserveAssetShape&&base.nodes.some(n=>n.modelAsset)){
        const poseTools=new Set(['enable_modeling_tools','read_scene','find_scene_parts','find_scene_parts_batch','prepare_local_edit','read_pose_rig','prepare_local_edit','read_pose_rig','define_pose_rig','pose_with_rig','bend_existing_mesh','pose_existing_parts','edit_scene','retry_scene_edit','move_components','read_saved_asset','list_saved_assets','inspect_asset_instances','detail_quality_standard','inspect_model_quality','inspect_scene','check_requirements','capture_view','capture_multiview','capture_quality_review','capture_component_intrinsic','capture_detail_diagnostic','inspect_view_visibility','inspect_contact_surfaces','inspect_connections','connect_scene_parts','set_connection','bind_object_features','audit_model_detail','audit_model_details_batch','review_model','submit_preview','submit_data_preview','configure_animation','preview_animation']);
        context={...context,messages:context.messages.map(message=>message.role==='system'?{...message,toolsAdded:message.toolsAdded?.filter(t=>poseTools.has(t.name))}:message)};
      }
      if(localFocus&&!localFocus.ids.every(id=>draft.nodes.some(n=>(n.assemblyId??n.id)===id)))localFocus=undefined;
      if(localFocus)context={...context,messages:context.messages.map(m=>m.role==='system'&&typeof m.content==='string'?{...m,content:m.content.replace(/# 场景上下文[\s\S]*?(?=\n本次编辑约束：)/,'# 场景上下文\n当前已选择局部上下文，以最近prepare_local_edit或编辑结果的目标/邻近信息为准；完整场景保留，其他对象只需摘要。\n')}:m)};
      context={...context,messages:normalizeModelingRequestMessages(context.messages)};
      stamp(`model-${calls}`,{requestFootprint:measureRequestFootprint(context)});
      if(options.streamFn)return options.streamFn(m,context,streamOptions);
      return stream(model,context,{...streamOptions,apiKey:cfg.apiKey.trim(),fetch:f,maxTokens:AGENT_LIMITS.outputPerTurn,maxRetries:0,timeoutMs:AGENT_LIMITS.idleTimeoutMs,
        onProviderStreamEvent:data=>{if(providerHasUsage(data))providerUsageRounds.add(calls);firstData();emit(activity.title);},onResponse:()=>{stamp(`model-${calls}`,{responseAt:Date.now()});emit(`第 ${calls} 轮：服务已响应，正在接收`);} });
    },
    beforeToolCall:async({toolCall})=>{check();stageReason=stageReason||budgetExceeded();if(stageReason)return {block:true,reason:stageReason,terminate:true};if(!visualAvailable()&&['audit_model_detail','audit_model_details_batch'].includes(toolCall.name))return {block:true,reason:'当前无可用画面证据，系统已自动标记细节未验收；无需逐项填写unknown。继续完成数据编辑与必要数量检查，然后submit_data_preview。'};if(!visualAvailable()&&(['capture_view','capture_multiview','capture_quality_review','capture_detail_diagnostic','capture_component_intrinsic','preview_animation','review_model'].includes(toolCall.name)||(toolCall.name==='submit_preview'&&reviewRequirement(base,draft).kind!=='none')))return {block:true,reason:unavailableStage(),terminate:true};if(runner.hasQueuedMessages())return {block:true,reason:'用户补充了新指令，请先读取并按最新要求重新决定操作',terminate:true};if(questionOnly&&['retry_structured_component','bind_object_features','repair_structured_features','build_structured_component','align_saved_instances','add_saved_assets','retry_scene_edit','define_pose_rig','pose_with_rig','bend_existing_mesh','pose_existing_parts','pose_bimanual_interaction','pose_arm_interaction','create_hand_pose','edit_scene','configure_animation','configure_process_route','add_reference_component','add_mesh_component','add_mesh_components','connect_scene_parts','remove_connection','set_surface_detail','set_surfaces_batch','build_components_parallel','prepare_surface_uv','move_components','submit_data_preview','submit_preview'].includes(toolCall.name))return {block:true,reason:'用户当前选择只提问，请直接回答，不要修改或提交场景',terminate:true};if(seenCalls.has(toolCall.id))return {block:true,reason:'重复的工具调用ID已拒绝，避免重复修改'};seenCalls.add(toolCall.id);if(submitted)return {block:true,reason:'本轮已提交预览',terminate:true};if(pauseReason)return {block:true,reason:pauseReason,terminate:true};activity.toolCalls++;return undefined;},
    finishTurn:async({message})=>{
      stageReason=stageReason||budgetExceeded();
      if(stageReason){emit(stageReason,true);return {action:'end'};}

      if(runner.hasQueuedMessages()){submitted=false;pauseReason='';stagnantTurns=0;failedTurns=0;return {action:'continue'};}
      if(submitted)return {action:'end'};
      const answeredSteering=(respondingToSteering||questionOnly)&&message.stopReason==='stop'&&!message.content.some(c=>c.type==='toolCall');respondingToSteering=false;
      if(answeredSteering)return {action:'end'};
      if(message.stopReason==='stop'&&!message.content.some(c=>c.type==='toolCall')){
        if(operations.length&&completionBlockers.length&&visualAvailable()&&completionRecoveryTurns<2){completionRecoveryTurns++;emit('仍有未修复问题，继续完成当前任务',true);return {action:'continue'};}
        if(completionBlockers.length)pauseReason='已确认的问题仍未解决，模型未继续修复；已暂停并保留未完成草稿：'+completionBlockers.join('；');
        emit(completionBlockers.length?pauseReason:'模型已结束文字回复，本轮不再自动续问；已有修改仅保留为待确认草稿',true);return {action:'end'};
      }
      if(progressVersion!==observedProgress)completionRecoveryTurns=0;
      emit(`第${calls}轮执行：${turnActions.join(' → ')||'仅文字回复'}；${progressVersion===observedProgress?'无新的有效进展':'有有效进展'}；${draft.animation?'已有动画配置':'尚无动画配置'}`,true);
      const noProgress=progressVersion===observedProgress;failedTurns=turnErrors.length&&noProgress?failedTurns+1:0;
      stagnantTurns=noProgress?stagnantTurns+1:0;observedProgress=progressVersion;
      if(failedTurns>=AGENT_LIMITS.consecutiveErrorTurns)pauseReason='连续3轮工具调用失败且无有效进展，已暂停；原始错误已保留';
      if(!pauseReason&&stagnantTurns>=AGENT_LIMITS.noProgressTurns)pauseReason='连续4轮没有有效建模或复核进展，已暂停以避免空转';
      if(pauseReason){emit(pauseReason,true);return {action:'end'};}
      return operations.length||(wantsAnimation&&activity.plan.length)?{action:'continue'}:undefined;
    },
  });
  const abort=()=>{parallelController?.abort();runner.abort();};signal?.addEventListener('abort',abort,{once:true});
  const unsubscribe=runner.subscribe(event=>{
    if(signal?.aborted)return;
    if(event.type==='message_end'&&event.message.role==='user'){const guide=steeringMessages.get(event.message.timestamp);if(guide){respondingToSteering=true;questionOnly=guide.mode==='question';localFocus=undefined;if(preserveAssetShapeIntent(guide.text,options.history))preserveAssetShape=true;userTexts.push(guide.text);if(!questionOnly){executionTexts.push(guide.text);requirementsNeedRefresh=requirements.length>0;}steeringMessages.delete(event.message.timestamp);options.onSteeringApplied?.(guide.id);emit('已接收补充要求，正在按最新指令调整',true);}}
    // The runner validates before execute/beforeToolCall. Cache schema failures here too.
    // Only attach recovery to actual schema rejection, never blocked/truncated calls.
    if(event.type==='tool_execution_start'&&structuredTools.has(event.toolName)&&!questionOnly&&!submitted&&!pauseReason&&!runner.hasQueuedMessages()){
      const target=tools.find(t=>t.name===event.toolName)!;
      try{validateToolArguments(target,{type:'toolCall',id:event.toolCallId,name:event.toolName,arguments:event.args});}
      catch{if(failedStructured.remember(event.toolCallId,draft.revision,structuredRetryScope(),{summary:event.toolName,operations:[{tool:event.toolName,args:event.args}]})){schemaFailures.add(event.toolCallId);structuredIssues=Infinity /* reaching domain validation is bounded recovery progress */;}}
    }
    if(event.type==='tool_execution_end'&&schemaFailures.delete(event.toolCallId)){
      const result=event.result as {content:{type:string;text?:string}[]};
      if(event.isError&&result.content.some(c=>c.text?.startsWith('Validation failed for tool'))){for(const c of result.content)if(c.text)c.text=c.text.split('Received arguments:')[0].trim();result.content.push({type:'text',text:'失败结构ID='+event.toolCallId+'；用retry_structured_component仅纠正错误字段，最多两次；sweepTube使用segments(8–128)、radialSegments(8–32)，不是tubularSegments。可替换该零件geometry.params删除错误字段。'});}
      else failedStructured.clear();
    }
    if(event.type==='tool_execution_start'){const inputKey=JSON.stringify([draft.revision,event.toolName,event.args,parallelEpoch]);const repeatedInput=toolInputs.has(inputKey);toolInputs.add(inputKey);const readArgs=event.args as {assemblyId?:string;nodeIds?:string[]};const readLabel=readArgs.assemblyId?'组件:'+(draft.nodes.find(n=>n.assemblyId===readArgs.assemblyId)?.assemblyName??readArgs.assemblyId):readArgs.nodeIds?'节点:'+readArgs.nodeIds.map(id=>draft.nodes.find(n=>n.id===id)?.name??id).join(',').slice(0,120):'总览';turnActions.push(event.toolName+(event.toolName==='read_scene'?`(${readLabel})`:''));const label=tools.find(t=>t.name===event.toolName)?.label??event.toolName;activity.timings=[...activity.timings,{id:event.toolCallId,kind:'tool',label,toolName:tools.some(t=>t.name===event.toolName)?event.toolName:undefined,repeatedInput,argumentsChars:JSON.stringify(event.args??{}).length,sceneRevision:draft.revision,detail:event.toolName==='read_scene'?readLabel:typeof (event.args as {summary?:unknown}).summary==='string'?String((event.args as {summary:string}).summary).slice(0,300):undefined,startedAt:Date.now()}];emit(`正在${label}`);}
    if(event.type==='tool_execution_end'){const result=event.result as {content?:{type:string;text?:string}[]};const detail=event.isError?(result?.content??[]).filter(c=>c.type==='text').map(c=>c.text??'').join(' ').split('Received arguments:')[0].slice(0,500):undefined;stamp(event.toolCallId,{endedAt:Date.now(),failed:event.isError,resultChars:JSON.stringify(result?.content??[]).length,...(detail?{detail}:{})});emit(activity.title);}
    if(event.type==='tool_execution_end'){
      if(event.isError){
        const result=event.result as {content?:{type:string;text?:string}[]};
        const detail=(result?.content??[]).filter(c=>c.type==='text').map(c=>c.text??'').join(' ').split('Received arguments:')[0].slice(0,700);
        if(detail!==pauseReason){lastToolError=`${event.toolName}：${detail}`;turnErrors.push(lastToolError);if(!rootToolErrors.includes(lastToolError)){rootToolErrors.push(lastToolError);if(rootToolErrors.length>3)rootToolErrors.shift();}}
        emit(`工具失败：${event.toolName}${detail?'：'+detail:''}`,true);
      }
    }
    if(event.type==='message_update'){
      const e=event.assistantMessageEvent;
      if(e.type==='text_delta'){
        const id=`explanation-${calls}`;const entries=activity.explanations??[];const previous=entries.find(v=>v.id===id)?.text??'';
        activity.explanations=[...entries.filter(v=>v.id!==id),{id,text:(previous+e.delta).slice(0,4000)}].slice(-40);
      }
      if(e.type==='text_delta'||e.type==='toolcall_delta'){
        firstData();const timing=activity.timings.find(t=>t.id===`model-${calls}`);if(timing?.firstContentAt===undefined)stamp(`model-${calls}`,{firstContentAt:Date.now()});
        activity.characters+=e.delta.length;emit(e.type==='toolcall_delta'?'正在接收建模工具参数':'正在接收模型回复');
      }
    }
    if(event.type==='message_end' && event.message.role==='assistant'){
      const publicText=event.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
      if(publicText.trim()){const id=`explanation-${calls}`;activity.explanations=[...(activity.explanations??[]).filter(v=>v.id!==id),{id,text:publicText.slice(0,4000)}].slice(-40);}
      const usage=event.message.usage;
      const measured=normalizedUsage(usage,providerUsageRounds.has(calls));
      stamp(`model-${calls}`,{endedAt:Date.now(),...measured,failed:event.message.stopReason==='error'||event.message.stopReason==='aborted'});
      if(measured.usageState==='unknown')activity.usageIncomplete=true;
      if(measured.usageState!=='unknown'){budgetState.reportedTokens+=measured.inputTokens+measured.outputTokens;activity.usageReported=true;activity.inputTokens+=measured.inputTokens;activity.outputTokens+=measured.outputTokens;}
      emit(activity.title);
    }
  });
  const budgetTimer=setTimeout(()=>{activity.usageIncomplete=true;stageReason=taskBudgetReason(budget,budget.maxMinutes*60_000,calls,activity.inputTokens+activity.outputTokens);emit(stageReason,true);budgetController.abort();},Math.max(0,budget.maxMinutes*60_000-(Date.now()-budgetStarted)));
  try {
    check();
    options.onControl?.({steer:(id,text,images=[],mode='guide')=>{
      if(!acceptingSteering||signal?.aborted||submitted||pauseReason)return false;
      const content=[{type:'text' as const,text:(mode==='question'?'用户要求先回答这个问题，本轮禁止修改场景、动画或提交；可读取场景，回答后保留现有草稿暂停。':'')+'用户在执行中补充要求（与之前冲突时按这条最新要求执行；先回答问题或修正计划，保留有效草稿）：'+text},...images.map(asImage)];
      parallelEpoch++;parallelController?.abort();
      const timestamp=++steeringTimestamp;steeringMessages.set(timestamp,{id,text,mode});
      if(/不要|取消|无需/.test(text)&&/动画|动作/.test(text))wantsAnimation=false;else if(/动画|动作|动起来|运动/.test(text))wantsAnimation=true;
      runner.steer({role:'user',content,timestamp});
      emit('收到补充要求，将在当前操作结束后调整',true);return true;
    }});
    await runner.prompt(options.text||'请根据参考图建模',(options.images??[]).map(asImage));check();
    const last=[...runner.state.messages].reverse().find(m=>m.role==='assistant');
    if(last?.role==='assistant' && (last.stopReason==='error'||last.stopReason==='aborted'))throw new Error(transportFailure||last.errorMessage||'模型服务未完成请求，请检查工具调用兼容性');
    if(operations.length&&!submitted){emit('本轮结束，已保留未完成阶段草稿',true);return checkpoint(stageReason|| (pauseReason?(pauseReason+'\n原始工具错误：'+rootToolErrors.join('；')):last?.role==='assistant'&&last.stopReason==='stop'&&last.content.some(c=>c.type==='text')?last.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):'本轮未完成“最新截图→复核→提交”，没有自动修改正式场景。'));}
    if(!operations.length&&stageReason)throw new Error(stageReason);
    if(!operations.length && pauseReason)throw new Error(pauseReason+'\n最近执行：'+activity.events.filter(e=>/^第\d+轮执行/.test(e)).slice(-4).join('；')+(rootToolErrors.length?'\n原始工具错误：'+rootToolErrors.join('；'):''));
    if(!operations.length){summary=last?.role==='assistant'?last.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):'';if(!summary.trim())throw new Error(lastToolError?'工具调用未完成：'+lastToolError:'模型未返回有效回复，请检查模型工具调用支持');
      if(summary.trim().startsWith('{') && summary.includes('\"operations\"'))throw new Error('模型输出了普通JSON而未调用建模工具。请检查网关的工具调用支持，或在模型配置切回单次生成');}
    if(!submitted)activity.outcome='answered';
    return {batch:{requestId:makeId(),projectId:base.projectId,baseRevision:base.revision,selectedIds:options.selection,editScope:options.editScope,taskStatus:'submitted',qualityIssues:[...new Set([...submittedQualityIssues,...(activity.detailAcceptance?.issues??[])])],summary,operations,...((requirementsNeedRefresh||!!submittedQualityIssues.length||!!activity.detailAcceptance?.issues.length||!!activity.blueprintCoverage?.issues.length||activity.requirements?.items.some(r=>r.status!=='pass'))?{incomplete:true,continuation:'继续核对并完成：'+executionTexts.join('；')}:{})},result:{doc:draft,applied,errors:[]},activity};
  } catch(error) {
    activity.outcome=outerSignal?.aborted?'cancelled':stageReason?'budget-exhausted':'failed';
    if(operations.length && !outerSignal?.aborted){emit('任务中断，已保留阶段草稿',true);return checkpoint(stageReason||(budgetController.signal.aborted?budgetExceeded():'')||(error instanceof Error?error.message:'模型请求中断'));}
    if(budgetController.signal.aborted)throw new Error(stageReason||budgetExceeded());
    emit(activity.title);throw error;
  } finally {clearTimeout(budgetTimer);acceptingSteering=false;options.onControl?.(null);unsubscribe();signal?.removeEventListener('abort',abort);}
}
