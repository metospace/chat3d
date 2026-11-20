import {safeRequestFootprint} from '../ai/requestFootprint';
import {safeExecutionMetadata,safeToolFailureCategory} from '../ai/executionTelemetry';
import type {AgentActivity} from '../ai/modelingAgent';
import type {EditorState} from '../store';
import type {DiagnosticEntry} from '../ai/runTraceLog';
import {createDiagnosticBundle,type DiagnosticExportSnapshot} from './diagnosticBundle';
export {expandDiagnosticBundle} from './diagnosticBundle';
export type {DiagnosticBundle,DiagnosticExportSnapshot,DiagnosticOmission} from './diagnosticBundle';
// Only allowlisted operational metadata. Never export messages, raw errors, URLs,
// tool arguments, scene content, images or credentials (even if an error echoed them).
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:undefined;
const oneOf=<T extends string>(value:unknown,values:readonly T[])=>values.find(item=>item===value);
// Tool names are app-owned, not arbitrary identifiers that could disguise a credential.
const TOOL_NAMES=['read_scene_contract','recall_evidence','patch_modeling_program','build_modeling_program','read_modeling_program','enable_modeling_tools','detail_quality_standard','audit_model_detail','prepare_surface_uv','set_surface_detail','audit_model_details_batch','set_surfaces_batch','connect_scene_parts','inspect_connections','inspect_contact_surfaces','remove_connection','move_components','find_scene_parts_batch','find_scene_parts','add_mesh_components','read_saved_asset','inspect_asset_instances','align_saved_instances','list_saved_assets','add_saved_assets','list_mesh_components','add_mesh_component','configure_process_route','add_reference_component','submit_data_preview','read_component_recipe','check_requirements','plan_object_structure','build_structured_component','repair_structured_features','bind_object_features','plan_model','read_scene','edit_scene','retry_structured_component','retry_scene_edit','inspect_scene','prepare_local_edit','read_pose_rig','define_pose_rig','pose_with_rig','bend_existing_mesh','pose_existing_parts','pose_arm_interaction','pose_bimanual_interaction','create_hand_pose','inspect_part_topology','inspect_workcells','inspect_access_route','inspect_clearance','inspect_model_quality','capture_quality_review','inspect_view_visibility','capture_detail_diagnostic','capture_component_intrinsic','capture_multiview','capture_view','configure_animation','preview_animation','review_model','submit_preview','build_components_parallel'] as const;
const BLENDER_TOOLS=['run_blender_python','read_blender_script','patch_blender_script','review_blender_result'] as const;
const toolName=(value:unknown)=>oneOf(value,TOOL_NAMES)??oneOf(value,BLENDER_TOOLS);

export function runDiagnostics(status:string,activity:AgentActivity|null,error:string|null){
 const message=typeof error==='string'?error:'';
 const category=!message?null:/out of memory|内存不足/i.test(message)?'memory':/体验页访问验证|访问会话/.test(message)?'site-access':/网络|连接|fetch|Connection/i.test(message)?'connection':/超时|无响应/.test(message)?'timeout':/校验|参数|工具/.test(message)?'validation':'unclassified';
 const timings=activity&&Array.isArray(activity.timings)?activity.timings:[];
 return {
  format:'chat3d-diagnostics-v1',createdAt:new Date().toISOString(),
  status:oneOf(status,['idle','capturing','context','generating','validating','previewing','applying','error','cancelled']),
  errorCategory:category,httpStatus:message.match(/HTTP\s+(\d{3})/i)?.[1]??null,
  run:activity?{
   outcome:oneOf(activity.outcome,['preview-ready','partial','answered','budget-exhausted','cancelled','failed']),
   phase:oneOf(activity.phase,['planning','building','reviewing','repairing']),lastModelEditAt:finite(activity.lastModelEditAt),
   executionMeta:activity.executionMeta?safeExecutionMetadata(activity.executionMeta):undefined,
   turns:finite(activity.turn),
   usageIncomplete:activity.usageIncomplete===true||timings.some(t=>t.kind==='model'&&(t.usageState==='unknown'||(!t.usageState&&!(finite(t.inputTokens)||finite(t.outputTokens))))),
   subagents:Array.isArray(activity.parallelRuns)?activity.parallelRuns.map(r=>({status:oneOf(r.status,['queued','running','ready','done','failed','cancelled']),rounds:finite(r.rounds),toolCalls:finite(r.toolCalls),inputTokens:finite(r.inputTokens),outputTokens:finite(r.outputTokens),usageReported:typeof r.usageReported==='boolean'?r.usageReported:undefined,startedAt:finite(r.startedAt),endedAt:finite(r.endedAt)})):undefined,
   toolCalls:finite(activity.toolCalls),inputTokens:finite(activity.inputTokens),outputTokens:finite(activity.outputTokens),
   timings:timings.map(t=>({
    kind:oneOf(t.kind,['model','tool']),toolName:t.kind==='tool'?toolName(t.toolName):undefined,
    pendingToolName:t.kind==='model'?toolName(t.pendingToolName):undefined,
    failureCategory:t.kind==='tool'&&t.failed===true?(safeToolFailureCategory(t.failureCategory)??'other'):undefined,
    repeatedInput:typeof t.repeatedInput==='boolean'?t.repeatedInput:undefined,
    argumentsChars:finite(t.argumentsChars),resultChars:finite(t.resultChars),sceneRevision:finite(t.sceneRevision),
    firstDataAt:finite(t.firstDataAt),firstContentAt:finite(t.firstContentAt),responseAt:finite(t.responseAt),
    usageState:t.kind==='model'?(oneOf(t.usageState,['reported','reported-zero','unknown'])??((finite(t.inputTokens)||finite(t.outputTokens))?'reported':'unknown')):undefined,
    uncachedInputTokens:finite(t.uncachedInputTokens),cacheReadTokens:finite(t.cacheReadTokens),cacheWriteTokens:finite(t.cacheWriteTokens),
    startedAt:finite(t.startedAt),endedAt:finite(t.endedAt),failed:t.failed===true,
    inputTokens:finite(t.inputTokens),outputTokens:finite(t.outputTokens),requestFootprint:safeRequestFootprint(t.requestFootprint),
   })),
  }:null,
 };
}
export interface RunSummary {
 startedAt:number;endedAt?:number;status:string;mode?:string;outcome?:string;phase?:string;
 turns?:number;toolCalls?:number;inputTokens?:number;outputTokens?:number;usageIncomplete?:boolean;
 modelRounds:number;modelSeconds:number;toolSeconds:number;firstModelAt?:number;lastModelAt?:number;
 title:string;error?:string;
}
const RUN_SUMMARY_LIMIT=50;
const summaryText=(value:unknown,max=160)=>typeof value==='string'?value.slice(0,max):undefined;
/** Per-run digests survive even when the full scene export is too large to build.
 * Sourced from message run records, which persist with the session independent of lastRun. */
export function runSummaries(messages:EditorState['messages']):RunSummary[]{
 const output:RunSummary[]=[];
 for(const message of messages){
  const run=message.run;
  if(!run)continue;
  const activity=run.activity;
  const timings=activity&&Array.isArray(activity.timings)?activity.timings:[];
  let modelSeconds=0,toolSeconds=0,modelRounds=0,firstModelAt:number|undefined,lastModelAt:number|undefined;
  for(const timing of timings){
   if(timing.kind!=='model'||typeof timing.startedAt!=='number')continue;
   modelRounds++;
   if(firstModelAt===undefined||timing.startedAt<firstModelAt)firstModelAt=timing.startedAt;
   const end=typeof timing.endedAt==='number'?timing.endedAt:undefined;
   if(end!==undefined){modelSeconds+=Math.max(0,end-timing.startedAt)/1000;if(lastModelAt===undefined||end>lastModelAt)lastModelAt=end;}
  }
  for(const timing of timings){
   if(timing.kind!=='tool'||typeof timing.startedAt!=='number'||typeof timing.endedAt!=='number')continue;
   toolSeconds+=Math.max(0,timing.endedAt-timing.startedAt)/1000;
  }
  output.push({
   startedAt:typeof run.startedAt==='number'?run.startedAt:message.createdAt,
   endedAt:run.endedAt,status:run.status,mode:run.mode,
   outcome:summaryText(activity?.outcome,30),phase:summaryText(activity?.phase,20),
   turns:finite(activity?.turn),toolCalls:finite(activity?.toolCalls),
   inputTokens:finite(activity?.inputTokens),outputTokens:finite(activity?.outputTokens),
   usageIncomplete:activity?.usageIncomplete===true||undefined,
   modelRounds,modelSeconds:Math.round(modelSeconds*10)/10,toolSeconds:Math.round(toolSeconds*10)/10,
   firstModelAt,lastModelAt,
   title:summaryText(activity?.title,120)??summaryText(message.text,120)??'建模请求',
   error:summaryText(message.error,200),
  });
  if(output.length>=RUN_SUMMARY_LIMIT)break;
 }
 return output;
}

export type FullDiagnosticsSnapshot=Pick<EditorState,'aiStatus'|'lastRun'|'aiError'|'messages'|'doc'|'pendingBatch'|'pendingResult'|'past'|'future'|'aiConfig'>;

// Keep runDiagnostics above as the unchanged metadata-only export contract.
// Full task diagnostics are losslessly interned after documented snapshot omissions.
export function fullRunDiagnostics(snapshot:DiagnosticExportSnapshot,liveDiagnostics?:readonly DiagnosticEntry[]){
 return createDiagnosticBundle(snapshot,liveDiagnostics);
}
