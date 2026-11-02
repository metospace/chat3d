import type {MessageRun} from '../store';
import type {AgentActivity} from '../ai/modelingAgent';
export function runStatusLabel(run:MessageRun,activity:AgentActivity|undefined|null=run.activity){
 if(run.status==='running')return '正在处理';
 if(run.status==='failed')return '处理未完成';
 if(run.status==='stopped')return '已停止';
 if(activity?.outcome==='partial'||activity?.outcome==='budget-exhausted')return '未完成，已保留草稿';
 if(run.status==='preview')return activity?.detailAcceptance?.status==='pending'||activity?.detailAcceptance?.status==='needs_work'?'预览已生成，待核对':'预览已生成';
 return '本轮已结束';
}
