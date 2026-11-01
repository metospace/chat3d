import {validateProfileSweep,type ProfileSweepParams} from './profileSweep';
import {physicalMaterialErrors} from './physicalMaterial';
import {poseRigSchema,type PoseRig} from './poseRig';
import {validateBlueprints,type ObjectBlueprint} from './objectBlueprint';
import {validateProfile,profileCornerLimit} from './profileValidation';
import {validateTextureMaps,validateSurface,type TextureMaps,type SurfaceDetail} from './textures';
import type {Connection} from './connections';
import {validateAnimation,type AnimationProgram} from './animation';
// Scene DSL — 可编辑场景文档是唯一可信来源（方案第 4 节）
// 右手坐标系、Y 轴向上；内部长度统一为米；宽度沿 X、高度沿 Y、深度沿 Z
import { isValidId } from '../util/ids';

export const SCHEMA_VERSION = 1;

export type Unit = 'm' | 'cm' | 'mm';
export type UpAxis = 'Y'; // 固定 Y-up，暂无其他选项

// 四元数顺序固定为 x、y、z、w 并验证归一化
export type Quaternion = [number, number, number, number];
export type Vec3 = [number, number, number];

export interface Transform {
  position: Vec3;
  rotationQuaternion: Quaternion;
  scale: Vec3;
}

// 类型白名单（方案 MVP：box、sphere、cylinder、cone、plane）
export type GeometryType = 'profileSweep' | 'loft' | 'sweepTube' | 'mesh' | 'lathe' | 'profile' | 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'roundedPlate' | 'capsule' | 'frame' | 'tube' | 'trapezoid';

export interface BoxParams {
  bevelRadius?: number;
  width: number;
  height: number;
  depth: number;
}
export interface SphereParams {
  radius: number;
  widthSegments: number;
  heightSegments: number;
}
export interface CylinderParams {
  radiusTop: number;
  radiusBottom: number;
  height: number;
  radialSegments: number;
}
export interface ConeParams {
  radius: number;
  height: number;
  radialSegments: number;
}
export interface PlaneParams {
  width: number;
  depth: number;
  widthSegments: number;
  depthSegments: number;
}

export type Geometry =
  | {type:'profileSweep';params:ProfileSweepParams}
  | {type:'loft';params:{rings:{center:Vec3;radiusX:number;radiusZ:number}[];segments:number}}
  | {type:'sweepTube';params:{points:Vec3[];radius:number;segments:number;radialSegments:number}}
  | {type:'mesh';params:{positions:number[];indices:number[];normals?:number[];uvs?:number[]}}
  | {type:'lathe';params:{points:[number,number][];segments:number;smooth?:boolean;wallThickness?:number;capStart?:boolean;capEnd?:boolean}}
  | {type:'profile';params:{points:[number,number][];depth:number;holes?:[number,number][][];cornerRadius?:number;edgeRadius?:number}}
  | {type:'capsule';params:{radius:number;length:number}}
  | {type:'frame';params:{width:number;height:number;depth:number;thickness:number}}
  | {type:'tube';params:{outerRadius:number;innerRadius:number;height:number}}
  | {type:'trapezoid';params:{widthTop:number;widthBottom:number;height:number;depth:number}}
  | { type: 'roundedPlate'; params: {width:number; height:number; depth:number; cornerRadius:number; holeRadius?:number} }
  | { type: 'box'; params: BoxParams }
  | { type: 'sphere'; params: SphereParams }
  | { type: 'cylinder'; params: CylinderParams }
  | { type: 'cone'; params: ConeParams }
  | { type: 'plane'; params: PlaneParams };

// Portable PBR factors shared by the viewport, project JSON and GLB export.
export interface Material {
  maps?:TextureMaps;
  alphaTest?:number;
  transparent?:boolean;
  doubleSided?:boolean;
  surface?:SurfaceDetail;
  normalScale?:number;
  clearcoat?:number;
  clearcoatRoughness?:number;
  transmission?:number;
  thickness?:number;
  ior?:number;
  id: string;
  baseColor: string; // hex, e.g. #9099A4
  roughness: number; // [0,1]
  metalness: number; // [0,1]
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number; // [0,1]，默认 1
}

// 资产引用（导入的 GLB 等），P3 才实现导入；此处保留契约
export interface AssetRef {
  id: string;
  relativePath: string;
  sha256: string; // 64 hex chars
  mediaType: string;
  bytes: number;
  sourceName: string;
  importedAt: string; // ISO 8601
  licenseNote: string;
}

export const SCENE_ROLES=['equipment','conveyor','workstation','storage','person','safety','building','floor','transport','other'] as const;
export type SceneRole=typeof SCENE_ROLES[number];
export type SceneNodeKind = 'primitive' | 'asset' | 'group';

export interface SceneNode {
  poseRig?:PoseRig;
  modelStructure?:{blueprintKey:string;featureKeys:string[];localTransform?:Transform;blueprint?:ObjectBlueprint};
  modelAsset?:{id:string;version:number;instanceId:string;sourceNodeId?:string};
  connection?:Connection;
  id: string; // 全项目唯一且稳定；名称不承担身份
  parentId: string | null;
  assemblyName?: string;
  sceneRole?:SceneRole;
  planKey?:string;
  zone?: string;
  label?: string;
  assemblyId?: string; // Flat editable equipment assembly, no transform hierarchy
  name: string;
  kind: SceneNodeKind;
  geometry?: Geometry; // kind === 'primitive'
  assetId?: string; // kind === 'asset'
  materialId?: string; // kind === 'primitive' 或带材质覆盖
  transform: Transform; // 相对父节点
  visible: boolean;
  locked?: boolean;
}

export interface ViewState {
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  projection: 'perspective' | 'orthographic';
  displayUnit: Unit;
}

export interface SceneDocument {
  animation?:AnimationProgram;
  schemaVersion: number;
  projectId: string;
  revision: number; // 每次提交递增；撤销也生成新 revision
  unit: Unit;
  upAxis: UpAxis;
  materials: Material[];
  assets: AssetRef[];
  nodes: SceneNode[];
  viewState?: ViewState; // 视图状态独立保存，不属于建模语义
}

// ============ 校验（方案第 4 节：未知节点类型、循环层级、重复 ID、悬空引用、
// NaN、无穷值、负尺寸和超预算细分全部拒绝）============

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function validateVec3(v: Vec3, field: string): Error[] {
  const errs: Error[] = [];
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isFiniteNumber)) {
    errs.push(new Error(`${field} 必须是 3 个有限数字`));
  }
  return errs;
}

export function validateQuaternion(q: Quaternion, field: string): Error[] {
  const errs: Error[] = [];
  if (!Array.isArray(q) || q.length !== 4 || !q.every(isFiniteNumber)) {
    errs.push(new Error(`${field} 必须是 4 个有限数字 [x,y,z,w]`));
    return errs;
  }
  const norm = Math.hypot(q[0], q[1], q[2], q[3]);
  if (Math.abs(norm - 1) > 1e-3) {
    errs.push(new Error(`${field} 四元数未归一化（模长 ${norm.toFixed(6)}）`));
  }
  return errs;
}

// 几何参数校验：有限、非负、超预算细分拒绝
export function validateGeometry(g: Geometry): Error[] {
  const errs: Error[] = [];
  if(g?.type==='profileSweep')return validateProfileSweep(g.params);
  if(g?.type==='loft'){
    const p=g.params;if(!p||!Array.isArray(p.rings)||p.rings.length<2||p.rings.length>32||!Number.isInteger(p.segments)||p.segments<8||p.segments>64)return [new Error('放样需要2–32个截面及8–64环向分段')];
    if(p.rings.some((r,i)=>!r||validateVec3(r.center,'截面中心').length||r.center.some(v=>Math.abs(v)>100)||!Number.isFinite(r.radiusX)||!Number.isFinite(r.radiusZ)||r.radiusX<=0||r.radiusZ<=0||r.radiusX>100||r.radiusZ>100||i>0&&r.center[1]<=p.rings[i-1].center[1]))return [new Error('截面中心需有限米制坐标，Y严格递增，半径0–100米')];return [];
  }
  if(g?.type==='sweepTube'){
    const p=g.params;if(!p)return [new Error('sweepTube.params缺失')];const errors:Error[]=[];
    if(!Array.isArray(p.points)||p.points.length<2||p.points.length>32)errors.push(new Error('sweepTube.points需要2–32个三维控制点'));
    else for(let i=0;i<p.points.length;i++){const v=p.points[i];if(validateVec3(v,'管线控制点').length||v.some(x=>Math.abs(x)>100))errors.push(new Error('sweepTube.points['+i+']必须是范围±100米内的有限三维坐标'));else if(i>0&&Array.isArray(p.points[i-1])&&v.every((x,j)=>Math.abs(x-p.points[i-1][j])<1e-6))errors.push(new Error('sweepTube.points['+i+']与上一控制点重合'));}
    if(!Number.isFinite(p.radius)||p.radius<=0||p.radius>10)errors.push(new Error('sweepTube.radius需要大于0且不超过10米'));
    if(!Number.isInteger(p.segments)||p.segments<8||p.segments>128)errors.push(new Error('sweepTube.segments必须是8–128整数；可用32，不是tubularSegments字段'));
    if(!Number.isInteger(p.radialSegments)||p.radialSegments<8||p.radialSegments>32)errors.push(new Error('sweepTube.radialSegments必须是8–32整数；可用12'));
    return errors;
  }
  if(g?.type==='mesh'){
    const p=g.params;if(!p||!Array.isArray(p.positions)||p.positions.length<9||p.positions.length>600000||p.positions.length%3||p.positions.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>10000))return [new Error('网格坐标无效或超过20万顶点预算')];
    if(!Array.isArray(p.indices)||!p.indices.length||p.indices.length%3||p.indices.length>600000||p.indices.some(i=>!Number.isInteger(i)||i<0||i>=p.positions.length/3))return [new Error('网格三角索引无效或超过20万三角形预算')];
    if(p.uvs!==undefined&&(!Array.isArray(p.uvs)||p.uvs.length!==p.positions.length/3*2||p.uvs.some(v=>!Number.isFinite(v)||Math.abs(v)>10000)))return [new Error('网格UV坐标无效')];
    if(p.normals!==undefined&&(!Array.isArray(p.normals)||p.normals.length!==p.positions.length||p.normals.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1.001)))return [new Error('网格法线无效')];
    return [];
  }
  if(g?.type==='lathe'||g?.type==='profile'){
    const p=g.params?.points;
    if(!Array.isArray(p)||p.length<(g.type==='lathe'?2:3)||p.length>(g.type==='profile'?64:32)||p.some(v=>!Array.isArray(v)||v.length!==2||v.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>100)))return [new Error('旋转轮廓需2–32点，挤出轮廓需3–64点；有限米制二维坐标绝对值不超过100')];
    if(g.type==='lathe'){
      if(p.some(v=>v[0]<0)||!p.some(v=>v[0]>0)||p.some((v,i)=>i>0&&v[1]<=p[i-1][1])||!Number.isInteger(g.params.segments)||g.params.segments<8||g.params.segments>64)errs.push(new Error('旋转轮廓半径非负、高度严格递增，分段8–64'));
      for(const key of ['capStart','capEnd','smooth'] as const)if(g.params[key]!==undefined&&typeof g.params[key]!=='boolean')errs.push(new Error('旋转体端盖与平滑开关必须为布尔值'));
      const wall=g.params.wallThickness;if(wall!==undefined&&(!Number.isFinite(wall)||wall<=0||p.some(v=>v[0]<=wall)))errs.push(new Error('旋转壳壁厚必须为正且小于每个轮廓半径'));
      if(wall!==undefined&&(g.params.capStart||g.params.capEnd))errs.push(new Error('旋转薄壳两端保留开口并自动连接壁厚端缘，不能同时填实心端盖'));
    }else{
      if(!Number.isFinite(g.params.depth)||g.params.depth<=0||g.params.depth>100)errs.push(new Error('轮廓挤出深度需0–100米'));
      errs.push(...validateProfile(p,g.params.holes));
      const radius=g.params.cornerRadius;
      if(radius!==undefined&&(!Number.isFinite(radius)||radius<0))errs.push(new Error('轮廓圆角需为有限非负值'));
      if(!errs.length&&radius&&radius>profileCornerLimit([p,...g.params.holes??[]]))errs.push(new Error(`轮廓圆角cornerRadius=${radius}m过大；最大安全值${profileCornerLimit([p,...g.params.holes??[]]).toPrecision(6)}m，避免圆角相交`));
      const edge=g.params.edgeRadius;if(edge!==undefined&&(!Number.isFinite(edge)||edge<0||edge>=g.params.depth/2))errs.push(new Error(`厚度边缘倒圆edgeRadius需非负且严格小于depth/2=${(g.params.depth/2).toPrecision(6)}m`));
      if(!errs.length&&edge&&edge+(radius??0)>profileCornerLimit([p,...g.params.holes??[]]))errs.push(new Error(`边缘与轮廓圆角之和超过安全间距：edgeRadius+cornerRadius=${edge+(radius??0)}m，需≤${profileCornerLimit([p,...g.params.holes??[]]).toPrecision(6)}m；可能封闭窄孔或相交，请只减小超限参数或重新设计轮廓`));
    }
    return errs;
  }
  const required: Record<GeometryType, string[]> = {
    profileSweep:[],loft:[],sweepTube:[],mesh:[],lathe:[],profile:[],capsule:['radius','length'],frame:['width','height','depth','thickness'],tube:['outerRadius','innerRadius','height'],trapezoid:['widthTop','widthBottom','height','depth'],
    roundedPlate: ['width','height','depth','cornerRadius'], box: ['width', 'height', 'depth'], sphere: ['radius'],
    cylinder: ['radiusTop', 'radiusBottom', 'height'], cone: ['radius', 'height'], plane: ['width', 'depth'],
  };
  if (!g || !required[g.type] || !g.params || typeof g.params !== 'object') return [new Error('几何类型或参数结构无效')];
  const parameters = g.params as unknown as Record<string, number>;
  for (const key of required[g.type]) {
    if (!isFiniteNumber(parameters[key])) errs.push(new Error(`几何 ${g.type} 缺少有效参数 ${key}`));
    else if (parameters[key] <= 0 && key !== 'radiusTop' && key !== 'radiusBottom') errs.push(new Error(`几何参数 ${key} 必须大于 0`));
  }
  if (g.type === 'cylinder' && g.params.radiusTop === 0 && g.params.radiusBottom === 0) errs.push(new Error('圆柱上下半径不能同时为 0'));

  if(g.type==='frame' && g.params.thickness>=Math.min(g.params.width,g.params.height)/2)errs.push(new Error('边框厚度必须小于宽高的一半，保留真实开口'));
  if(g.type==='tube' && g.params.innerRadius>=g.params.outerRadius)errs.push(new Error('管内半径必须小于外半径'));
  if(g.type==='box' && g.params.bevelRadius!==undefined && g.params.bevelRadius>Math.min(g.params.width,g.params.height,g.params.depth)/2)errs.push(new Error('倒角半径不能超过最短边一半：geometry.params.bevelRadius='+g.params.bevelRadius+'；width='+g.params.width+'，height='+g.params.height+'，depth='+g.params.depth+'；允许上限='+Math.min(g.params.width,g.params.height,g.params.depth)/2+'。仅缩小bevelRadius，薄屏可设为0，勿改变设备尺寸'));
  if(g.type === 'roundedPlate') {
    const {width,depth,cornerRadius,holeRadius=0} = g.params;
    if(cornerRadius > Math.min(width,depth)/2) errs.push(new Error('圆角半径不能超过短边一半'));
    if(holeRadius >= Math.min(width,depth)/2) errs.push(new Error('开孔必须小于短边一半，不能切穿外轮廓'));
  }
  const p = g.params as unknown as Record<string, number>;
  const segLimits: Record<string, number> = {
    widthSegments: 256,
    heightSegments: 256,
    radialSegments: 256,
    depthSegments: 1024,
  };
  for (const [k, v] of Object.entries(p)) {
    if (!isFiniteNumber(v)) errs.push(new Error(`几何参数 ${k} 不是有限数字`));
    else if (v <= 0 && k !== 'radiusTop' && k !== 'radiusBottom' && k !== 'radius' && k !== 'holeRadius' && k !== 'bevelRadius') {
      // 半径允许趋近 0（锥尖），但仍需 >= 0
      errs.push(new Error(`几何参数 ${k} 必须为正数（收到 ${v}）`));
    } else if (v < 0) errs.push(new Error(`几何参数 ${k} 不能为负数（收到 ${v}）`));
    if (k in segLimits && v > segLimits[k]) {
      errs.push(new Error(`几何参数 ${k} 超出预算上限 ${segLimits[k]}（收到 ${v}）`));
    }
  }
  return errs;
}

export function validateMaterial(m: Material): Error[] {
  const errs: Error[] = [];
  if (!m || typeof m.id !== 'string' || !m.id) errs.push(new Error('材质缺少 id'));
  if (!HEX_COLOR.test(m.baseColor ?? '')) errs.push(new Error(`材质 ${m.id ?? '?'} baseColor 不是合法 hex 颜色`));
  if (!isFiniteNumber(m.roughness) || m.roughness < 0 || m.roughness > 1) errs.push(new Error(`材质 ${m.id} roughness 超出 [0,1]`));
  if (!isFiniteNumber(m.metalness) || m.metalness < 0 || m.metalness > 1) errs.push(new Error(`材质 ${m.id} metalness 超出 [0,1]`));
  if(m.emissive!==undefined&&!/^#[0-9a-f]{6}$/i.test(m.emissive))errs.push(new Error('发光颜色无效'));
  if(m.emissiveIntensity!==undefined&&(!isFiniteNumber(m.emissiveIntensity)||m.emissiveIntensity<0||m.emissiveIntensity>2))errs.push(new Error('发光强度需为0–2'));
  if(m.alphaTest!==undefined&&(!Number.isFinite(m.alphaTest)||m.alphaTest<0||m.alphaTest>1))errs.push(new Error('透明裁切阈值需为0–1'));
  if(m.transparent!==undefined&&typeof m.transparent!=='boolean'||m.doubleSided!==undefined&&typeof m.doubleSided!=='boolean')errs.push(new Error('材质透明/双面设置无效'));
  if(m.maps)errs.push(...validateTextureMaps(m.maps).map(x=>new Error(x)));
  if(m.surface&&!validateSurface(m.surface))errs.push(new Error('程序化表面参数无效'));
  if(m.normalScale!==undefined&&(!Number.isFinite(m.normalScale)||m.normalScale<0||m.normalScale>10))errs.push(new Error('法线强度需为0–10'));
  errs.push(...physicalMaterialErrors(m).map(message=>new Error(message)));
  if (m.opacity !== undefined && (!isFiniteNumber(m.opacity) || m.opacity < 0 || m.opacity > 1)) {
    errs.push(new Error(`材质 ${m.id} opacity 超出 [0,1]`));
  }
  return errs;
}

export function validateNode(node: SceneNode): Error[] {
  const errs: Error[] = [];
  if (!node || !isValidId(node.id)) {
    errs.push(new Error(`节点 id 非法：${node?.id ?? '?'}`));
  }
  for(const key of ['assemblyName','zone','label','planKey'] as const)if(node[key]!==undefined&&(typeof node[key]!=='string'||node[key]!.length>200))errs.push(new Error('场景标注或分组名称无效'));
  if(node.modelStructure){const s=node.modelStructure;if(typeof s.blueprintKey!=='string'||!s.blueprintKey.trim()||s.blueprintKey.length>80||!Array.isArray(s.featureKeys)||s.featureKeys.length>16||new Set(s.featureKeys).size!==s.featureKeys.length||s.featureKeys.some(k=>typeof k!=='string'||!k.trim()||k.length>80))errs.push(new Error('单体结构关联元数据无效'));if(s.localTransform){errs.push(...validateVec3(s.localTransform.position,'结构局部位置'),...validateVec3(s.localTransform.scale,'结构局部缩放'),...validateQuaternion(s.localTransform.rotationQuaternion,'结构局部旋转'));if(Array.isArray(s.localTransform.scale)&&s.localTransform.scale.some(n=>n<=0))errs.push(new Error('结构局部缩放必须为正'));}if(s.blueprint){try{validateBlueprints([s.blueprint]);if(s.blueprint.key!==s.blueprintKey||s.featureKeys.some(k=>!s.blueprint!.features.some(f=>f.key===k)))throw Error('结构方案引用不匹配');}catch(e){errs.push(e instanceof Error?e:new Error('结构方案无效'));}}}
  if(node.poseRig){try{poseRigSchema(node.poseRig);}catch(e){errs.push(e instanceof Error?e:new Error('关节记录无效'));}}
  if(node.modelAsset&&(!isValidId(node.modelAsset.id)||!isValidId(node.modelAsset.instanceId)||(node.modelAsset.sourceNodeId!==undefined&&!isValidId(node.modelAsset.sourceNodeId))||!Number.isSafeInteger(node.modelAsset.version)||node.modelAsset.version<1))errs.push(new Error('模型资产来源标识或版本无效'));
  if(node.connection){const c=node.connection;if(!isValidId(c.targetId)||c.targetId===node.id||validateVec3(c.sourcePoint,'连接源点').length||validateVec3(c.targetPoint,'连接目标点').length||!Number.isFinite(c.maxDistance)||c.maxDistance<=0||c.maxDistance>10||typeof c.purpose!=='string'||!c.purpose.trim()||c.purpose.length>160)errs.push(new Error('连接关系无效'));}
  if(node.sceneRole!==undefined&&!SCENE_ROLES.includes(node.sceneRole))errs.push(new Error('场景角色无效'));
  if(node.assemblyId!==undefined&&!isValidId(node.assemblyId))errs.push(new Error('设备组件标识无效'));
  if (typeof node.name !== 'string') errs.push(new Error(`节点 ${node?.id} name 不是字符串`));
  errs.push(...validateVec3(node.transform.position, `节点 ${node.id} position`));
  errs.push(...validateQuaternion(node.transform.rotationQuaternion, `节点 ${node.id} rotationQuaternion`));
  errs.push(...validateVec3(node.transform.scale, `节点 ${node.id} scale`));
  if (node.transform.scale.some((s) => s === 0)) {
    errs.push(new Error(`节点 ${node.id} scale 含 0 分量（奇异，禁止无损表示`));
  }
  if (node.kind === 'primitive') {
    if (!node.geometry) errs.push(new Error(`节点 ${node.id} 是 primitive 但缺 geometry`));
    else errs.push(...validateGeometry(node.geometry));
  }
  if (node.kind === 'asset' && !node.assetId) {
    errs.push(new Error(`节点 ${node.id} 是 asset 但缺 assetId`));
  }
  return errs;
}

// 整文档校验：重复 ID、循环层级、悬空引用（父 / 材质 / 资产）
export function validateDocument(doc: SceneDocument): Error[] {
  const errs: Error[] = [];
  if (!doc || doc.schemaVersion !== SCHEMA_VERSION) {
    errs.push(new Error(`schemaVersion 不匹配：期望 ${SCHEMA_VERSION}`));
    return errs;
  }
  if (!isFiniteNumber(doc.revision) || doc.revision < 0) errs.push(new Error('revision 非法'));
  if((doc.nodes??[]).reduce((n,x)=>n+(x.geometry?.type==='mesh'?x.geometry.params.positions.length:0),0)>1500000)errs.push(new Error('项目网格总顶点数超过50万预算'));
  if((doc.materials??[]).reduce((sum,m)=>sum+Object.values(m.maps??{}).reduce((n,t)=>n+(t?.dataUrl?.length??0),0),0)>12*1024*1024)errs.push(new Error('项目内嵌贴图总量超过12MB'));
  const nodesById = new Map((doc.nodes ?? []).map(n => [n.id, n]));
  const materialsById = new Map((doc.materials ?? []).map(m => [m.id, m]));
  const nodeIds = new Set<string>();
  const materialIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const m of doc.materials ?? []) {
    errs.push(...validateMaterial(m));
    if (materialIds.has(m.id)) errs.push(new Error(`材质 id 重复：${m.id}`));
    materialIds.add(m.id);
  }
  for (const a of doc.assets ?? []) assetIds.add(a.id);
  for (const n of doc.nodes ?? []) {
    errs.push(...validateNode(n));
    if (nodeIds.has(n.id)) errs.push(new Error(`节点 id 重复：${n.id}`));
    nodeIds.add(n.id);
    if (n.materialId && !materialIds.has(n.materialId)) {
      errs.push(new Error(`节点 ${n.id} 悬空引用材质 ${n.materialId}`));
    }
    const material=materialsById.get(n.materialId??'');if(n.geometry?.type==='mesh'&&(material?.surface||Object.keys(material?.maps??{}).length)&&!n.geometry.params.uvs)errs.push(new Error(`网格贴图缺少UV：${n.name}`));
    if (n.assetId && !assetIds.has(n.assetId)) {
      errs.push(new Error(`节点 ${n.id} 悬空引用资产 ${n.assetId}`));
    }
  }
  for(const n of doc.nodes??[])if(n.connection&&!nodeIds.has(n.connection.targetId))errs.push(new Error(`连接目标不存在，请先解除关联：${n.name}`));
  // Resolve references once and visit each parent chain once. This remains linear
  // for flat repeated scenes and deep imported hierarchies, without skipping checks.
  const checked = new Set<string>();
  for (const n of doc.nodes ?? []) {
    if (n.parentId !== null && !nodeIds.has(n.parentId)) {
      errs.push(new Error(`节点 ${n.id} 悬空引用父节点 ${n.parentId}`));
    }
    let cur: string | null = n.id;
    const path = new Set<string>();
    while (cur !== null && !checked.has(cur)) {
      if (path.has(cur)) { errs.push(new Error(`检测到循环层级（涉及节点 ${cur}）`)); break; }
      path.add(cur);
      cur = nodesById.get(cur)?.parentId ?? null;
    }
    for (const id of path) checked.add(id);
  }
  errs.push(...validateAnimation(doc.animation,doc.nodes??[]));
  return errs;
}
