import type {AgentActivity} from '../../ai/modelingAgent';
import {activityProgress} from '../../domain/customerProgress';
import type {BlenderActivityProgress} from '../../ai/blenderProgress';

export const BLENDER_STAGE_LABELS:Record<BlenderActivityProgress['stage'],string>={
 receiving:'接收脚本',starting:'启动 Blender',executing:'执行脚本',saving:'保存工程',exporting:'导出模型',rendering:'渲染效果图',reading:'读取输出',completed:'输出已返回',reviewing:'模型看图复核',failed:'处理失败',
};

const blenderStageNotes:Record<BlenderActivityProgress['stage'],string>={
 receiving:'正在接收脚本，尚未执行；完整脚本收到后才会启动 Blender。',
 starting:'正在启动本机 Blender，尚未进入脚本执行阶段。',
 executing:'本机 Blender 正在执行已收到的脚本；不显示推测的执行百分比或代码行。',
 saving:'Blender 正在保存工程文件。',
 exporting:'Blender 正在导出模型文件。',
 rendering:'Blender 正在渲染效果图。',
 reading:'正在读取 Blender 实际生成的输出文件。',
 completed:'Blender 输出已返回，不代表模型复核通过或工程验收通过。',
 reviewing:'模型正在检查返回的效果图；复核本身不执行 Blender 脚本，也不代表工程验收。',
 failed:'本次处理未完成，请查看已记录的阶段和错误信息。',
};

const actionLabels:Record<string,string>={
 plan_model:'安排建模步骤',plan_object_structure:'拆解参考图与对象结构',build_modeling_program:'构建参数化模型',patch_modeling_program:'修改模型形体',build_structured_component:'构建对象结构',repair_structured_features:'修正结构细节',edit_scene:'更新模型',retry_scene_edit:'修正本轮修改',retry_structured_component:'修正结构参数',set_surface_detail:'处理表面材质',set_surfaces_batch:'完善材质与纹理',capture_view:'查看当前模型效果',capture_multiview:'检查多个观察角度',capture_quality_review:'检查模型与场景',review_model:'记录检查结果',audit_model_detail:'核对模型细节',audit_model_details_batch:'核对各部件细节',inspect_model_quality:'检查模型数据',inspect_scene:'检查场景布局',configure_animation:'设置模型动画',preview_animation:'检查动画效果',submit_preview:'整理待确认预览',submit_data_preview:'保留未验收草稿',run_blender_python:'执行 Blender 建模',patch_blender_script:'修改 Blender 模型',review_blender_result:'检查 Blender 效果图',
 read_scene:'读取当前模型结构',read_scene_contract:'核对已有布局和材质',read_modeling_program:'查看需要修改的模型部分',bind_object_features:'关联结构与实际部件',prepare_local_edit:'定位本次调整范围',prepare_surface_uv:'准备表面纹理坐标',check_requirements:'核对尺寸与数量要求',find_scene_parts:'定位需要调整的部件',find_scene_parts_batch:'定位本轮相关部件',list_saved_assets:'查找可复用模型',add_saved_assets:'放置已有模型',add_mesh_component:'载入模型部件',add_mesh_components:'载入模型部件',move_components:'调整模型位置',build_components_parallel:'分别构建多个组件',connect_scene_parts:'核对部件连接',inspect_contact_surfaces:'检查连接与接触面',inspect_connections:'核对连接位置',recall_evidence:'查看已有检查图',
};
export function actionLabel(name:string|undefined):string|undefined{return name&&Object.prototype.hasOwnProperty.call(actionLabels,name)?actionLabels[name]:undefined;}
const phaseActions:Record<NonNullable<AgentActivity['phase']>,string>={planning:'规划建模方案',building:'编写模型与部件',reviewing:'核对模型效果',repairing:'调整模型细节'};

/** Describe observed transport/execution state, never guessed work or percentages. */
export function liveProgress(activity:AgentActivity|undefined|null,blender=false){
 const timings=activity?.timings??[];
 let current:AgentActivity['timings'][number]|undefined;
 for(let i=timings.length-1;i>=0;i--)if(timings[i].endedAt===undefined){current=timings[i];break;}
 const usesBlender=blender||timings.some(step=>step.toolName==='run_blender_python'||step.id.startsWith('blender-model-'));
 const blenderProgress=activity?.blenderProgress;
 const progress=activityProgress(activity,true);
 if(blenderProgress){
  const {stage}=blenderProgress;
  if(stage==='reviewing'||stage==='completed'&&current?.kind==='model'){
   const label=progress.modelState==='responding'?'正在接收 Blender 复核内容':progress.modelState==='waiting'?'等待模型复核 Blender 输出':BLENDER_STAGE_LABELS[stage];
   return {label,note:blenderStageNotes.reviewing};
  }
  return {label:`Blender · ${BLENDER_STAGE_LABELS[stage]}`,note:blenderStageNotes[stage]};
 }
 if(current?.kind==='tool'&&(current.toolName==='run_blender_python'||current.toolName==='patch_blender_script'))return {label:'Blender 正在建模与渲染',note:'生成后会返回真实效果图供模型复核；确认应用后才会修改场景。'};
 if(current?.kind==='tool'&&current.toolName==='review_blender_result')return {label:'正在记录 Blender 看图复核',note:'只记录返回效果图的可见情况，不代表工程验收。'};
 const receivingReview=usesBlender&&activity?.phase==='reviewing';
 if(current?.kind==='tool')return {label:actionLabel(current.toolName)??progress.label,note:'正在执行，结果返回后会更新下方进展。'};
 const phase=activity?.phase??'planning',action=phaseActions[phase];
 if(progress.modelState==='waiting')return {label:receivingReview?'核对 Blender 输出':action,note:usesBlender?(receivingReview?'已请求模型检查效果图，等待回复；此时不执行 Blender。':'已发送需求，等待模型返回脚本；尚未启动 Blender。'):'本轮请求已发出，模型尚未返回公开内容；收到回复后继续更新。'};
 if(progress.modelState==='responding')return {label:usesBlender?(receivingReview?'正在接收复核说明':'正在编写 Blender 脚本'):current?.pendingToolName?`准备${actionLabel(current.pendingToolName)??action}`:action,note:usesBlender?'正在接收内容，完整脚本返回后才会执行。':current?.pendingToolName?'正在接收这一步的建模指令，尚未执行。':'正在接收模型回复，公开说明会实时显示在下方。'};
 if(timings.length)return {label:'整理本轮结果',note:'正在整理已返回的内容。'};
 return {label:'正在准备生成',note:'正在整理本次需求和参考附件。'};
}
