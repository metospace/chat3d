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
 if(progress.modelState==='waiting')return {label:receivingReview?'等待模型复核 Blender 输出':'等待模型回复',note:usesBlender?(receivingReview?'正在等待模型检查效果图或返回局部修改；此时不执行 Blender。':'本机 Blender 会在收到完整脚本后启动。'):'当前场景保持不变。'};
 if(progress.modelState==='responding')return {label:usesBlender?(receivingReview?'正在接收 Blender 复核内容':'正在接收 Blender 建模脚本'):'正在接收建模内容',note:usesBlender?(receivingReview?'正在接收模型的看图复核或修改回复；接收内容不代表 Blender 正在执行。':'正在接收脚本，尚未执行；收到完整脚本后才会启动 Blender。'):'本轮修改尚未应用。'};
 if(current?.kind==='tool')return {label:progress.label,note:progress.reviewNote??'正在执行当前步骤，完成后会更新结果。'};
 if(timings.length)return {label:'正在整理本轮结果',note:'结果尚未返回。'};
 return {label:'正在准备生成',note:'正在整理本次需求和参考附件。'};
}
