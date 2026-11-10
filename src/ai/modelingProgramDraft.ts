import {Quaternion,Vector3,Euler} from 'three';
import {serializeProject} from '../domain/project';
import type {SceneDocument,SceneNode,Vec3} from '../domain/types';
import type {Command} from '../domain/commands';
import type {ObjectBlueprint} from '../domain/objectBlueprint';
import {validateFeatureBindings} from '../domain/objectBlueprint';
import {validateBlueprintDimensions} from '../domain/structuredComponent';
import {STRUCTURED_BYTES_LIMIT} from '../domain/structureLimits';
import {componentDraftCommand} from './parallelDrafts';

export interface ProgramFeature {key:string;partNames:string[]}
/** Validate actual output before constructing one atomic import/replacement transaction. */
export function modelingProgramCommands(draft:SceneDocument,generated:SceneDocument,args:{name:string;source:string;stage:'silhouette'|'detailed';position?:Vec3;yaw?:number;replaceComponentId?:string;features:ProgramFeature[]},plan:ObjectBlueprint):Command[]{
 const doc=structuredClone(generated),group=doc.nodes[0]?.assemblyId??doc.nodes[0]?.id;
 if(!group||!doc.nodes.length)throw Error('脚本没有返回可编辑部件');
 const known=new Set(plan.features.map(f=>f.key));
 if(!args.features.length||new Set(args.features.map(f=>f.key)).size!==args.features.length||args.features.some(f=>!known.has(f.key)))throw Error('脚本特征必须引用当前方案且不能重复');
 const binding={blueprintKey:plan.key,componentId:group,features:args.features.map(f=>{
  if(!f.partNames.length||new Set(f.partNames).size!==f.partNames.length)throw Error('特征部件名称不能为空或重复');
  const ids=f.partNames.flatMap(name=>{const matches=doc.nodes.filter(n=>n.name===name);if(!matches.length)throw Error('脚本未返回命名部件：'+name);return matches.map(n=>n.id);});
  return {key:f.key,nodeIds:[...new Set(ids)]};
 })};
 validateFeatureBindings(doc,[plan],[binding]);
 // Partial silhouette builds intentionally leave later features unbound, never mark them accepted.
 const complete=plan.features.every(f=>binding.features.some(b=>b.key===f.key));
 if(args.stage==='detailed'&&!complete)throw Error('细化构建必须覆盖完整方案的实际特征，缺少：'+plan.features.filter(f=>!binding.features.some(b=>b.key===f.key)).map(f=>f.name).join('、'));
 if(complete)validateBlueprintDimensions(plan,doc.nodes);
 for(const [index,node] of doc.nodes.entries())node.modelStructure={blueprintKey:plan.key,featureKeys:binding.features.filter(f=>f.nodeIds.includes(node.id)).map(f=>f.key),localTransform:structuredClone(node.transform),...(index===0?{blueprint:structuredClone(plan)}:{})};
 doc.nodes[0].modelingProgram={source:args.source,createdAt:Date.now(),stage:args.stage};
 if(args.yaw){const rotation=new Quaternion().setFromEuler(new Euler(0,args.yaw*Math.PI/180,0));for(const node of doc.nodes){node.transform.position=new Vector3(...node.transform.position).applyQuaternion(rotation).toArray() as Vec3;node.transform.rotationQuaternion=rotation.clone().multiply(new Quaternion(...node.transform.rotationQuaternion)).toArray() as [number,number,number,number];}}
 const removed=args.replaceComponentId?draft.nodes.filter(n=>(n.assemblyId??n.id)===args.replaceComponentId):[];
 if(args.replaceComponentId&&!removed.length)throw Error('待重建组件不存在，请读取真实组件ID');
 const removedIds=new Set(removed.map(n=>n.id));
 if(draft.animation?.tracks.some(t=>t.targetIds.some(id=>removedIds.has(id))||(t.sourceId&&removedIds.has(t.sourceId))))throw Error('目标有动画或跟随绑定，请使用保留节点ID的局部编辑，不能整体重建丢失绑定');
 if(draft.nodes.some(n=>n.connection&&removedIds.has(n.connection.targetId))||removed.some(n=>n.connection||n.poseRig||n.modelAsset))throw Error('目标有连接、关节或资产关联，请用局部编辑保留关系，不能整体重建');
 const imported=componentDraftCommand(doc,{name:args.name,brief:'参数化脚本生成，尚未视觉验收',position:args.position??[0,0,0]});
 if(imported.op!=='importComponentDraft')throw Error('参数化组件导入命令无效');
 // 20 MiB is the structured-component recipe budget for the NEW import only.
 // The merged scene uses the real project cap (400 MiB) from serializeProject's default.
 serializeProject({...doc,nodes:imported.nodes,materials:imported.materials,assets:[]},undefined,STRUCTURED_BYTES_LIMIT);
 serializeProject({...draft,nodes:[...draft.nodes.filter(n=>!removedIds.has(n.id)),...imported.nodes],materials:[...draft.materials,...imported.materials]});
 return [...(removed.length?[{op:'delete' as const,targetIds:[...removedIds]}]:[]),imported];
}

export function modelingProgramSource(doc:SceneDocument,componentId:string){
 const members=doc.nodes.filter(n=>(n.assemblyId??n.id)===componentId);
 if(!members.length)throw Error('组件不存在');
 const saved=members.find((n:SceneNode)=>n.modelingProgram)?.modelingProgram;
 if(!saved)throw Error('该组件没有参数化源码；保留现有几何并使用局部编辑，或按用户授权明确重建');
 return {...saved,note:'这是上次构建源码，不会自动反映之后手动或局部编辑；修改前读取当前部件，保留用户改动。部件ID与当前状态请用read_scene定向查询。',parts:{count:members.length,names:members.slice(0,12).map(n=>n.name.slice(0,80)),truncated:members.length>12}};
}
