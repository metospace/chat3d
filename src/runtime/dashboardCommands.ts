import {getTeamSession,type TeamClient} from '../domain/teamLibrary';
import {dashboardBinding,listDashboards,parseDashboardCommand,readDashboard,type DashboardMode,type DashboardVersion} from '../domain/dashboard';
import {inspectDashboardPlacement} from '../scene/dashboardRuntime';
import {activeConversationStore} from '../conversationStores';
import type {EditorStore} from '../store';

export async function prepareDashboardBinding(client:TeamClient,template:DashboardVersion,mode:DashboardMode,signal?:AbortSignal){
 signal?.throwIfAborted();if(template.archived)throw Error('模板已下架，不能新接入；已有场景的固定版本不受影响');
 const description=mode==='dashboard'?(await inspectDashboardPlacement(template.package,signal)).description:'';
 signal?.throwIfAborted();
 if(getTeamSession()!==client)throw Error('团队账户已变更，请重新选择看板');
 return {binding:dashboardBinding(client.base,template,mode),description};
}

/** A selected slash command binds only the scene that was active at selection time. */
export async function handleDashboardCommand(editor:EditorStore,selection?:{templateId:string;version:number}):Promise<boolean>{
 const state=editor.getState(),command=parseDashboardCommand(state.composerText);if(!command)return false;
 if(selection)command.remove=false;
 const text=state.composerText,projectId=state.doc.projectId,revision=state.doc.revision;
 if(activeConversationStore()!==editor)throw Error('当前场景已切换，请重新选择看板');
 if(!['idle','error','cancelled'].includes(state.aiStatus))throw Error('请先结束当前任务或处理修改预览');
 if(state.composerImages.length)throw Error('看板指令不接受图片附件，请先移除附件');
 let binding,description='';
 if(!command.remove){
  if(!command.name)throw Error('请从 /看板 列表选择一个模板');
  if(!state.doc.nodes.some(node=>node.visible))throw Error('当前场景没有可见模型，请先生成或导入场景后选择看板');
  const client=getTeamSession();if(!client?.user)throw Error('请先登录团队账户，再接入看板');
  const items=await listDashboards(client),matches=items.filter(item=>selection?item.id===selection.templateId:item.name===command.name||item.id===command.name);
  if(matches.length!==1)throw Error(matches.length?'模板重名，请在 /看板 列表选择具体模板':'未找到模板，请在 /看板 列表重新选择');
  if(selection&&matches[0].version!==selection.version)throw Error('模板已发布新版，请在列表重新选择');
  const template=await readDashboard(client,matches[0].id,selection?.version??matches[0].version);
  ({binding,description}=await prepareDashboardBinding(client,template,command.mode));
 }
 const current=editor.getState();
 if(activeConversationStore()!==editor||current.doc.projectId!==projectId||current.doc.revision!==revision||current.composerText!==text)throw Error('当前场景或输入已变更，请重新选择看板');
 const result=current.setDashboard(binding);if(!result.ok)throw Error(result.error);
 current.addUserMessage(command.remove?text:`/看板 ${command.mode==='overlay'?'叠加 ':''}${binding!.name}`);
 current.addAssistantMessage(binding?`已将当前场景接入“${binding.name}” v${binding.version}。${description?description+'。保留图表、指标和导航。':'看板叠加于当前场景，可通过 /看板 嵌入 选择融合布局。'}三维视图不带独立标题栏与底色。点击工作台“查看看板”查看结果；此接入可撤销。`:'已移除当前场景的看板接入。');
 current.setComposerText('');
 return true;
}
