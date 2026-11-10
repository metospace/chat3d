import {remapPoseRig,validatePoseRig,type PoseRig} from './poseRig';
import {PROJECT_SIZE_LIMIT,TEAM_SCENE_SIZE_LIMIT,serializeProject} from './project';
import {duplicateSelectedNodes,layoutSelectedNodes,wholeObjectIds} from './manualComposition';
import {editSelectedProperties,type SelectionChange} from './selectionProperties';
import {persistFeatureBinding} from './structuredComponent';
import {validateAnimation,remapAnimationForReplacement,type AnimationProgram} from './animation';

const MANUAL_PLACEMENT_OVERFLOW = `本次手动放置将使项目文件超过 ${PROJECT_SIZE_LIMIT}，请简化模型或拆分场景；团队场景发布上限为 ${TEAM_SCENE_SIZE_LIMIT}`;
// 命令系统（方案第 6 节）
// - 每个命令有固定参数 schema、目标类型限制、影响集计算、成本估计与逆操作
// - 一次 AI 批量修改 = 一条历史记录；命令串行提交，原子生效
// - 批量生成的 ID 由应用分配，不能相信模型生成的 ID
import {transformedAssembly} from './assemblyEditing';
import {buildAssembly,type AssemblyDefinition,type AssemblyPart} from './assembly';
import { buildWorkshopNodes } from '../workshop/adapter';
import { buildEquipment } from './equipment';
import { makeId } from '../util/ids';
import {
  Geometry,
  Material,
  Quaternion,
  SceneDocument,
  SceneNode,
  Transform,
  Vec3,
  validateDocument,
  validateMaterial,
} from './types';

// 单位修饰：世界空间修改需要父矩阵可逆；MVP 一层分组，直接按世界处理。
export type Space = 'world' | 'local';
export type TransformMode = 'set' | 'delta'; // set=移动到，delta=移动了。禁止混用

// 命令白名单（方案第一版开放集合的 P0 子集）
export type CommandOp =
  | 'setSurface'
  | 'setConnection'
  | 'importMeshComponent'
  | 'importComponentDraft'
  | 'setAnimation'
  | 'clearAnimation'
  | 'createAssembly'
  | 'duplicateAssembly'
  | 'createPrimitive'
  | 'translateAssembly'
  | 'createTemplate'
  | 'instantiateAsset'
  | 'updateParameters'
  | 'setTransform'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'transformAssembly'
  | 'appendAssemblyParts'
  | 'replaceAssemblyParts'
  | 'setAssemblyMetadata'
  | 'setPoseRig'
  | 'setAppearance'
  | 'setMaterial'
  | 'rename'
  | 'setVisibility'
  | 'duplicate'
  | 'reparent'
  | 'delete';

export interface CreatePrimitiveCommand {
  op: 'createPrimitive';
  tempId?: string; // 模型给的临时 ID，由应用映射到正式 ID
  name: string;
  parentId: string | null;
  geometry: Geometry;
  materialId?: string;
  transform: Transform;
}
export interface CreateTemplateCommand {
  op: 'createTemplate';
  tempId?: string;
  name?: string;
  yaw?: number;
  templateId: string; // 如 'workbench'，确定性模板
  parameters: Record<string, number>;
  parentId?: string | null;
  position?: Vec3; // 世界放置点
}
export interface InstantiateAssetCommand {
  op: 'instantiateAsset';
  tempId?: string;
  assetId: string; // 必须是已托管资产
  name?: string;
  parentId?: string | null;
  transform: Transform;
}
export interface UpdateParametersCommand {
  op: 'updateParameters';
  targetId: string;
  geometry?: Geometry; // 整体替换几何参数
  name?: string;
}
export interface SetTransformCommand {
  op: 'setTransform';
  targetId: string;
  transform: Partial<Transform>; // 未指定的分量保持不变
}
export interface TranslateCommand {
  op: 'translate';
  targetId: string;
  space: Space;
  mode: TransformMode;
  value: Vec3; // 米
}
export interface RotateCommand {
  op: 'rotate';
  targetId: string;
  space: Space;
  mode: TransformMode;
  axis: Vec3; // 归一化轴
  angle: number; // 角度制
  quaternion?: Quaternion; // 优先于 axis/angle
}
export interface ScaleCommand {
  op: 'scale';
  targetId: string;
  mode: TransformMode;
  value: Vec3; // scale 比例
}
export interface SetMaterialCommand {
  op: 'setMaterial';
  targetId: string;
  materialId: string; // 必须已存在于 materials
}
export interface RenameCommand {
  op: 'rename';
  targetId: string;
  name: string;
}
export interface SetVisibilityCommand {
  op: 'setVisibility';
  targetId: string;
  visible: boolean;
}
export interface DuplicateCommand {
  op: 'duplicate';
  targetId: string;
  tempId?: string;
  offset?: Vec3; // 复制偏移，默认 [0,0,0]
}
export interface ReparentCommand {
  op: 'reparent';
  targetId: string;
  parentId: string | null;
  keepWorldTransform?: boolean; // false 时按局部处理
}
export type DeleteCommand = {op:'delete';scope?:'assembly'} & (
  | {targetId:string;targetIds?:never}
  | {targetIds:string[];targetId?:never}
);

/** Explicit node/assembly deletion, including descendants, never library assets. */
export function deletionNodeIds(doc:SceneDocument,op:DeleteCommand):string[]{
  const ids=new Set(op.targetIds??(op.targetId?[op.targetId]:[]));
  if(op.scope==='assembly'){
    const assemblies=new Set(doc.nodes.filter(n=>ids.has(n.id)&&n.assemblyId).map(n=>n.assemblyId!));
    for(const n of doc.nodes)if(n.assemblyId&&assemblies.has(n.assemblyId))ids.add(n.id);
  }
  const children=new Map<string,string[]>();
  for(const n of doc.nodes)if(n.parentId){const list=children.get(n.parentId)??[];list.push(n.id);children.set(n.parentId,list);}
  const queue=[...ids];for(let i=0;i<queue.length;i++)for(const id of children.get(queue[i])??[])if(!ids.has(id)){ids.add(id);queue.push(id);}
  return [...ids];
}

export type AppearancePatch=Partial<Pick<Material,'baseColor'|'roughness'|'metalness'|'opacity'|'clearcoat'|'clearcoatRoughness'|'transmission'|'thickness'|'ior'|'specularIntensity'>>;
export type Command =
  // Manual inspector-only aggregate. Intentionally absent from the AI parser/whitelist.
  | {op:'editSelection';targetIds:string[];change:SelectionChange}
  | {op:'duplicateSelection';targetIds:string[];count:number;axis:'x'|'z';gap:number}
  | {op:'layoutSelection';targetIds:string[];layout:'ground'|'x'|'z'}
  | {op:'setSurface';targetId:string;scope?:'assembly';sourceMaterialIds?:string[];surface:import('./textures').SurfaceDetail|null}
  | {op:'setConnection';targetId:string;connection:import('./connections').Connection|null}
  | {op:'importMeshComponent'|'importComponentDraft'|'importManualComponent';nodes:SceneNode[];materials:Material[];animation?:AnimationProgram}
  | {op:'setAnimation';animation:AnimationProgram}
  | {op:'clearAnimation'}
  | {op:'transformAssembly';targetId:string;rotationDegrees?:Vec3;scaleFactor?:number;pivot?:Vec3}
  | {op:'appendAssemblyParts';targetId:string;parts:AssemblyPart[];origin?:Vec3;yaw?:number}
  | {op:'replaceAssemblyParts';blueprint?:import('./objectBlueprint').ObjectBlueprint;targetId:string;partIds:string[];parts:AssemblyPart[];origin?:Vec3;yaw?:number}
  | {op:'setPoseRig';targetId:string;rig:PoseRig}
  | {op:'setAssemblyMetadata';targetId:string;structure?:{blueprint:import('./objectBlueprint').ObjectBlueprint;binding:import('./objectBlueprint').FeatureBinding};sceneRole?:import('./types').SceneRole;planKey?:string;zone?:string}
  | ({op:'setAppearance';targetId:string;scope?:'assembly';sourceMaterialIds?:string[];materialId?:string}&AppearancePatch)
  | ({op:'createAssembly';tempId?:string}&AssemblyDefinition)
  | {op:'duplicateAssembly';targetId:string;offset:Vec3;name?:string;tempId?:string}
  | CreatePrimitiveCommand
  | CreateTemplateCommand
  | {op:'translateAssembly';targetId:string;value:Vec3}
  | InstantiateAssetCommand
  | UpdateParametersCommand
  | SetTransformCommand
  | TranslateCommand
  | RotateCommand
  | ScaleCommand
  | SetMaterialCommand
  | RenameCommand
  | SetVisibilityCommand
  | DuplicateCommand
  | ReparentCommand
  | DeleteCommand;

// AI 请求对应一个可验证事务（方案第 6 节）
export interface CommandBatch {
  requestId: string;
  projectId: string;
  baseRevision: number;
  selectedIds: string[];
  editScope?:{nodeIds?:string[];lockPlacement?:boolean;allowAssemblyAdditions?:boolean};
  taskStatus?: 'submitted' | 'partial'; // 本轮提交状态，独立于整体质量验收
  qualityIssues?: string[];
  incomplete?: boolean; // 恢复的阶段草稿，未完成提交复核
  continuation?: string; // 继续阶段时填入输入框，不自动发送
  summary: string; // 模型给出的简短说明
  operations: Command[];
}

// ============ 影响 / 成本 ============
export function affectedNodeIds(op: Command, doc: SceneDocument): string[] {
  switch (op.op) {
    case 'layoutSelection': return wholeObjectIds(doc,op.targetIds);
    case 'editSelection': return [...new Set(op.targetIds)];
    case 'duplicateSelection': return [];
    case 'setAnimation':
    case 'clearAnimation':
    case 'importManualComponent':
    case 'importComponentDraft':
    case 'importMeshComponent':
    case 'createAssembly':
    case 'duplicateAssembly':
    case 'createPrimitive':
    case 'createTemplate':
    case 'instantiateAsset':
      return [];
    case 'setSurface':
    case 'setAppearance': {
      const root=doc.nodes.find(n=>n.id===op.targetId);const candidates=op.scope==='assembly'&&root?.assemblyId?doc.nodes.filter(n=>n.assemblyId===root.assemblyId):doc.nodes.filter(n=>n.id===op.targetId);
      return candidates.filter(n=>!op.sourceMaterialIds||op.sourceMaterialIds.includes(n.materialId??'')).map(n=>n.id);
    }
    case 'transformAssembly':
    case 'appendAssemblyParts':
    case 'replaceAssemblyParts':
    case 'setAssemblyMetadata':
    case 'setPoseRig':
    case 'translateAssembly': { const assembly=doc.nodes.find(n=>n.id===op.targetId)?.assemblyId;return assembly?doc.nodes.filter(n=>n.assemblyId===assembly).map(n=>n.id):[op.targetId]; }
    case 'delete': {
      const removed=new Set(deletionNodeIds(doc,op));
      return doc.nodes.filter(n=>removed.has(n.id)||(n.connection&&removed.has(n.connection.targetId))).map(n=>n.id);
    }
    case 'duplicate': {
      const ids = new Set<string>([op.targetId]);
      // delete 影响所有后代
      let added = true;
      while (added) {
        added = false;
        for (const n of doc.nodes) {
          if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
            ids.add(n.id);
            added = true;
          }
        }
      }
      return Array.from(ids);
    }
    default:
      return [op.targetId];
  }
}

interface Budget {
  maxCommands: number;
  maxNewNodes: number;
}
const DEFAULT_BUDGET: Budget = { maxCommands: 200, maxNewNodes: 3000 }; // 方案 11 节初始预算

export function estimateCost(ops: Command[]): { commands: number; newNodes: number } {
  let newNodes = 0;
  for (const op of ops) {
    if(op.op==='importMeshComponent'||op.op==='importComponentDraft')newNodes+=op.nodes?.length??10001;
    if(op.op==='appendAssemblyParts'||op.op==='replaceAssemblyParts')newNodes+=Array.isArray(op.parts)?op.parts.reduce((n,p)=>n+(p.repeat?.count??1),0):2001;
    if(op.op==='createAssembly')newNodes+=Array.isArray(op.parts)?op.parts.reduce((n,p)=>n+(p.repeat?.count??1),0):2001;
    if(op.op==='duplicateAssembly')newNodes+=2000;
    if (op.op === 'createPrimitive' || op.op === 'instantiateAsset') newNodes += 1;
    if (op.op === 'createTemplate') newNodes += op.templateId==='smt_workshop'?2000:200; // 模板上限粗估，实际由模板构建器精确计算
    if (op.op === 'duplicate') newNodes += 8;
  }
  return { commands: ops.length, newNodes };
}

// ============ 逆操作 ============
// 历史保存已接受命令及足够的 before/after 数据（方案第 6 节）
export interface CommandWithInverse {
  command: Command;
  before: { animation?:AnimationProgram|null; nodes: SceneNode[]; materialIds: string[]; nodeIndices?:Record<string,number> }; // 受影响节点快照 + 用到的材质
  after: { nodes: SceneNode[]; materialIds: string[] };
}

// ============ 执行 ============
// 所有编辑串行提交；这里做结构/引用/参数/权限/数量/资源成本校验
export interface ExecutionResult {
  doc: SceneDocument;
  applied: CommandWithInverse[];
  errors: Error[];
}

function cloneNode(n: SceneNode): SceneNode {
  return {
    ...n,
    ...(n.modelAsset?{modelAsset:{...n.modelAsset}}:{}),
    ...(n.poseRig?{poseRig:structuredClone(n.poseRig)}:{}),
    ...(n.modelStructure?{modelStructure:structuredClone(n.modelStructure)}:{}),
    transform: {
      position: [...n.transform.position] as Vec3,
      rotationQuaternion: [...n.transform.rotationQuaternion] as Quaternion,
      scale: [...n.transform.scale] as Vec3,
    },
    geometry: n.geometry ? cloneGeometry(n.geometry) : undefined,
  };
}

// 克隆 Geometry 保持判别联合完整（直接对象字面量会把 type 推断成宽联合）
export function cloneGeometry(g: Geometry): Geometry {
  if(g.type==='sectionLoft'||g.type==='profileSweep')return structuredClone(g);
  return { type: g.type, params: { ...g.params } } as Geometry;
}

function findNode(doc: SceneDocument, id: string): SceneNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}

export function applyCommand(doc: SceneDocument, op: Command, tempIdMap: Map<string, string> = new Map()): { doc: SceneDocument; inverse?: CommandWithInverse['before']; createdIds?: string[]; error?: Error } {
  if(op.op==='layoutSelection'){
    try{const next={...doc,nodes:layoutSelectedNodes(doc,op.targetIds,op.layout),revision:doc.revision+1};const errors=validateDocument(next);if(errors.length)return {doc,error:errors[0]};const {nodeIndices:_,...inverse}=snapshotAffected(doc,op);return {doc:next,inverse};}catch(e){return {doc,error:e instanceof Error?e:new Error('排列失败；尚未修改场景')};}
  }
  if(op.op==='duplicateSelection'){
    try{const added=duplicateSelectedNodes(doc,op.targetIds,op.count,op.axis,op.gap),next={...doc,nodes:[...doc.nodes,...added],revision:doc.revision+1};const errors=validateDocument(next);if(errors.length)return {doc,error:errors[0]};return {doc:next,createdIds:added.map(n=>n.id),inverse:{nodes:[],materialIds:[]}};}catch(e){return {doc,error:e instanceof Error?e:new Error('复制失败；尚未修改场景')};}
  }
  if(op.op==='editSelection'){
    try{
      const changed=editSelectedProperties(doc,op.targetIds,op.change);
      const next={...doc,...changed,revision:doc.revision+1};
      const errors=validateDocument(next);if(errors.length)return {doc,error:new Error('属性修改校验失败：'+errors.map(e=>e.message).join('；'))};
      const {nodeIndices:_,...inverse}=snapshotAffected(doc,op);return {doc:next,inverse};
    }catch(e){return {doc,error:e instanceof Error?e:new Error('属性修改失败；尚未修改任何对象。')};}
  }
  // tempId 解析：模型在同一批次里用 tempId 引用前面创建的节点，这里换成真实 ID
  if ('targetId' in op && op.targetId && tempIdMap.has(op.targetId)) {
    op = { ...op, targetId: tempIdMap.get(op.targetId)! } as Command;
  }
  const rawParentId = 'parentId' in op ? op.parentId : null;
  if (rawParentId && tempIdMap.has(rawParentId)) {
    op = { ...op, parentId: tempIdMap.get(rawParentId)! } as Command;
  }
  // 目标存在性
  if ('targetId' in op && op.op!=='delete') {
    if (!findNode(doc, op.targetId)) {
      return { doc, error: new Error(`命令 ${op.op} 的目标节点 ${op.targetId} 不存在`) };
    }
  }
  if(op.op==='delete'){
    if(op.scope!==undefined&&op.scope!=='assembly')return {doc,error:new Error('删除范围无效')};
    if((op.targetId!==undefined)===(op.targetIds!==undefined))return {doc,error:new Error('删除需指定 targetId 或 targetIds，不能同时使用')};
    const rawIds=op.targetIds??[op.targetId];
    if(!Array.isArray(rawIds)||!rawIds.length||rawIds.some(id=>typeof id!=='string'||!id.trim()))return {doc,error:new Error('删除目标列表无效')};
    const ids=[...new Set(rawIds.map(id=>tempIdMap.get(id!)??id!))];
    const existingIds=new Set(doc.nodes.map(n=>n.id));
    if(ids.some(id=>!existingIds.has(id)))return {doc,error:new Error('删除目标已不存在，请重新选择对象')};
    op={op:'delete',targetIds:ids,...(op.scope?{scope:op.scope}:{})};
  }
  // 材质引用
  if (op.op === 'setMaterial') {
    if (!doc.materials.some((m) => m.id === op.materialId)) {
      return { doc, error: new Error(`材质 ${op.materialId} 不存在`) };
    }
  }
  // 资产引用
  if (op.op === 'instantiateAsset') {
    if (!doc.assets.some((a) => a.id === op.assetId)) {
      return { doc, error: new Error(`资产 ${op.assetId} 未托管，拒绝实例化`) };
    }
  }
  // 父引用
  const parentId = 'parentId' in op ? op.parentId : null;
  if (parentId && !findNode(doc, parentId)) {
    return { doc, error: new Error(`父节点 ${parentId} 不存在`) };
  }

  if(op.op==='createTemplate'&&op.templateId==='smt_workshop'&&doc.nodes.length)return {doc,error:new Error('完整车间组件请在空会话创建，避免覆盖或重叠；已有场景请直接修改其中设备')};
  // Append-only commands do not mutate existing nodes. Keep their identities and
  // avoid copying the whole scene for every repeated asset in a batch.
  const appendOnly = ['createPrimitive','createTemplate','createAssembly','duplicateAssembly','importComponentDraft','importManualComponent','importMeshComponent','setAnimation','clearAnimation'].includes(op.op);
  const nodes = appendOnly ? doc.nodes.slice() : doc.nodes.map(cloneNode);
  let materials=doc.materials;
  let animation=doc.animation;
  const beforeSnapshot:CommandWithInverse['before'] = {...('targetId' in op || op.op==='delete' ? snapshotAffected(doc, op) : {nodes:[],materialIds:[]}),...(['setAnimation','clearAnimation'].includes(op.op)?{animation:structuredClone(doc.animation??null)}:{})};

  let createdIds: string[] | undefined;

  switch (op.op) {
    case 'delete': {
      const removed=new Set(deletionNodeIds(doc,op));
      let kept=0;
      for(const n of nodes)if(!removed.has(n.id))nodes[kept++]=n;
      nodes.length=kept;
      for(const n of nodes)if(n.connection&&removed.has(n.connection.targetId))delete n.connection;
      // A partial delete must not erase the surviving component's only blueprint.
      for(const old of beforeSnapshot.nodes){
        const plan=old.modelStructure?.blueprint;
        if(!removed.has(old.id)||!old.assemblyId||!plan)continue;
        const members=nodes.filter(n=>n.assemblyId===old.assemblyId);
        if(members.some(n=>n.modelStructure?.blueprint?.key===plan.key))continue;
        const host=members.find(n=>n.modelStructure?.blueprintKey===plan.key)??members.find(n=>!n.modelStructure);
        if(!host)continue;
        if(!beforeSnapshot.nodes.some(n=>n.id===host.id)){
          const index=doc.nodes.findIndex(n=>n.id===host.id);
          beforeSnapshot.nodes.push(cloneNode(doc.nodes[index]));
          beforeSnapshot.nodeIndices![host.id]=index;
        }
        host.modelStructure={...(host.modelStructure??{blueprintKey:plan.key,featureKeys:[]}),blueprint:structuredClone(plan)};
      }
      if(animation){
        const tracks=animation.tracks.flatMap(track=>{
          if(track.sourceId&&removed.has(track.sourceId))return [];
          const targetIds=track.targetIds.filter(id=>!removed.has(id));
          return targetIds.length?[{...track,targetIds}]:[];
        });
        if(JSON.stringify(tracks)!==JSON.stringify(animation.tracks)){
          beforeSnapshot.animation=structuredClone(animation);
          animation=tracks.length?{...animation,tracks}:undefined;
        }
      }
      break;
    }
    case 'setSurface': {
      if(op.scope!==undefined&&op.scope!=='assembly'||op.sourceMaterialIds!==undefined&&(!Array.isArray(op.sourceMaterialIds)||!op.sourceMaterialIds.length||op.sourceMaterialIds.some(x=>typeof x!=='string')))return {doc,error:new Error('表面作用范围无效')};
      const ids=new Set(affectedNodeIds(op,doc));if(!ids.size)return {doc,error:new Error('没有匹配的表面部件')};
      for(const n of nodes)if(ids.has(n.id)){const source=materials.find(m=>m.id===n.materialId)??materials[0];if(!source)return {doc,error:new Error('表面材质不存在')};if(op.surface&&n.geometry?.type==='mesh'&&!n.geometry.params.uvs)return {doc,error:new Error('网格缺少UV，请先在建模端展开UV')};const maps=source.maps?{...source.maps}:undefined;if(maps&&op.surface){delete maps.normal;delete maps.roughness;}const candidate={...source,id:makeId(),surface:op.surface??undefined,maps};const errors=validateMaterial(candidate);if(errors.length)return {doc,error:errors[0]};const {id,...properties}=candidate;const same=materials.find(m=>{const {id,...rest}=m;return JSON.stringify(rest)===JSON.stringify(properties)});if(same)n.materialId=same.id;else{materials=[...materials,candidate];n.materialId=candidate.id;}}break;
    }
    case 'setConnection': {const n=findNodeInList(nodes,op.targetId)!;if(op.connection)n.connection=structuredClone(op.connection);else delete n.connection;break;}
    case 'setAnimation': {
      animation=structuredClone(op.animation);
      if(animation&&Array.isArray(animation.tracks))for(const track of animation.tracks){if(track&&Array.isArray(track.targetIds))track.targetIds=[...new Set(track.targetIds.map(id=>tempIdMap.get(id)??id))];if(track?.sourceId)track.sourceId=tempIdMap.get(track.sourceId)??track.sourceId;}
      const errors=validateAnimation(animation,nodes);if(!animation||errors.length)return {doc,error:errors[0]??new Error('动画配置不能为空')};
      break;
    }
    case 'clearAnimation': animation=undefined;break;
    case 'importManualComponent':
    case 'importComponentDraft':
    case 'importMeshComponent': {
      if(!Array.isArray(op.nodes)||!op.nodes.length||(op.op!=='importManualComponent'&&op.nodes.length>1000)||!Array.isArray(op.materials)||(op.op!=='importManualComponent'&&op.materials.length>100))return {doc,error:new Error('网格组件数量或材质数量无效')};
      if(op.op==='importManualComponent'){try{serializeProject({...doc,nodes:[...doc.nodes,...op.nodes],materials:[...doc.materials,...op.materials]},MANUAL_PLACEMENT_OVERFLOW);}catch(e){return {doc,error:e instanceof Error?e:new Error(MANUAL_PLACEMENT_OVERFLOW)};}}
      const imported:SceneDocument={...doc,nodes:op.nodes,materials:op.materials,assets:[],animation:op.animation};
      const errors=validateDocument(imported);if(errors.length||op.nodes.some(n=>!n.geometry||n.kind!=='primitive'||(op.op==='importMeshComponent'&&n.geometry.type!=='mesh')||n.parentId!==null))return {doc,error:errors[0]??new Error('网格组件只能包含平级三角网格')};
      const materialMap=new Map(op.materials.map(m=>[m.id,makeId()]));materials=[...materials,...op.materials.map(m=>({...m,id:materialMap.get(m.id)!}))];
      const groupMap=new Map<string,string>(),nodeMap=new Map<string,string>();for(const n of op.nodes){const old=n.assemblyId??'component';if(!groupMap.has(old))groupMap.set(old,makeId());nodeMap.set(n.id,nodeMap.size===0?groupMap.get(old)!:makeId());}const copies=op.nodes.map(n=>({...cloneNode(n),...(n.poseRig?{poseRig:remapPoseRig(n.poseRig,nodeMap)}:{}),id:nodeMap.get(n.id)!,assemblyId:groupMap.get(n.assemblyId??'component')!,materialId:materialMap.get(n.materialId!),...(n.connection?{connection:{...n.connection,targetId:nodeMap.get(n.connection.targetId)!}}:{})}));
      if(op.animation){
       beforeSnapshot.animation=structuredClone(animation??null);
       if(animation&&(animation.loop!==op.animation.loop||animation.duration!==op.animation.duration))return {doc,error:new Error('资产与场景动画的时长或循环设置不同，请先统一动画时间轴再插入')};
       const tracks=structuredClone(op.animation.tracks).map(track=>({...track,id:makeId(),targetIds:track.targetIds.map(id=>nodeMap.get(id)!),...(track.sourceId?{sourceId:nodeMap.get(track.sourceId)!}:{})}));
       animation=animation?{...animation,duration:Math.max(animation.duration,op.animation.duration),tracks:[...animation.tracks,...tracks]}:{...structuredClone(op.animation),tracks};
      }
      createdIds=copies.map(n=>n.id);nodes.push(...copies);break;
    }
    case 'createAssembly': {
      try{const parts=buildAssembly(op);createdIds=parts.map(n=>n.id);if(op.tempId)tempIdMap.set(op.tempId,parts[0].id);nodes.push(...parts);}catch(e){return {doc,error:e instanceof Error?e:new Error('组合创建失败')};}break;
    }
    case 'duplicateAssembly': {
      const anchor=findNode(doc,op.targetId)!;const members=anchor.assemblyId?doc.nodes.filter(n=>n.assemblyId===anchor.assemblyId):[anchor];
      if(members.length>2000||!Array.isArray(op.offset)||op.offset.length!==3||!op.offset.every(Number.isFinite))return {doc,error:new Error('复制数量或偏移无效')};
      const assemblyId=makeId(),instanceId=makeId();const name=op.name?.trim()||`${anchor.assemblyName??anchor.name} 副本`;const copiedIds=new Map(members.map((n,i)=>[n.id,i?makeId():assemblyId]));const copies=members.map(n=>({...cloneNode(n),...(n.modelAsset?{modelAsset:{...n.modelAsset,instanceId}}:{}),...(n.connection?{connection:{...structuredClone(n.connection),targetId:copiedIds.get(n.connection.targetId)??n.connection.targetId}}:{}),...(n.poseRig?{poseRig:remapPoseRig(n.poseRig,copiedIds)}:{}),id:copiedIds.get(n.id)!,assemblyId,assemblyName:name,name:`${name} · ${n.name.split(' · ').slice(1).join(' · ')||n.name}`,transform:{...structuredClone(n.transform),position:n.transform.position.map((v,k)=>v+op.offset[k]) as Vec3}}));
      createdIds=copies.map(n=>n.id);if(op.tempId)tempIdMap.set(op.tempId,copies[0].id);nodes.push(...copies);break;
    }
    case 'createTemplate': {
      if(op.parentId)return {doc,error:new Error('设备组件暂不支持层级父节点')};
      try { const parts=op.templateId==='smt_workshop'?buildWorkshopNodes(op.parameters,op.position,op.yaw):buildEquipment(op.templateId,op.parameters,op.position,op.yaw,op.name);createdIds=parts.map(n=>n.id);if(op.tempId)tempIdMap.set(op.tempId,parts[0].id);nodes.push(...parts); }
      catch(e){return {doc,error:e instanceof Error?e:new Error('设备参数无效')};}
      break;
    }
    case 'transformAssembly': {
      if(op.rotationDegrees===undefined&&op.scaleFactor===undefined)return {doc,error:new Error('请指定旋转角或缩放倍数')};
      const ids=new Set(affectedNodeIds(op,doc));try{const transformed=transformedAssembly(nodes.filter(n=>ids.has(n.id)),op);const byId=new Map(transformed.map(n=>[n.id,n]));for(let i=0;i<nodes.length;i++)if(byId.has(nodes[i].id))nodes[i]=byId.get(nodes[i].id)!;}catch(e){return {doc,error:e instanceof Error?e:new Error('整机变换失败')}}break;
    }
    case 'appendAssemblyParts':
    case 'replaceAssemblyParts': {
      const anchor=findNode(doc,op.targetId)!;const ids=new Set(affectedNodeIds(op,doc));const assemblyId=anchor.assemblyId??anchor.id,name=anchor.assemblyName??anchor.name;
      const removed=new Set<string>();
      if(op.op==='replaceAssemblyParts'){
        if(!Array.isArray(op.partIds)||!op.partIds.length||op.partIds.some(id=>typeof id!=='string'||!ids.has(id)))return {doc,error:new Error('替换零件必须属于目标组件')};
        for(const id of op.partIds)removed.add(id);
      }
      try{
        const parts=buildAssembly({...(op.op==='replaceAssemblyParts'?{blueprint:op.blueprint}:{}),name,parts:op.parts,position:op.origin,yaw:op.yaw,sceneRole:anchor.sceneRole,planKey:anchor.planKey,zone:anchor.zone}).map(n=>({...n,assemblyId,assemblyName:name}));
        if(ids.size-removed.size+parts.length>2000)return {doc,error:new Error('单个组件不能超过2000个零件')};
        // Keep the assembly anchor addressable when its old geometry is replaced.
        if(removed.has(assemblyId))parts[0].id=assemblyId;
        if(op.op==='replaceAssemblyParts'){
          const remapped=remapAnimationForReplacement(animation,[...removed],parts.map(n=>n.id));
          if(remapped!==animation){beforeSnapshot.animation=structuredClone(doc.animation??null);animation=remapped;}
        }
        for(let i=nodes.length-1;i>=0;i--)if(removed.has(nodes[i].id))nodes.splice(i,1);
        for(const n of nodes)if(ids.has(n.id)){n.assemblyId=assemblyId;n.assemblyName=name;}
        nodes.push(...parts);createdIds=parts.map(n=>n.id);
        if(op.op==='replaceAssemblyParts'&&op.blueprint){const plan=op.blueprint,previous=doc.nodes.find(n=>ids.has(n.id)&&n.modelStructure?.blueprint?.key===plan.key)?.modelStructure?.blueprint;const stable=new Set(plan.features.filter(f=>previous?.features.some(p=>p.key===f.key&&p.name===f.name&&p.role===f.role)).map(f=>f.key)),newIds=new Set(parts.map(n=>n.id));for(const n of nodes)if((n.assemblyId??n.id)===assemblyId&&n.modelStructure?.blueprintKey===plan.key){if(!newIds.has(n.id))n.modelStructure.featureKeys=n.modelStructure.featureKeys.filter(k=>stable.has(k));if(n.modelStructure.blueprint)n.modelStructure.blueprint=structuredClone(plan);}}
        // Ordinary replacement must not erase the only saved blueprint. New parts
        // remain explicitly unbound; never inherit the replaced feature by ID reuse.
        if(op.op==='replaceAssemblyParts'&&!op.blueprint){const originals=doc.nodes.filter(n=>ids.has(n.id)&&n.modelStructure?.blueprint),plans=new Map(originals.map(n=>[JSON.stringify(n.modelStructure!.blueprint),n.modelStructure!.blueprint!]));const members=nodes.filter(n=>(n.assemblyId??n.id)===assemblyId);if(plans.size===1&&!members.some(n=>n.modelStructure?.blueprint)){const plan=[...plans.values()][0],host=members.find(n=>n.modelStructure?.blueprintKey===plan.key)??members[0];if(host)host.modelStructure={...(host.modelStructure??{blueprintKey:plan.key,featureKeys:[]}),blueprint:structuredClone(plan)};}}
      }catch(e){return {doc,error:e instanceof Error?e:new Error('追加或替换零件失败')}}break;
    }
    case 'setPoseRig': {const ids=new Set(affectedNodeIds(op,doc));try{validatePoseRig(op.rig,nodes.filter(n=>ids.has(n.id)));for(const n of nodes)if(ids.has(n.id))delete n.poseRig;findNodeInList(nodes,op.targetId)!.poseRig=structuredClone(op.rig);}catch(e){return {doc,error:e instanceof Error?e:new Error('关节保存失败')};}break;}
    case 'setAssemblyMetadata': {
      if(op.structure){try{const member=findNode(doc,op.targetId)!;if(op.structure.binding.componentId!==(member.assemblyId??member.id))throw Error('结构关联目标与组件不一致');const updated=persistFeatureBinding(doc,op.structure.blueprint,op.structure.binding);for(let i=0;i<nodes.length;i++)nodes[i]=cloneNode(updated[i]);}catch(e){return {doc,error:e instanceof Error?e:new Error('结构关联失败')};}}
      const ids=new Set(affectedNodeIds(op,doc));for(const n of nodes)if(ids.has(n.id)){if(op.sceneRole!==undefined)n.sceneRole=op.sceneRole;if(op.planKey!==undefined)n.planKey=op.planKey;if(op.zone!==undefined)n.zone=op.zone;}break;
    }
    case 'translateAssembly': {
      const ids=new Set(affectedNodeIds(op,doc));for(const n of nodes)if(ids.has(n.id))n.transform.position=n.transform.position.map((v,i)=>v+op.value[i]) as Vec3;break;
    }
    case 'createPrimitive': {
      const id = makeId();
      if (op.tempId) tempIdMap.set(op.tempId, id);
      createdIds = [id];
      const node: SceneNode = {
        id,
        parentId: op.parentId ?? null,
        name: op.name,
        kind: 'primitive',
        geometry: op.geometry,
        materialId: op.materialId ?? defaultMaterialId(doc),
        transform: op.transform,
        visible: true,
      };
      nodes.push(node);
      break;
    }
    case 'updateParameters': {
      const n = findNodeInList(nodes, op.targetId);
      if (!n) return { doc, error: new Error(`目标不存在: ${op.targetId}`) };
      if (op.geometry) {
        if (n.kind !== 'primitive') return { doc, error: new Error(`节点 ${op.targetId} 不是基本体，不能改几何参数`) };
        n.geometry = cloneGeometry(op.geometry);
      }
      if (op.name !== undefined) n.name = op.name;
      break;
    }
    case 'setTransform': {
      const n = findNodeInList(nodes, op.targetId);
      if (!n) return { doc, error: new Error(`目标不存在: ${op.targetId}`) };
      n.transform = {
        position: [...(op.transform.position ?? n.transform.position)] as Vec3,
        rotationQuaternion: [...(op.transform.rotationQuaternion ?? n.transform.rotationQuaternion)] as Quaternion,
        scale: [...(op.transform.scale ?? n.transform.scale)] as Vec3,
      };
      break;
    }
    case 'translate': {
      const n = findNodeInList(nodes, op.targetId);
      if (!n) return { doc, error: new Error(`目标不存在: ${op.targetId}`) };
      const [x, y, z] = n.transform.position;
      const [dx, dy, dz] = op.value;
      n.transform.position = (op.mode === 'delta' ? [x + dx, y + dy, z + dz] : [dx, dy, dz]) as Vec3;
      if (op.space !== 'world') {
        // MVP 一层分组场景 local≈world；标记不精确，后续矩阵层处理
      }
      break;
    }
    case 'rename': {
      const n = findNodeInList(nodes, op.targetId);
      if (!n) return { doc, error: new Error(`目标不存在: ${op.targetId}`) };
      if (typeof op.name !== 'string' || !op.name.trim()) return { doc, error: new Error('rename 的 name 不能为空') };
      n.name = op.name;
      break;
    }
    case 'setVisibility': {
      const n = findNodeInList(nodes, op.targetId);
      if (!n) return { doc, error: new Error(`目标不存在: ${op.targetId}`) };
      n.visible = op.visible;
      break;
    }
    case 'setAppearance': {
      if(op.scope!==undefined&&op.scope!=='assembly')return {doc,error:new Error('外观修改范围无效')};
      if(op.sourceMaterialIds!==undefined&&(!Array.isArray(op.sourceMaterialIds)||!op.sourceMaterialIds.length||!op.sourceMaterialIds.every(id=>typeof id==='string')))return {doc,error:new Error('原材质筛选无效')};
      const ids=new Set(affectedNodeIds(op,doc));if(!ids.size)return {doc,error:new Error('没有匹配的选中零件')};
      if(op.materialId&&!materials.some(m=>m.id===op.materialId))return {doc,error:new Error('目标材质不存在')};
      const patch:AppearancePatch={};for(const key of ['baseColor','roughness','metalness','opacity','clearcoat','clearcoatRoughness','transmission','thickness','ior','specularIntensity'] as const)if(op[key]!==undefined)(patch as Record<string,unknown>)[key]=op[key];
      if(!op.materialId&&!Object.keys(patch).length)return {doc,error:new Error('请指定颜色或材质属性')};
      for(const n of nodes)if(ids.has(n.id)){
        const source=materials.find(m=>m.id===(op.materialId??n.materialId))??materials[0];if(!source)return {doc,error:new Error('当前材质不存在')};
        if(!Object.keys(patch).length){n.materialId=source.id;continue;}
        const candidate={...source,...patch};const errors=validateMaterial(candidate);if(errors.length)return {doc,error:new Error(errors.map(e=>e.message).join('；'))};
        const {id:ignored,...properties}=candidate;
        const existing=materials.find(m=>{const {id,...rest}=m;return JSON.stringify(rest)===JSON.stringify(properties)});
        if(existing)n.materialId=existing.id;else{const next={id:makeId(),...properties};materials=[...materials,next];n.materialId=next.id;}
      }
      break;
    }
    case 'setMaterial': {
      const n = findNodeInList(nodes, op.targetId);
      if (!n) return { doc, error: new Error(`目标不存在: ${op.targetId}`) };
      n.materialId = op.materialId;
      break;
    }
    // instantiateAsset / duplicate / reparent / scale / rotate
    // 在 commands-full 实现中补齐；P0 先跑通创建+修改主干
    default:
      return { doc, error: new Error(`命令 ${op.op} 尚未实现（P0 主干不含）`) };
  }

  // Scene size is not a node-count gate. Geometry/texture validation and the
  // per-batch work budget below remain in force regardless of existing size.
  const newDoc: SceneDocument = {
    ...doc,
    nodes,
    materials,
    revision: doc.revision + 1,
  };
  if(animation)newDoc.animation=animation;else delete newDoc.animation;
  if(op.op==='importManualComponent'){try{serializeProject(newDoc,MANUAL_PLACEMENT_OVERFLOW);}catch(e){return {doc,error:e instanceof Error?e:new Error(MANUAL_PLACEMENT_OVERFLOW)};}}
  const errs = validateDocument(newDoc);
  if (errs.length > 0) {
    return { doc, error: new Error(`提交后文档校验失败: ${errs.map((e) => e.message).join('; ')}`) };
  }
  return { doc: newDoc, inverse: beforeSnapshot, createdIds };
}

function findNodeInList(nodes: SceneNode[], id: string): SceneNode | undefined {
  return nodes.find((n) => n.id === id);
}

function defaultMaterialId(doc: SceneDocument): string | undefined {
  return doc.materials[0]?.id;
}

function snapshotAffected(doc: SceneDocument, op: Command): CommandWithInverse['before'] {
  const ids = new Set(affectedNodeIds(op, doc));
  const nodes = doc.nodes.filter((n) => ids.has(n.id)).map(cloneNode);
  const materialIds = Array.from(new Set(nodes.map((n) => n.materialId).filter((m): m is string => !!m)));
  return { nodes, materialIds, nodeIndices:Object.fromEntries(doc.nodes.flatMap((n,i)=>ids.has(n.id)?[[n.id,i]]:[])) };
}

function snapshotIds(doc: SceneDocument, ids: string[]): { nodes: SceneNode[]; materialIds: string[] } {
  const set = new Set(ids);
  const nodes = doc.nodes.filter((n) => set.has(n.id)).map(cloneNode);
  const materialIds = Array.from(new Set(nodes.map((n) => n.materialId).filter((m): m is string => !!m)));
  return { nodes, materialIds };
}

// 批量事务：任一失败整批回滚
export function applyBatch(doc: SceneDocument, batch: { operations: Command[] }): ExecutionResult {
  const applied: CommandWithInverse[] = [];
  const errors: Error[] = [];
  const cost = estimateCost(batch.operations);
  if (cost.commands > DEFAULT_BUDGET.maxCommands) {
    errors.push(new Error(`命令数 ${cost.commands} 超出预算 ${DEFAULT_BUDGET.maxCommands}`));
    return { doc, applied, errors };
  }
  let actualNewNodes=0;
  let current = doc;
  const tempIdMap = new Map<string, string>(); // 同批次内 tempId → 真实 ID
  for (const op of batch.operations) {
    const r = applyCommand(current, op, tempIdMap);
    if (r.error) {
      errors.push(new Error(`操作 ${op.op} 失败: ${r.error.message}`));
      break; // 整批拒绝，current 不写回，正式场景与撤销栈都不变化
    }
    // Explicit manual aggregate copies use the project byte budget, not the AI generation batch budget.
    if(op.op!=='duplicateSelection'&&op.op!=='importManualComponent')actualNewNodes+=r.createdIds?.length??0;
    if(actualNewNodes>DEFAULT_BUDGET.maxNewNodes){errors.push(new Error(`本批实际新增 ${actualNewNodes} 个节点超过 ${DEFAULT_BUDGET.maxNewNodes}，请分批执行；本批未应用`));break;}
    current = r.doc;
    if (r.inverse) {
      // create 类命令没有「受影响」节点：创建结果用新节点 id 快照，撤销时才删得掉
      const after = op.op==='delete'||op.op==='appendAssemblyParts'||op.op==='replaceAssemblyParts'?snapshotIds(current,[...r.inverse.nodes.map(n=>n.id),...(r.createdIds??[])]):r.createdIds && r.createdIds.length > 0 ? snapshotIds(current, r.createdIds) : snapshotAffected(current, op);
      applied.push({ command: op, before: r.inverse, after });
    }
  }
  if (errors.length > 0) {
    return { doc, applied: [], errors }; // 丢弃副本，方案第 6 节：中途失败丢弃副本
  }
  return { doc: current, applied, errors };
}

// 材质创建（供模板/默认使用）
export function ensureMaterial(doc: SceneDocument, mat: Material): SceneDocument {
  if (doc.materials.some((m) => m.id === mat.id)) return doc;
  return { ...doc, materials: [...doc.materials, mat] };
}
