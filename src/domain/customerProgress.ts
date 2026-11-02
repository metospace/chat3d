import type {AgentActivity} from '../ai/modelingAgent';
const labels:Record<string,string>={"enable_modeling_tools": "启用按需建模工具", "detail_quality_standard": "读取通用细节验收标准", "audit_model_detail": "记录对象细节验收", "prepare_surface_uv": "建立网格投影UV", "set_surface_detail": "设置材质表面细节", "audit_model_details_batch": "批量记录细节验收", "set_surfaces_batch": "批量处理材质与缺失UV", "connect_scene_parts": "记录或对齐对象连接", "inspect_connections": "检查对象连接", "inspect_contact_surfaces": "检查接触点是否落在表面", "remove_connection": "解除对象连接", "move_components": "批量平移组件", "find_scene_parts": "定位需要的部件", "add_mesh_components": "批量放置精细模型", "read_saved_asset": "读取资产用途与连接点", "inspect_asset_instances": "检查资产实例与连接点", "align_saved_instances": "按连接点平移对齐资产", "list_saved_assets": "检索已保存模型资产", "add_saved_assets": "批量插入保存的资产", "list_mesh_components": "查看精细模型目录", "add_mesh_component": "放置精细模型", "configure_process_route": "配置业务路线", "add_reference_component": "添加结构参考组件", "submit_data_preview": "保留数据草稿", "read_component_recipe": "读取可编辑结构参考", "check_requirements": "核对明确需求", "plan_object_structure": "规划通用对象结构", "build_structured_component": "按结构方案生成单体", "repair_structured_features": "局部重建指定结构特征", "bind_object_features": "关联结构特征与实际模型", "plan_model": "规划建模步骤", "read_scene": "读取当前场景", "edit_scene": "修改模型草稿", "retry_structured_component": "纠正失败单体的局部参数", "retry_scene_edit": "纠正失败批次的局部字段", "inspect_scene": "检查场景完整度", "pose_arm_interaction": "联动调整手臂与手部", "pose_bimanual_interaction": "调整双手搬运姿态", "create_hand_pose": "构建通用手部姿态", "inspect_part_topology": "检查通用部件拓扑", "inspect_workcells": "核对通用作业单元完整度", "inspect_access_route": "检查连续通路净空", "inspect_clearance": "检查指定操作净空", "inspect_model_quality": "汇总模型质量检查", "capture_quality_review": "获取本轮验收图组", "inspect_view_visibility": "选择较少遮挡的视角", "capture_detail_diagnostic": "隔离局部诊断图", "capture_component_intrinsic": "获取完整单体自身检查图", "capture_multiview": "获取多角度检查图", "capture_view": "获取模型截图", "configure_animation": "生成或修改动画", "preview_animation": "检查动态预览", "review_model": "记录视觉检查", "submit_preview": "提交待确认预览", "build_components_parallel": "并行生成独立组件"};
/** Translate technical telemetry only at presentation time. Keep original diagnostics intact. */
export function customerText(value:string|undefined,fallback='正在处理模型'){
 if(!value?.trim())return fallback;
 return value.replace(/\bsk-[A-Za-z0-9_-]+/g,'[已隐藏]').replace(/Bearer\s+\S+/gi,'[已隐藏]')
 .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g,name=>labels[name]??'模型处理步骤')
 .replace(/主代理|子代理/g,'建模任务').replace(/工具调用|工具执行/g,'处理步骤').replace(/Pi 建模任务/g,'建模任务');
}
/** Live status is independent of public explanations and never inferred from elapsed time. */
export function activityProgress(activity:AgentActivity|undefined|null,active:boolean,now?:number){
 const phase=active?activity?.phase:undefined;
 let modelState:'waiting'|'responding'|undefined;
 if(active){
  const timings=activity?.timings??[];
  const toolRunning=timings.some(step=>step.kind==='tool'&&step.endedAt===undefined);
  if(!toolRunning)for(let i=timings.length-1;i>=0;i--){
   const step=timings[i];
   if(step.kind!=='model')continue;
   if(step.endedAt===undefined)modelState=step.firstContentAt===undefined?'waiting':'responding';
   break;
  }
 }
 const phaseLabel=phase?{planning:'正在规划',building:'正在构建模型',reviewing:'正在复核模型',repairing:'正在修正模型'}[phase]:'正在处理';
 const label=phaseLabel+(modelState==='waiting'?' · 等待模型响应':modelState==='responding'?' · 正在接收模型响应':'');
 const editedAt=activity?.lastModelEditAt;
 const modelEditAgeSeconds=active&&now!==undefined&&editedAt!==undefined&&Number.isFinite(editedAt)?Math.max(0,Math.floor((now-editedAt)/1000)):undefined;
 const reviewNote=phase==='reviewing'?'正在检查当前模型与画面；复核本身不会改变模型，画面可能保持不变。':undefined;
 return {phase,modelState,label,modelEditAgeSeconds,reviewNote};
}
export function progressSteps(activity:AgentActivity|undefined|null,active:boolean){
 const groups:Array<{label:string;count:number;completed:number;failed:number;running:boolean;seconds:number}>=[];
 for(const step of activity?.timings??[]){
  if(step.kind!=='tool')continue;
  const label=customerText(step.label,'处理模型内容');const previous=groups[groups.length-1];
  const row=previous?.label===label?previous:{label,count:0,completed:0,failed:0,running:false,seconds:0};
  if(row!==previous)groups.push(row);row.count++;
  if(step.failed)row.failed++;else if(step.endedAt!==undefined)row.completed++;
  else if(active)row.running=true;
  if(step.endedAt!==undefined)row.seconds+=Math.max(0,step.endedAt-step.startedAt)/1000;
 }
 return groups;
}
