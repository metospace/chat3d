import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {SceneDocument} from '../domain/types';
import type {EditScope} from '../domain/editScope';
import {buildSceneContext} from './provider';

export function selectedAssemblies(doc:SceneDocument,selection:string[]):string[]{
 const selected=new Set(selection),groups=new Map<string,string[]>();for(const n of doc.nodes)if(n.assemblyId){const list=groups.get(n.assemblyId)??[];list.push(n.id);groups.set(n.assemblyId,list);}
 return [...groups].filter(([,ids])=>ids.every(id=>selected.has(id))).map(([id])=>id);
}
export function scopeContext(doc:SceneDocument,scope?:EditScope){
 if(!scope?.nodeIds)return {...scope,mode:'all-scene',selectionMeaning:'highlight-reference-only',instruction:'允许操作整个场景；高亮地面或其他对象不限制修改人物/设备。历史助手声称必须改选择范围的说法不适用于当前请求。'};
 const assemblies=selectedAssemblies(doc,scope.nodeIds),full=new Set(assemblies),byId=new Map(doc.nodes.map(n=>[n.id,n]));
 return {...scope,mode:'explicit-selection',nodeIds:scope.nodeIds.filter(id=>!full.has(byId.get(id)?.assemblyId??'')),selectedAssemblies:assemblies.map(id=>({id,parts:doc.nodes.filter(n=>n.assemblyId===id).length}))};
}
function materialContext(m:SceneDocument['materials'][number]){const {maps,...rest}=m;return {...rest,...(maps?{textureChannels:Object.keys(maps)}:{})};}
export function agentSceneContext(doc:SceneDocument,selection:string[],assemblyId?:string,editScope?:EditScope){
 const byId=new Map(doc.nodes.map(n=>[n.id,n])),selected=new Set(selection),full=new Set(selectedAssemblies(doc,selection));
 const counts=new Map<string,number>(),anchors=new Map<string,string>();for(const n of doc.nodes)if(n.assemblyId){counts.set(n.assemblyId,(counts.get(n.assemblyId)??0)+1);if(!anchors.has(n.assemblyId)||n.id===n.assemblyId)anchors.set(n.assemblyId,n.id);}
 const used=new Set(doc.nodes.map(n=>n.materialId));
 const detail={...buildSceneContext(doc,selection,editScope),materials:doc.materials.filter(m=>used.has(m.id)).map(materialContext)};
 if(assemblyId){const nodes=detail.nodes.filter(n=>byId.get(n.id)?.assemblyId===assemblyId);const used=new Set(nodes.map(n=>n.materialId));return {...detail,materials:detail.materials.filter(m=>used.has(m.id)),nodes};}
 const nodes=detail.nodes.filter(n=>{const a=byId.get(n.id)?.assemblyId;return !a||n.id===anchors.get(a)||(selected.has(n.id)&&!full.has(a));}).map(n=>{
  const original=byId.get(n.id)!,a=original.assemblyId;const result={...n};
  if(a&&n.id===anchors.get(a)){result.name=original.assemblyName??n.name.split(' · ')[0];result.desc=`组合${counts.get(a)}零件；锚点非中心；明细read_scene({assemblyId:"${a}"})；整机移动/旋转/缩放使用组件命令`;}
  if(result.parentId===null)delete result.parentId;if(result.visible===true)delete result.visible;
  if(JSON.stringify(result.scale)==='[1,1,1]')delete result.scale;if(JSON.stringify(result.rotationQuaternion)==='[0,0,0,1]')delete result.rotationQuaternion;
  return result;
 });
 const overviewMaterials=new Set(nodes.map(n=>n.materialId));
 return {...detail,selection:selection.filter(id=>!full.has(byId.get(id)?.assemblyId??'')),selectedAssemblies:[...full],nodes,materials:detail.materials.filter(m=>overviewMaterials.has(m.id)),materialDetail:'仅列出概览节点使用的材质；其他部件材质用find_scene_parts(fields=surface)或组件read_scene按需读取。'};
}

export function targetedSceneContext(doc:SceneDocument,selection:string[],nodeIds:Set<string>,editScope?:EditScope){
 const context=buildSceneContext(doc,selection,editScope),nodes=context.nodes.filter(n=>nodeIds.has(n.id)),used=new Set(nodes.map(n=>n.materialId));
 return {...context,nodes,materials:doc.materials.filter(m=>used.has(m.id)).map(materialContext)};
}

// Prune only obsolete tool snapshots. Keep call IDs, errors, latest scene and reference images intact.
export function compactAgentContext(messages: AgentMessage[]): AgentMessage[] {
  const sceneReads=new Set(['read_scene','read_animation','find_scene_parts','find_scene_parts_batch','prepare_local_edit','read_pose_rig']);
  const sceneEdits=new Set(['retry_structured_component','bind_object_features','repair_structured_features','build_structured_component','align_saved_instances','add_saved_assets','retry_scene_edit','define_pose_rig','pose_with_rig','bend_existing_mesh','pose_existing_parts','pose_bimanual_interaction','pose_arm_interaction','create_hand_pose','edit_scene','configure_animation','configure_process_route','add_reference_component','add_mesh_component','add_mesh_components','connect_scene_parts','remove_connection','set_surface_detail','set_surfaces_batch','build_components_parallel','prepare_surface_uv','move_components']);
  let latestScene=-1, latestEdit=-1, latestInspection=-1, latestAudit=-1, latestCaptureRevision='',latestCaptureScope='';
  const auditedScopes=new Set<string>();
  for(let i=0;i<messages.length;i++) {
    const m=messages[i];
    if(m.role!=='toolResult'||m.isError)continue;
    if(sceneReads.has(m.toolName)||sceneEdits.has(m.toolName))latestScene=i;
    if(sceneEdits.has(m.toolName))latestEdit=i;
    if(m.toolName==='inspect_scene')latestInspection=i;
    if(m.toolName==='audit_model_detail'||m.toolName==='audit_model_details_batch'){latestAudit=i;const d=m.details as {revision?:number;componentId?:string;componentIds?:string[]}|undefined;if(d?.componentId)auditedScopes.add(String(d.revision)+':'+d.componentId);for(const id of d?.componentIds??[])auditedScopes.add(String(d?.revision)+':'+id);}
    if((m.toolName==='capture_view'||m.toolName==='capture_multiview'||m.toolName==='capture_quality_review'||m.toolName==='capture_detail_diagnostic'||m.toolName==='capture_component_intrinsic')) {
      const text=m.content.filter(c=>c.type==='text').map(c=>c.text).join('');
      latestCaptureRevision=/revision=(\d+)/.exec(text)?.[1]??'';latestCaptureScope=/scope=([^\s]+)/.exec(text)?.[1]??'';
    }
  }
  const captureKeys=new Map<number,string[]>(),latestCaptureByKey=new Map<string,number>();
  for(let i=0;i<messages.length;i++){const m=messages[i];if(m.role!=='toolResult'||m.isError||!m.toolName.startsWith('capture_'))continue;const keys:string[]=[];for(const part of m.content){if(part.type!=='text')continue;const rev=/revision=(\d+)/.exec(part.text)?.[1],scope=/scope=([^\s]+)/.exec(part.text)?.[1],view=/view=([^\s]+)/.exec(part.text)?.[1]??(m.details as {view?:string}|undefined)?.view;if(rev&&scope&&view&&!['diagnostic'].includes(scope)){const key=[rev,scope,view].join(':');keys.push(key);latestCaptureByKey.set(key,i);}}if(keys.length)captureKeys.set(i,keys);}
  // Keep the latest detailed read of EACH scope at the current revision.
  // Reading component B must not erase component A's part IDs before a multi-object edit.
  let currentRevision=-1;const scopedReads=new Map<string,number>();
  for(const m of messages)if(m.role==='toolResult'&&!m.isError){const d=m.details as {revision?:number}|undefined;if(typeof d?.revision==='number')currentRevision=Math.max(currentRevision,d.revision);}
  for(let i=0;i<messages.length;i++){const m=messages[i];if(m.role==='toolResult'&&sceneReads.has(m.toolName)&&!m.isError){const d=m.details as {revision?:number;scopeKey?:string;snapshot?:boolean}|undefined;if(d?.revision===currentRevision&&d.snapshot&&d.scopeKey)scopedReads.set(d.scopeKey,i);}}
  const retainedReads=new Set([...scopedReads.values()].sort((a,b)=>b-a).slice(0,24));
  // Remove old successful edit call/result PAIRS, preserving the newest edit, errors,
  // user instructions and IDs supplied by current scene reads. Never mutate stored transcript.
  const historical=new Map<string,string>();
  for(let i=0;i<latestEdit;i++){
    const m=messages[i];if(m.role==='toolResult'&&sceneEdits.has(m.toolName)&&!m.isError&&i!==latestScene&&i!==latestEdit)historical.set(m.toolCallId,'');
  }
  const succeeded=new Set(messages.filter(m=>m.role==='toolResult'&&!m.isError&&sceneEdits.has(m.toolName)).map(m=>(m as any).toolCallId as string));
  const paired=new Set<string>();
  for(const m of messages)if(m.role==='assistant')for(const c of m.content)if(c.type==='toolCall'&&historical.has(c.id))paired.add(c.id);
  return messages.map((m,i)=>{
    if(m.role==='system'&&latestEdit>=0&&typeof m.content==='string')return {...m,content:m.content.replace(/# 场景上下文[\s\S]*?(?=\n本次编辑约束：)/,'# 场景上下文\n初始场景快照已过期；以最近成功编辑结果和当前版本查询为准。\n')};
    if(m.role==='assistant')return {...m,content:m.content.map(c=>{
      if(c.type!=='toolCall')return c;
      if(paired.has(c.id))return {type:'text' as const,text:`[历史edit_scene已成功：${String(c.arguments.summary??'场景修改').slice(0,180)}。参数已省略，以最新场景与read_scene为准。]`};
      // Successful calls have authoritative results. Avoid resending large generated
      // geometry on every subsequent round; retain pairing, summary and target IDs.
      // Failed or pending calls remain untouched so the model can diagnose/retry.
      if(succeeded.has(c.id)&&JSON.stringify(c.arguments).length>6000)return {...c,arguments:{_historyOnly:'已成功执行的历史参数摘要，不可作为新工具参数。当前几何和ID以对应结果为准。',summary:String(c.arguments.summary??c.name).slice(0,300),operationCount:Array.isArray(c.arguments.operations)?c.arguments.operations.length:null,targetIds:Array.isArray(c.arguments.operations)?[...new Set(c.arguments.operations.map((op:any)=>op.targetId).filter(Boolean))].slice(0,64):[],originalArgumentsOmitted:true}};
      return c;
    })};
    if(m.role!=='toolResult')return m;
    const imageKeys=captureKeys.get(i);if(imageKeys?.length&&imageKeys.every(key=>latestCaptureByKey.get(key)!==i))return {...m,content:[{type:'text' as const,text:'相同版本、对象和视角已有更新截图，请使用后续图片；原始记录保留。'}]};
    if(m.isError){if(m.toolName!=='plan_model')return m;return {...m,content:m.content.map(c=>c.type==='text'?{...c,text:c.text.split('Received arguments:')[0].slice(0,1800)+'\n规划参数未通过校验，场景未改变。steps和每类设备features最多24项；合并同类条目后重新调用plan_model，保留需求含义。不要原样重复失败参数。'}:c)};}
    if((m.toolName==='audit_model_detail'||m.toolName==='audit_model_details_batch')&&i!==latestAudit)return {...m,content:[{type:'text' as const,text:'此前细节检查已归入最新验收报告，原始记录保留。'}]};
    if(sceneReads.has(m.toolName)&&retainedReads.has(i)&&i!==latestScene){const raw=m.content.filter(c=>c.type==='text').map(c=>c.text).join('');if(raw.length>8000){try{const data=JSON.parse(raw);if(data.nodes)return {...m,content:[{type:'text' as const,text:JSON.stringify({revision:data.revision,scopeKey:data.scopeKey,detailOmitted:true,nodes:data.nodes.map((n:any)=>({id:n.id,name:n.name,position:n.position,rotationQuaternion:n.rotationQuaternion,scale:n.scale,materialId:n.materialId})),next:'部件ID与变换仍有效；需精确形状时用read_scene({nodeIds:[目标ID]})，仅取正在修改的部件。'})}]};}catch{}}}
    if(m.toolName==='inspect_scene'&&i!==latestInspection)return {...m,content:[{type:'text' as const,text:'历史场景检查已省略，请以最新检查和当前几何为准。'}]};
    if((sceneReads.has(m.toolName)||sceneEdits.has(m.toolName))&&i!==latestScene&&i!==latestEdit&&!retainedReads.has(i))
      return {...m,content:[{type:'text' as const,text:'该历史场景快照已由后续成功操作更新。请以最新场景工具结果为准；本工具执行成功。'}]};
    if((m.toolName==='capture_view'||m.toolName==='capture_multiview'||m.toolName==='capture_quality_review'||m.toolName==='capture_detail_diagnostic'||m.toolName==='capture_component_intrinsic')&&latestCaptureRevision) {
      const text=m.content.filter(c=>c.type==='text').map(c=>c.text).join('');
      const scopes=[...text.matchAll(/scope=([^\s]+)/g)].map(x=>x[1]);
      const allAudited=scopes.length>0&&scopes.every(scope=>scope!==latestCaptureScope&&scope!=='whole'&&scope!=='diagnostic'&&auditedScopes.has(latestCaptureRevision+':'+scope.replace(/^(interaction|intrinsic)-/,'')));
      if(/revision=(\d+)/.exec(text)?.[1]!==latestCaptureRevision||allAudited)
        return {...m,content:[{type:'text' as const,text:'历史版本或全部已审阅对象的截图已省略；未审阅对象图与原始参考图仍保留。'}]};
    }
    return m;
  }).filter(m=>!(m.role==='toolResult'&&paired.has(m.toolCallId)));
}

