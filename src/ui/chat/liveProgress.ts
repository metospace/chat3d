import type {AgentActivity} from '../../ai/modelingAgent';
import {activityProgress} from '../../domain/customerProgress';

/** Describe observed transport/execution state, never guessed work or percentages. */
export function liveProgress(activity:AgentActivity|undefined|null,blender=false){
 const timings=activity?.timings??[];
 let current:AgentActivity['timings'][number]|undefined;
 for(let i=timings.length-1;i>=0;i--)if(timings[i].endedAt===undefined){current=timings[i];break;}
 const usesBlender=blender||timings.some(step=>step.toolName==='run_blender_python'||step.id.startsWith('blender-model-'));
 const hasPreviousAttempt=timings.some(step=>step.toolName==='run_blender_python'&&step.endedAt!==undefined);
 if(current?.kind==='tool'&&current.toolName==='run_blender_python')return {label:'Blender 正在建模与渲染',note:'生成完成后将在工作台预览，确认应用后才会修改场景。'};
 const progress=activityProgress(activity,true);
 if(progress.modelState==='waiting')return {label:'等待模型回复',note:usesBlender?(hasPreviousAttempt?'正在等待模型返回下一次建模指令。':'本机 Blender 会在收到完整脚本后启动。'):'当前场景保持不变。'};
 if(progress.modelState==='responding')return {label:usesBlender?'正在接收 Blender 建模内容':'正在接收建模内容',note:usesBlender?'收到完整脚本后才会启动 Blender。':'本轮修改尚未应用。'};
 if(current?.kind==='tool')return {label:progress.label,note:progress.reviewNote??'正在执行当前步骤，完成后会更新结果。'};
 if(timings.length)return {label:'正在整理本轮结果',note:'结果尚未返回。'};
 return {label:'正在准备生成',note:'正在整理本次需求和参考附件。'};
}
