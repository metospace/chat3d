import {validateCommandOperations,CommandContractError,commandContractGuide} from './commandContract';
import {sanitizeSectionLoftParams} from '../domain/sectionLoft';
import {generationStylePrompt, normalizeGenerationStyle, type GenerationStyle} from './generationStyle';
import {PHYSICAL_MATERIAL_KEYS, PHYSICAL_MATERIAL_LIMITS} from '../domain/physicalMaterial';
import {generationQualityPrompt, normalizeGenerationQuality, type GenerationQuality} from './generationPolicy';
import type {TaskBudget} from './taskBudget';
import type {EditScope} from '../domain/editScope';
import type {AnimationProgram} from '../domain/animation';
import {createBrowserProxyFetch} from './transport';
import {instructionContract,referenceReconstructionContract} from './instructionContract';
// 真实模型适配器（方案 P2，提前到本轮实现）
// OpenAI 兼容协议：POST {baseURL}/chat/completions
// - 系统提示词把 Scene DSL 讲清楚，模型输出结构化 JSON 命令批
// - 命令契约统一校验全部操作；任一不合法则整组拒绝，不静默丢弃
// - 同一批次内模型可用 tempId 引用前面创建的节点（commands.applyBatch 负责映射）
import { Geometry, Transform, SceneDocument, SCENE_ROLES, type SceneRole, validateGeometry } from '../domain/types';
import {buildAssembly,type AssemblyPart} from '../domain/assembly';
import { SCENE_ROLE_MATERIALS } from '../domain/materials';
import { Euler, Quaternion } from 'three';
import { Command } from '../domain/commands';
import { GenerationProgress, readChatResponse } from './stream';

export interface ModelConfig {
  baseURL: string; // 如 https://api.openai.com/v1
  apiKey: string;
  rememberApiKey?: boolean; // Explicit opt-in; otherwise the key stays in memory.
  model: string; // 如 gpt-4o-mini
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'; // undefined leaves the service default unchanged.
  agentMode?: 'pi' | 'single';
  generationStyle?: GenerationStyle;
  generationQuality?: GenerationQuality; // 缺省为精细；独立于模型、代理模式和预算
  taskBudget?: Partial<TaskBudget>;
  parallelDrafts?: boolean; // 实验：最多两个隔离子草稿，默认关闭
  stream?: boolean; // 默认流式；不支持 SSE 的服务可关闭
  useMock?: boolean; // 仅识别旧配置；true 时要求重新配置真实模型
}

export interface SceneContext {
  editingScope?:{mode:'all-scene'|'explicit-selection';lockPlacement:boolean};
  animation?:AnimationProgram;
  nodes: { id: string; name: string; desc: string; position: [number, number, number]; rotationQuaternion?: Transform['rotationQuaternion']; scale?: Transform['scale']; materialId?: string; visible?: boolean; parentId?: string | null }[];
  selection: string[];
  selectedAssemblies?:string[];
}

export interface GeneratedBatch {
  summary: string;
  operations: Command[];
}

// OpenAI 兼容协议的多模态消息：user 消息可由文本段 + 图片段组成
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
};


const GEOMETRY_TYPES:Record<string,true> = {sectionLoft:true,profileSweep:true,loft:true,sweepTube:true,lathe:true,profile:true,box:true,sphere:true,cylinder:true,cone:true,plane:true,roundedPlate:true,capsule:true,frame:true,tube:true,trapezoid:true};


const DEFAULT_TRANSFORM = {
  position: [0, 0, 0] as [number, number, number],
  rotationQuaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

export function buildSystemPrompt(ctx: SceneContext, generationQuality: GenerationQuality = 'fine', workflow: 'single' | 'geometry' = 'single', generationStyle: GenerationStyle = 'realistic'): string {
  const nodeLines = ctx.nodes.length
    ? ctx.nodes.map((n) => `  - id:${n.id} name:${n.name} (${n.desc}) pos:[${n.position.join(',')}] rotation:${JSON.stringify(n.rotationQuaternion)} scale:${JSON.stringify(n.scale)} material:${n.materialId} visible:${n.visible} parent:${n.parentId}`).join('\n')
    : '  （空场景，还没有任何对象）';
  const sel = ctx.selectedAssemblies?.length ? `当前高亮的完整组件 id：${ctx.selectedAssemblies.join(', ')}，包含各组件全部零件。其他高亮节点：${ctx.selection.join(', ')||'无'}。` : ctx.selection.length ? `当前高亮的节点 id：${ctx.selection.join(', ')}` : '当前没有高亮对象。';
  const prompt = `你是 Scenivo 的三维建模助手，专门搭建工业设备 / 仓储设备场景。用户用中文描述需求，你把它转换成结构化的命令批 JSON。

# 需求优先级
用户最新明确需求优先于默认展示设置、历史方案和模型假设。分批执行以满足完整需求，不因单次命令容量而擅自删减目标；仍需遵守真实安全边界与有效数据要求，不支持的能力应明确说明。

# 当前有效编辑范围
${ctx.editingScope?.mode==='explicit-selection'?'用户明确要求局部修改，请遵守本次范围约束。':'允许编辑整个场景。当前selection仅表示高亮/指代参考，不是权限限制；即使高亮地面，也可以按用户要求修改人物或其他设备。不要要求用户取消已移除的范围勾选项。用户在指令中明确要求只修改某对象时仍须遵守，目标不明确才澄清。'}

# 对话生成动态
当前动画配置：${JSON.stringify(ctx.animation??null)}
支持setAnimation和clearAnimation。setAnimation.animation是完整替换，必须保留未要求改变的已有轨道。结构：{version:1,name,duration:秒(0–3600),loop:boolean,tracks:[{id:稳定唯一名称,name,targetIds:[真实零件ID],channel,...}]}。最多128轨道、2048个绑定。移动整机时先read_scene获取组件全部零件ID，不能只动锚点。不同轨道并行，同一对象同一通道只能一条；顺序与停留通过关键帧时间表达，循环由loop控制。
position/scale轨道的keyframes=[{time:0,value:[x,y,z]},...]；position为相对原始位置的世界偏移（米），scale为原始缩放的正倍率。rotation需要axis:[x,y,z]世界轴和pivot:[x,y,z]世界旋转中心，关键帧value为相对原始姿态的角度。visibility轨道关键帧value为boolean并采用阶跃。其他通道在关键帧间线性插值，首帧必须time=0，后面时间严格递增，结束后保持末帧。停留使用相同value的不同时间帧；往返用回到初始值的末帧。
follow轨道使用sourceId、start、end，不用keyframes；跟随源对象从start到end的变换增量，开始时保持目标世界位置，结束后保持释放位置，目标自身位置轨道还可叠加运动。禁止循环绑定；不等于真实刚体抓取或碰撞。
自定义运动可以用expression替代keyframes：position/scale为三个数学AST，rotation为一个AST。叶子为数字、"t"（秒）、"pi"；节点为{op,args}，仅支持add/sub/mul/div/mod/sin/cos/abs/min/max/clamp/gt/lt/if。最大深度8/每表达式64节点；禁止JavaScript字符串、eval、网络、文件及无限循环。visibility和follow不支持表达式。例如圆周偏移用sin/cos，停留用关键帧，不能把不支持能力说成已实现。
示例：{op:"setAnimation",animation:{version:1,name:"物料输送",duration:10,loop:true,tracks:[{id:"material-move",name:"移动停留",targetIds:["真实ID"],channel:"position",keyframes:[{time:0,value:[0,0,0]},{time:3,value:[2,0,0]},{time:5,value:[2,0,0]},{time:10,value:[0,0,0]}]}]}}。
动画会先进入用户可播放预览，确认后保存；用户无需建立动作库或手工绑定。只在对象或路线不明确时澄清。已有位置锁仅锁编辑基准，不禁止被授权对象的动画运动；仅选中范围仍必须遵守。GLB导出当前只含静态几何，动画保存在项目JSON。

# 已有网格模型\n已有mesh几何来自导入的真实网格，禁止用基础体覆盖以冒充细节修改。支持复制组件、移动、旋转、缩放、显隐与材质；拓扑级修改需返回原建模软件，不要伪造已完成。可先inspect_scene检查实际边界，不要请求或输出全部顶点。\n\n# 通用细节验收标准\n所有模型都按外形与比例、功能结构、连接接触、材质表面、用途相关细节、完整性与环境关系六项构建；不局限工业或已有组件。按对象用途决定必要细节：家具支撑接合、人物解剖服装、植物枝叶关系等。简单实体不虚构机构，复杂对象不能用贴标签的箱体代替。零件数/多边形数/装饰/灯光不等于质量。单次生成没有逐项视觉证据，必须作为待细节验收草稿，不声称合格。\n\n# 建模优先级
先匹配外轮廓和长宽高比例，再匹配部件位置、真实开孔、负空间、颜色，最后补细节。零件数量不能替代准确性。
按需要拆分主体、顶板、支承、轮胎轮毂、防撞边、传感器、灯带和按钮。每次 edit_scene 最多40项，复杂任务用多次调用连续完成；利用组合与阵列压缩重复部件，不以减少结构细节代替效率。不声称完整复刻。
图像参考优先于下方通用工作台示例，不能把所有设备套成盒子。不要为了材质混搭而擅自改变参考色。

# 真实尺寸（单位：米）
- 板材、层板厚度 0.02~0.06；承重板用 0.04 以上
- 型材立柱、横梁边长 0.04~0.08
- 参考：工作台高 0.75、柜深 0.4~0.6、货架高 1.8~2.5、油桶高 0.9 口径 0.6、托盘 1.2×0.8×0.15
- 薄板件（门板、面板）厚度别超过 0.05；承重骨架别细于 0.04

# 材质库（按用途区分粗糙度与反射，以参考图颜色优先）
mat_gray 喷漆铝灰 —— 结构件、支架、桌面，万能默认
mat_blue 工业蓝漆 —— 设备主色：框架、柜门、护栏
mat_dark 深灰钢 —— 承重骨架：立柱、横梁、底座
mat_metal 亮钢 —— 裸露金属件：把手、导轨、轮毂、桶盖（强反射）
mat_white 米白面板 —— 外壳：柜体、抽屉面板、电器外壳
mat_rubber 橡胶黑 —— 轮胎、脚轮、脚垫、防撞条（哑光）
mat_red 红色 —— 急停按钮、红色轮圈
mat_cyan 浅青色 —— 青白灯带（仅表面颜色，不代表真实发光）
mat_black 黑色涂层 —— 黑色顶板、盖板
mat_yellow 警示黄 —— 警示条、护栏、路锥、托盘边沿
mat_floor 青灰哑光环氧地面；mat_wall 浅灰非金属墙面；mat_paint 浅色半哑喷漆外壳
mat_brushed 裸露拉丝金属；mat_glass 深色半透明观察窗（不要用黑板冒充玻璃）；mat_screen 深蓝操作屏
mat_fabric 深蓝哑光工作服；mat_skin 肤色；mat_light 柔和发光灯面
地面用mat_floor、墙面用mat_wall、外壳用mat_paint，避免把地面和墙都当金属。不要为装饰乱加灯光和警示色。
要点：整台设备只用一种颜色会显得假；「深骨架 + 浅面板 + 亮钢把手 + 橡胶脚垫」的组合最真实。

# 坐标系与摆放
用户自然尺寸“长×宽×总高”默认沿X×Z×Y：box参数width=长、depth=宽、height=高；总高是完整组件包围盒，不是单个零件高度。“宽×深×高”则沿X×Z×Y。明确不同方向时遵守用户约定；不确定时说明并请求确认，不得交换数值充当符合。
- Y 轴向上，单位米，原点在场景中心，地面 y=0。
- 几何体以自身中心定位：落地物体 y = 高度/2（圆柱/油桶放 y=高度一半）。
- 零件之间贴合、不互相穿插：台面正好压在骨架顶上，脚轮贴地，抽屉嵌进柜体开口。

# 参考范例（「创建一个 2 米工作台」的标准回答——注意零件数、材质混搭、重复结构要逐个列出）
{"summary":"创建工业工作台 2.0×0.8×0.75m：台面+钢框架+背板+抽屉+把手+脚垫，共 15 件","operations":[
{"op":"createPrimitive","tempId":"t1","name":"台面","geometry":{"type":"box","params":{"width":2.0,"height":0.05,"depth":0.8}},"materialId":"mat_white","transform":{"position":[0,0.725,0],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t2","name":"左前腿","geometry":{"type":"box","params":{"width":0.06,"height":0.70,"depth":0.06}},"materialId":"mat_dark","transform":{"position":[-0.90,0.35,-0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t3","name":"右前腿","geometry":{"type":"box","params":{"width":0.06,"height":0.70,"depth":0.06}},"materialId":"mat_dark","transform":{"position":[0.90,0.35,-0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t4","name":"左后腿","geometry":{"type":"box","params":{"width":0.06,"height":0.70,"depth":0.06}},"materialId":"mat_dark","transform":{"position":[-0.90,0.35,0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t5","name":"右后腿","geometry":{"type":"box","params":{"width":0.06,"height":0.70,"depth":0.06}},"materialId":"mat_dark","transform":{"position":[0.90,0.35,0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t6","name":"前横梁","geometry":{"type":"box","params":{"width":1.76,"height":0.05,"depth":0.06}},"materialId":"mat_gray","transform":{"position":[0,0.30,-0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t7","name":"后横梁","geometry":{"type":"box","params":{"width":1.76,"height":0.05,"depth":0.06}},"materialId":"mat_gray","transform":{"position":[0,0.30,0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t8","name":"背板","geometry":{"type":"box","params":{"width":2.0,"height":0.45,"depth":0.02}},"materialId":"mat_blue","transform":{"position":[0,1.00,0.39],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t9","name":"抽屉箱","geometry":{"type":"box","params":{"width":0.50,"height":0.14,"depth":0.70}},"materialId":"mat_white","transform":{"position":[-0.65,0.61,0],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t10","name":"抽屉面板","geometry":{"type":"box","params":{"width":0.46,"height":0.10,"depth":0.02}},"materialId":"mat_white","transform":{"position":[-0.65,0.61,0.36],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t11","name":"抽屉把手","geometry":{"type":"box","params":{"width":0.15,"height":0.02,"depth":0.03}},"materialId":"mat_metal","transform":{"position":[-0.65,0.61,0.38],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t12","name":"左前脚垫","geometry":{"type":"box","params":{"width":0.08,"height":0.02,"depth":0.08}},"materialId":"mat_rubber","transform":{"position":[-0.90,0.01,-0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t13","name":"右前脚垫","geometry":{"type":"box","params":{"width":0.08,"height":0.02,"depth":0.08}},"materialId":"mat_rubber","transform":{"position":[0.90,0.01,-0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t14","name":"左后脚垫","geometry":{"type":"box","params":{"width":0.08,"height":0.02,"depth":0.08}},"materialId":"mat_rubber","transform":{"position":[-0.90,0.01,0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},
{"op":"createPrimitive","tempId":"t15","name":"右后脚垫","geometry":{"type":"box","params":{"width":0.08,"height":0.02,"depth":0.08}},"materialId":"mat_rubber","transform":{"position":[0.90,0.01,0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}}
]}

# 图片
用户可能附图作为参考。先核对外轮廓、宽高比、分区高度、伸出件、负空间、关键部件位置与颜色，再输出最终命令。单图只能估算，不可声称精确还原。图像优先于任何通用配方或目录样例。
- 先按图列出可见主要部件再建模：底盘/车体、立柱或门架、货叉或载货面、滑架、灯具/急停、标牌色带等；有几根立柱就做几根，有几根货叉就做几根，禁止并成单柱玩具门架或单块平板冒充双叉。
- 比例按图：车体高度约占整机的份额、门架高出车体多少、货叉前伸长度，用相对比例约束，不要一律矮平或一律方塔。
- 矮平圆角 AGV 与带门架货叉的叉车/堆高车是不同外形：图中是哪一种就按哪一种搭，不能把叉车压成矮平台，也不能把矮 AGV 拉成高柜。
- AGV/叉车轮组轴向应与车体侧面法线一致；防撞条、橙/黄安全色带、急停蘑菇头等可见强调件要单独零件表达。
- 真正的圆形通孔用 roundedPlate.holeRadius；不要用实心圆柱或白色圆片冒充孔洞。宽大圆角车身用 roundedPlate，cornerRadius 独立于高度。
- 前面板凹槽可用外围窄条围出空腔，不能先放完整实体再把零件埋进去。
- 可读品牌字用薄板 label（短文本）；复杂贴图、真实液压软管、链条齿形、任意布尔挖槽当前无法像素级复刻，summary 必须明确未还原项。不要捏造看不见的细节。
- summary 包含「按图估算尺寸」「保留的关键特征」「仍缺少的细节」，不能只报零件数量。
- 后续消息携带的最近参考图用于连续修改，当前场景仍是事实来源，不要重复创建整车。

# 输出格式（最重要的一条，严格遵守）
如果只是回答问题或必须向用户澄清，允许 operations:[] 并把回答放入 summary，不要强行创建物体。
先想好要拆哪些零件，然后回复里只允许出现最终 JSON：第一个字符必须是 {，最后一个字符必须是 }，中间不得出现任何思考过程、草稿、英文或解释文字，不要 markdown 代码块：
{"summary":"一句话中文说明做了什么","operations":[命令按执行顺序排列]}

# 按需生成原则
严格按本次描述选择工艺、空间布局、设备类型与数量。机加工、SMT、仓储等不能互相替换，禁止自动插入现成车间或设备预设。需求不明时说明假设或澄清，不得擅自改成SMT。
应从布局、结构关系、设备细节和统一配色构建场景；完成度不足的占位模型必须明确标为未完成，不能仅靠增加零件数量宣称达标。
已存在的场景可使用 translateAssembly 移动一整个组件；它不创建新设备。
box 可指定 bevelRadius（米，0为锐边），用小倒角表达钣金，不要一律使用肥厚圆角。

# 自由组合与阵列建模
优先以 createAssembly 定义每个自设计设备/结构的部件、尺寸、材质和局部变换；没有预设几何或工艺。parts最多100条，repeat用count与step排列重复部件；单组合最多2000零件。
格式：{"op":"createAssembly","tempId":"custom1","name":"按需求命名的自设计组合","position":[0,0,0],"yaw":0,"parts":[{"name":"自定义支柱","geometry":{"type":"box","params":{"width":0.05,"height":1,"depth":0.05}},"materialId":"mat_metal","transform":{"position":[0,0.5,0]},"repeat":{"count":4,"step":[0.4,0,0]}}]}
createAssembly还可指定sceneRole（equipment/conveyor/workstation/storage/person/safety/building/floor/transport/other）、planKey（对应设计清单名称）、zone（区域名）。省略materialId时按sceneRole选择基础材质，细分玻璃、金属、肤色等仍需显式设置。每个逻辑实体单独分组，例如一名人员为一个组合，不能把全车间塞成一个组合。重复同类可复制组并保留planKey。
parts可加label短文本；仅用于尺寸足够的平面标牌/面板，使用plate/box薄片作承载，避免给曲面贴字。不写虚构品牌。
上面只演示语法，不是设备模板；必须自己根据请求设计真实结构。position/yaw放置整体，parts位置是组合局部坐标；每条默认单位缩放和无旋转。transform可用rotationDegrees:[x,y,z]表示XYZ欧拉角（度），无需手算四元数；提供rotationQuaternion时以它为准。
duplicateAssembly：{"op":"duplicateAssembly","targetId":"组件任意零件id或本批tempId","offset":[3,0,0],"name":"第二台自设计设备"} 可复制已生成组合，避免重复输出所有零件。translateAssembly只移动，duplicateAssembly才复制。整组平移的准确格式为 {"op":"translateAssembly","targetId":"组件任意真实零件ID","value":[dx,dy,dz]}；value是世界坐标增量，不是目标位置；不要使用offset、delta、position或assemblyId作为字段。
用组合/阵列表达重复结构，把输出预算用在差异化形体、负空间、连接、尺度和材质层次上，而不是降级成占位箱体。

# 已有组件的局部细化
追加部件：{"op":"appendAssemblyParts","targetId":"组件任意零件真实ID","origin":[0,0,0],"yaw":0,"parts":[自由部件定义]}。origin为世界坐标，parts为相对origin的局部坐标；不是自动相对旧组件中心。先read_scene读取设备现有世界位置，避免零件落到原点。
替换指定零件：{"op":"replaceAssemblyParts","targetId":"组件零件ID","partIds":["需替换的真实零件ID"],"origin":[0,0,0],"parts":[新部件定义]}。仅移除明确列出的原部件，其他组件与部件保留，全部可撤销。
整机旋转/等比缩放：{"op":"transformAssembly","targetId":"组件零件ID","rotationDegrees":[0,90,0],"scaleFactor":1.2}。默认以当前组件包围盒底部中心为支点；可用pivot指定世界坐标。缩放为等比，不能传三轴非等比数值；不需要的参数省略。局部编辑范围和位置锁仍会校验，不得自行扩大。

# 支持的命令
1. 创建基本体：
   {"op":"createPrimitive","tempId":"t1","name":"桌面","parentId":null,"geometry":{"type":"box","params":{"width":2,"height":0.05,"depth":0.8}},"materialId":"mat_gray","transform":{"position":[0,0.725,0],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}}
   - tempId：本批次内唯一标记，供后面命令引用。parentId 一般 null。
   - 几何类型与参数：
     capsule: radius,length。Y向胶囊体，总高length+2*radius；适合肢体/软管直段，人物头部用sphere缩放，禁止方盒头与粗方柱四肢。
     frame: width,height,depth,thickness。XY平面真实矩形开口边框，沿Z厚度；thickness<min(width,height)/2；适合观察窗框、门洞、机架开口，中心为空。玻璃放开口内，不被实心机壳遮挡。
     tube: outerRadius,innerRadius,height。沿Y中空管件，0<innerRadius<outerRadius，可用于管道/套筒/轮毂。
     trapezoid: widthTop,widthBottom,height,depth。XY梯形沿Z拉伸；上窄下宽或上宽下窄，适合斜面机罩、底座、人体躯干。组合局部旋转可改变斜面方向。
     loft: rings=[{center:[x,y,z],radiusX, radiusZ},...]，2–32个椭圆截面，Y严格递增、半径>0，segments=8–64。连续封闭放样，支持偏心和宽深独立变化，用于收腰躯干、曲面外壳、软垫、渐变形体；不要再用箱体冒充曲面。
     sectionLoft: 通用封闭连续截面放样；shape:'roundedRectangle',segments:32,sections:[{center:[0,0,0],width:1.1,depth:1.8,cornerRadius:.12},{center:[0,.25,0],width:1.15,depth:1.85,cornerRadius:.15},{center:[.03,.8,0],width:.95,depth:1.6,cornerRadius:.2},{center:[.04,1,0],width:.85,depth:1.45,cornerRadius:.18}]。2–32层水平XZ截面，center的Y严格递增且层距至少0.000001米，宽深独立收分和XZ偏移；segments为8–64的4倍数，圆角至少0.000001米且严格小于短边一半。此形状含真实直线边与圆角，不是椭圆。自定义非椭圆轮廓用shape:'polygon',sections:[{center:[0,0,0],points:[[-.5,-.4],[.5,-.4],[.35,.4],[-.5,.25]]},{center:[.03,1,0],points:[[-.4,-.3],[.4,-.3],[.25,.3],[-.4,.2]]}]，不传segments；每层3–64个局部[x,z]点，点数相同、绕序相同、索引对应、不重复首点，可凹但不能自交。层间对应导致扭转、自接触或退化会整体拒绝，不会自动重采样/降级。坐标±100米，默认封两端并提供连续法线与UV。直角轮廓用polygon；已有椭圆loft保持原API。
     profileSweep: profile=[[横向偏移,高度],...]为3–64个闭合截面轮廓点（不重复首点、暂不含孔），path=[[X,Z],...]为2–64个水平折线路径点，closed可选默认false；闭合路径至少3点且不重复首点，正偏移朝外，开放路径正偏移沿XZ平面左法线。米制坐标±100；沿路径保持连续斜接，开放端封口并带米制UV。用于导轨、收边、折角型材和连续线脚，能用现有profile/lathe完成的形体仍沿用原工具。拐角过尖、截面过宽、路径自交会拒绝，请按诊断调整，不得强行降级成盒子。
     sweepTube: points=[[x,y,z],...]为2–32个连续曲线控制点，radius为圆管半径，segments=8–128，radialSegments=8–32；沿真实路径生成连续曲线管，用于软管、线缆、弯曲扶手/枝条。两端开放，按用途加接头，不等于流体仿真。
     lathe: smooth=true可将径向控制剖面做保形三次平滑插值，适合陶瓷、圆滑壳体和有机收分；保留直线/台阶设计时不启用。points=[[半径,高度],...]为Y轴旋转剖面，2–32点，高度严格递增，半径非负；segments=8–64。用于连续旋转曲面，非均匀缩放可形成椭圆截面。默认两端不封口；实心底座必须明确capStart:true,capEnd:true，避免中心意外开洞。薄壁灯罩/漏斗用wallThickness（正且小于所有半径）生成真实内外壁与端缘，保持两端开口，不能与端盖同用。禁止用多层tube环堆成锥形罩；连续收分用一个lathe。轮廓不是自动居中。示例实心底座points:[[.14,0],[.15,.01],[.14,.035],[.02,.045]],segments:64,capStart:true,capEnd:true；薄壳points:[[.08,0],[.07,.035],[.045,.08],[.018,.11]],segments:64,wallThickness:.002。
     profile: points=[[x,y],...]为3–64点有序简单凹或凸多边形，depth沿Z对称挤出；holes可选，为最多8个内部多边形孔（每孔3–64点），孔严格位于外轮廓内且不接触、相交或嵌套。cornerRadius可选为二维轮廓圆角控制距离（非恒定半径/非厚度方向倒角），需不超过最短边或轮廓间距的24%；窄缝避免大圆角。edgeRadius可选，为厚度边缘的内收倒圆，严格小于depth一半，且edgeRadius+cornerRadius不超过上述安全间距；保持整体外边界与总厚度，不封闭内部孔。无需重复首点。用于任意连续板件、支撑剪影、建筑轮廓与贯通开口；禁止自交。圆孔用适量圆周采样点描述；不以深色贴片冒充开孔。
     roundedPlate: width,height,depth,cornerRadius,holeRadius(可选，默认0)。水平 XZ 圆角轮廓，厚度沿Y，中心圆孔沿Y贯穿。cornerRadius>0且<=短边/2；holeRadius>=0且<短边/2。
     box: width,height,depth
     cylinder: radiusTop,radiusBottom,height,radialSegments(建议 16-32)
     sphere: radius,widthSegments(建议 32),heightSegments(建议 24)
     cone: radius,height,radialSegments(建议 32)
     plane: width,depth,widthSegments,depthSegments（默认竖直。做地面/地板时用 rotationQuaternion [-0.7071,0,0,0.7071] 绕 X 轴放平，position y=0）
   - 材质从上述材质库按用途选择，按零件用途挑最合适的。
2. 修改几何参数（整体替换）：{"op":"updateParameters","targetId":"t1","geometry":{...同上...}}
3. 设置变换（绝对值；可只给 position / rotationQuaternion / scale 中需要修改的分量，其他分量保持不变）：{"op":"setTransform","targetId":"t1","transform":{"position":[...],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}}
4. 移动（delta 为增量，单位米）：{"op":"translate","targetId":"t1","space":"world","mode":"delta","value":[0.5,0,0]}
5. 重命名：{"op":"rename","targetId":"t1","name":"新名字"}
6. 显隐：{"op":"setVisibility","targetId":"t1","visible":false}
6a. 真正删除场景零件及其子节点：{"op":"delete","targetId":"t1"}；整组模型：{"op":"delete","targetId":"组件内任一真实节点ID","scope":"assembly"}；多个选中对象：{"op":"delete","targetIds":["t1","t2"]}。targetId 与 targetIds 二选一。删除会清理相关连接和动画引用，预览应用后可撤销恢复，永不删除资产库原件。用户要求删除时不要用隐藏代替；只删除明确目标，歧义时先澄清。
7. 外观局部修改：{"op":"setAppearance","targetId":"真实零件ID","baseColor":"#3979AA"}；可选roughness/metalness/opacity(0–1)、clearcoat/clearcoatRoughness/transmission(0–1)、ior(1–2.333)、thickness(0–100米)。使用transmission时opacity保持1。整机用scope:"assembly"，仅外壳可加sourceMaterialIds:["原外壳材质ID"]，先read_scene读取材质与零件，不要把玻璃、屏幕、人物一起改色。未给出的材质属性保持原值。
8. 补齐已有组件的设计关联：{"op":"setAssemblyMetadata","targetId":"组件零件ID","sceneRole":"equipment","planKey":"设计清单名称","zone":"区域名"}，不改变几何。
9. 材质：{"op":"setMaterial","targetId":"t1","materialId":"mat_metal"}

# targetId 规则
- 引用同批次里前面创建的节点：用它的 tempId（如 "t1"）。
- 引用场景里已有的节点：用真实 id（见下方场景上下文）。

# 当前版本不支持
独立 rotate/scale 命令、单零件 duplicate、分组（reparent）及模板/资产命令尚不支持。旋转和缩放请使用 setTransform；四元数必须归一化。历史对话仅用于理解意图，不要重复执行先前创建操作；以当前场景上下文为准。

# 统一命令契约
${commandContractGuide()}

# 场景上下文
${nodeLines}
${sel}

${workflow === 'single' ? generationQualityPrompt(generationQuality, 'single') + '\n' + generationStylePrompt(generationStyle) : ''}`;
  // The detailed furniture example is not the fast mode's minimum part count.
  const geometryPrompt=normalizeGenerationQuality(generationQuality) === 'fast'
    ? prompt.replace(/# 参考范例[\s\S]*?# 图片/, '# 图片')
    : prompt;
  return workflow==='single'?geometryPrompt+'\n\n'+instructionContract({single:true,selectionOnly:ctx.editingScope?.mode==='explicit-selection',lockPlacement:ctx.editingScope?.lockPlacement}):geometryPrompt;
}

export interface ConversationTurn { role: 'user' | 'assistant'; text: string }

export function buildMessages(text: string, ctx: SceneContext, images: string[] = [], history: ConversationTurn[] = [], generationQuality: GenerationQuality = 'fine', generationStyle: GenerationStyle = 'realistic'): ChatMessage[] {
  const reminder = '\n\n（请只输出一个 JSON 命令批对象，不要 markdown 代码块或任何解释文字）';
  // 有图时 user 消息走多模态数组（OpenAI 兼容协议）；无图保持纯文本（兼容所有模型）
  const userContent: string | ContentPart[] = images.length
    ? [
        { type: 'text', text: text + reminder },
        ...images.map((url): ContentPart => ({ type: 'image_url', image_url: { url } })),
      ]
    : text + reminder;
  return [
    { role: 'system', content: buildSystemPrompt(ctx, generationQuality, 'single', generationStyle)+(images.length?'\n\n'+referenceReconstructionContract():'') },
    ...history.slice(-8).map((turn): ChatMessage => ({ role: turn.role, content: turn.text.slice(0, 1500) })),
    { role: 'user', content: userContent },
  ];
}

// ============ 响应解析与清洗 ============
// 导出纯函数便于单测；模型输出不可信，全部做兜底
export function parseModelResponse(raw: string): GeneratedBatch {
  const text = (raw ?? '').trim();
  if (!text) throw new Error('模型返回为空');

  // 去掉可能的 ```json ... ``` 包裹
  let body = text;
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();

  // 优先锚定 {"summary" 开头：模型若在 JSON 前写了思考文字，第一个 { 会误锚到前面
  const start = body.indexOf('{"summary"');
  const fallbackStart = body.indexOf('{');
  const jsonStart = start >= 0 ? start : fallbackStart;
  const end = body.lastIndexOf('}');
  if (jsonStart < 0 || end <= jsonStart) throw new Error(`模型返回中找不到 JSON 对象（模型可能用纯文字作了回答，没按格式输出）。原文前 160 字：${text.slice(0, 160)}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(jsonStart, end + 1));
  } catch (e) {
    throw new Error(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}。原文前 160 字：${(body.slice(jsonStart, end + 1)).slice(0, 160)}`);
  }

  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : '模型生成的命令批';
  const operations: Command[] = [];

  if (!Array.isArray(obj.operations)) throw new Error('模型返回的 operations 不是数组');
  const contractIssues=validateCommandOperations(obj.operations);
  if(contractIssues.length)throw new CommandContractError(contractIssues);

  for(const [index,rawOp] of obj.operations.entries()){
    const op=rawOp as Record<string,unknown>,opType=String(op.op);
    const diagnostics:string[]=[];const cleaned=cleanCommand(opType,op,diagnostics);
    if(!cleaned)throw new CommandContractError([{path:['operations',index],code:'semantic',message:diagnostics.join('；')||'命令未通过几何/组合关系校验；按契约纠正当前操作，整批未执行'}]);
    operations.push(cleaned);
  }

  if (operations.length === 0 && (obj.operations.length > 0 || !obj.summary || typeof obj.summary !== 'string')) {
    throw new Error('模型没有生成任何命令');
  }
  return {summary,operations};
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toVec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const a = toNum(v[0]);
  const b = toNum(v[1]);
  const c = toNum(v[2]);
  if (a === null || b === null || c === null) return null;
  return [a, b, c];
}

function cleanGeometry(raw: unknown): Geometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const type = typeof g.type === 'string' ? g.type : '';
  if (!Object.prototype.hasOwnProperty.call(GEOMETRY_TYPES,type)) return null;
  if(type==='sectionLoft'){const params=sanitizeSectionLoftParams(g.params);return params?{type:'sectionLoft',params}:null;}
  if(type==='profileSweep'||type==='loft'||type==='sweepTube'||type==='lathe'||type==='profile'){const candidate=structuredClone(g) as unknown as Geometry;return validateGeometry(candidate).length?null:candidate;}
  const paramsRaw = (g.params ?? {}) as Record<string, unknown>;
  const params: Record<string, number> = {};
  let ok = true;
  for (const [k, v] of Object.entries(paramsRaw)) {
    const n = toNum(v);
    if (n === null) {
      ok = false;
      break;
    }
    params[k] = n;
  }
  if (!ok || Object.keys(params).length === 0) return null;
  const geometry = { type: type as Geometry['type'], params } as unknown as Geometry;
  return validateGeometry(geometry).length ? null : geometry;
}

function cleanTransform(raw: unknown): Transform {
  const t: Transform = {
    position: [...DEFAULT_TRANSFORM.position],
    rotationQuaternion: [...DEFAULT_TRANSFORM.rotationQuaternion],
    scale: [...DEFAULT_TRANSFORM.scale],
  };
  if (!raw || typeof raw !== 'object') return t;
  const r = raw as Record<string, unknown>;
  const degrees=toVec3(r.rotationDegrees);if(degrees)t.rotationQuaternion=new Quaternion().setFromEuler(new Euler(...degrees.map(v=>v*Math.PI/180) as [number,number,number],'XYZ')).toArray() as Transform['rotationQuaternion'];
  const p = toVec3(r.position);
  if (p) t.position = p;
  const s = toVec3(r.scale);
  if (s && s.every((x) => x > 0)) t.scale = s;
  if (Array.isArray(r.rotationQuaternion) && r.rotationQuaternion.length >= 4) {
    const q = r.rotationQuaternion.map(toNum);
    if (q.every((x) => x !== null)) t.rotationQuaternion = q as [number, number, number, number];
  }
  return t;
}

// 修改已有对象时只保留显式给出的分量；创建对象仍使用完整默认变换。
function cleanTransformPatch(raw: unknown): Partial<Transform> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const patch: Partial<Transform> = {};
  if ('position' in r) {
    const p = toVec3(r.position);
    if (!p || !Array.isArray(r.position) || r.position.length !== 3) return null;
    patch.position = p;
  }
  if ('scale' in r) {
    const s = toVec3(r.scale);
    if (!s || !Array.isArray(r.scale) || r.scale.length !== 3 || s.some((v) => v <= 0)) return null;
    patch.scale = s;
  }
  if ('rotationQuaternion' in r) {
    if (!Array.isArray(r.rotationQuaternion) || r.rotationQuaternion.length !== 4) return null;
    const q = r.rotationQuaternion.map(toNum);
    if (q.some((v) => v === null) || Math.hypot(...q as number[]) < 1e-8) return null;
    patch.rotationQuaternion = q as Transform['rotationQuaternion'];
  }
  return Object.keys(patch).length ? patch : null;
}

function cleanTargetId(op: Record<string, unknown>): string | null {
  const t = op.targetId;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

function cleanCommand(opType: string, op: Record<string, unknown>,diagnostics:string[]=[]): Command | null {
  switch (opType) {
    case 'createAssembly': {
      if(!Array.isArray(op.parts))return null;const position=op.position===undefined?[0,0,0] as [number,number,number]:toVec3(op.position),yaw=op.yaw===undefined?0:toNum(op.yaw);if(!position||yaw===null||typeof op.name!=='string')return null;
      const parts:AssemblyPart[]=[];for(const value of op.parts){if(!value||typeof value!=='object')return null;const p=value as Record<string,unknown>,geometry=cleanGeometry(p.geometry);if(!geometry||typeof p.name!=='string')return null;let repeat:AssemblyPart['repeat'];if(p.repeat!==undefined){const r=p.repeat as {count?:unknown;step?:unknown};if(!r||typeof r!=='object')return null;const count=toNum(r.count),step=toVec3(r.step);if(count===null||!step)return null;repeat={count,step};}if(p.label!==undefined&&(typeof p.label!=='string'||p.label.length>80))return null;parts.push({name:p.name,...(typeof p.label==='string'?{label:p.label}:{}),geometry,transform:cleanTransform(p.transform),materialId:typeof p.materialId==='string'?p.materialId:(p.materialId===undefined&&typeof op.sceneRole==='string'?SCENE_ROLE_MATERIALS[op.sceneRole as SceneRole]??'mat_gray':'mat_gray'),...(repeat?{repeat}:{})});}
      if(op.sceneRole!==undefined&&(typeof op.sceneRole!=='string'||!SCENE_ROLES.includes(op.sceneRole as SceneRole)))return null;
      const definition={name:op.name,position,yaw,parts,...(typeof op.sceneRole==='string'?{sceneRole:op.sceneRole as SceneRole}:{}),...(typeof op.planKey==='string'?{planKey:op.planKey}:{}),...(typeof op.zone==='string'?{zone:op.zone}:{} )};try{buildAssembly(definition);}catch(error){diagnostics.push(error instanceof Error?error.message:'组合参数无效');return null;}return {op:'createAssembly',...definition,tempId:typeof op.tempId==='string'?op.tempId:undefined};
    }
    case 'transformAssembly': {
      const targetId=cleanTargetId(op);if(!targetId)return null;
      const result:Extract<Command,{op:'transformAssembly'}>={op:'transformAssembly',targetId};
      for(const key of ['rotationDegrees','pivot'] as const)if(op[key]!==undefined){const value=toVec3(op[key]);if(!value)return null;result[key]=value;}
      if(op.scaleFactor!==undefined){const value=toNum(op.scaleFactor);if(value===null||value<.001||value>1000)return null;result.scaleFactor=value;}
      return result.rotationDegrees!==undefined||result.scaleFactor!==undefined?result:null;
    }
    case 'appendAssemblyParts':
    case 'replaceAssemblyParts': {
      const targetId=cleanTargetId(op);if(!targetId)return null;
      const built=cleanCommand('createAssembly',{name:'新部件',parts:op.parts,position:op.origin,yaw:op.yaw});if(!built||built.op!=='createAssembly')return null;
      built.parts=built.parts.map((p,i)=>{const raw=(op.parts as Record<string,unknown>[])[i];return {...p,materialId:typeof raw.materialId==='string'?raw.materialId:undefined};});
      if(opType==='replaceAssemblyParts'){
        if(!Array.isArray(op.partIds)||!op.partIds.length||!op.partIds.every(id=>typeof id==='string'&&id))return null;
        return {op:'replaceAssemblyParts',targetId,partIds:op.partIds,parts:built.parts,origin:built.position,yaw:built.yaw};
      }
      return {op:'appendAssemblyParts',targetId,parts:built.parts,origin:built.position,yaw:built.yaw};
    }
    case 'duplicateAssembly': {const targetId=cleanTargetId(op),offset=toVec3(op.offset);return targetId&&offset?{op:'duplicateAssembly',targetId,offset,name:typeof op.name==='string'?op.name:undefined,tempId:typeof op.tempId==='string'?op.tempId:undefined}:null;}
    case 'translateAssembly': {const targetId=cleanTargetId(op);const value=toVec3(op.value);return targetId&&value?{op:'translateAssembly',targetId,value}:null;}
    case 'createPrimitive': {
      const geometry = cleanGeometry(op.geometry);
      if (!geometry) return null;
      const name = typeof op.name === 'string' && op.name.trim() ? op.name.trim() : '未命名';
      const materialId = typeof op.materialId === 'string' ? op.materialId : 'mat_gray';
      const transform = cleanTransform(op.transform);
      const cmd: Command = {
        op: 'createPrimitive',
        name,
        parentId: null,
        geometry,
        materialId,
        transform,
      };
      if (typeof op.tempId === 'string' && op.tempId.trim()) cmd.tempId = op.tempId.trim();
      return cmd;
    }
    case 'updateParameters': {
      const targetId = cleanTargetId(op);
      if (!targetId) return null;
      const geometry = cleanGeometry(op.geometry);
      const cmd: Command = { op: 'updateParameters', targetId, geometry: geometry ?? undefined };
      if (typeof op.name === 'string' && op.name.trim()) cmd.name = op.name.trim();
      return geometry || cmd.name !== undefined ? cmd : null;
    }
    case 'setTransform': {
      const targetId = cleanTargetId(op);
      if (!targetId) return null;
      const transform = cleanTransformPatch(op.transform);
      return transform ? { op: 'setTransform', targetId, transform } : null;
    }
    case 'translate': {
      const targetId = cleanTargetId(op);
      if (!targetId) return null;
      const value = toVec3(op.value);
      if (!value) return null;
      const mode = op.mode === 'set' ? 'set' : 'delta';
      return { op: 'translate', targetId, space: op.space==='local'?'local':'world', mode, value };
    }
    case 'rename': {
      const targetId = cleanTargetId(op);
      if (!targetId) return null;
      const name = typeof op.name === 'string' && op.name.trim() ? op.name.trim() : null;
      if (!name) return null;
      return { op: 'rename', targetId, name };
    }
    case 'delete': {
      if(op.scope!==undefined&&op.scope!=='assembly')return null;
      if((op.targetId!==undefined)===(op.targetIds!==undefined))return null;
      const scope=op.scope==='assembly'?{scope:'assembly' as const}:{};
      if(op.targetIds!==undefined){
        if(!Array.isArray(op.targetIds)||!op.targetIds.length||op.targetIds.some(id=>typeof id!=='string'||!id.trim()))return null;
        return {op:'delete',targetIds:[...new Set((op.targetIds as string[]).map(id=>id.trim()))],...scope};
      }
      const targetId=cleanTargetId(op);return targetId?{op:'delete',targetId,...scope}:null;
    }
    case 'setVisibility': {
      const targetId = cleanTargetId(op);
      if (!targetId) return null;
      return { op: 'setVisibility', targetId, visible: op.visible as boolean };
    }
    case 'setAnimation': {
      if(!op.animation||typeof op.animation!=='object'||JSON.stringify(op.animation).length>300000)return null;
      const animation=structuredClone(op.animation) as AnimationProgram;
      if(Array.isArray(animation.tracks))for(const track of animation.tracks)if(track&&Array.isArray(track.targetIds))track.targetIds=[...new Set(track.targetIds)];
      return {op:'setAnimation',animation};
    }
    case 'clearAnimation': return {op:'clearAnimation'};
    case 'setAssemblyMetadata': {
      const targetId=cleanTargetId(op);if(!targetId)return null;
      if(op.sceneRole!==undefined&&(typeof op.sceneRole!=='string'||!SCENE_ROLES.includes(op.sceneRole as SceneRole)))return null;
      for(const key of ['planKey','zone'])if(op[key]!==undefined&&(typeof op[key]!=='string'||(op[key] as string).length>120))return null;
      if(op.sceneRole===undefined&&op.planKey===undefined&&op.zone===undefined)return null;
      return {op:'setAssemblyMetadata',targetId,sceneRole:op.sceneRole as SceneRole|undefined,planKey:op.planKey as string|undefined,zone:op.zone as string|undefined};
    }
    case 'setAppearance': {
      const targetId=cleanTargetId(op);if(!targetId)return null;
      const result:Extract<Command,{op:'setAppearance'}>={op:'setAppearance',targetId};
      if(op.scope!==undefined){if(op.scope!=='assembly')return null;result.scope='assembly';}
      if(op.sourceMaterialIds!==undefined){if(!Array.isArray(op.sourceMaterialIds)||!op.sourceMaterialIds.length||!op.sourceMaterialIds.every(v=>typeof v==='string'))return null;result.sourceMaterialIds=op.sourceMaterialIds;}
      if(op.baseColor!==undefined){if(typeof op.baseColor!=='string'||!/^#[0-9a-f]{6}$/i.test(op.baseColor))return null;result.baseColor=op.baseColor;}
      for(const key of ['roughness','metalness','opacity',...PHYSICAL_MATERIAL_KEYS] as const)if(op[key]!==undefined){const v=toNum(op[key]);const [min,max]=key in PHYSICAL_MATERIAL_LIMITS?PHYSICAL_MATERIAL_LIMITS[key as keyof typeof PHYSICAL_MATERIAL_LIMITS]:[0,1];if(v===null||v<min||v>max)return null;result[key]=v;}
      if(op.materialId!==undefined){if(typeof op.materialId!=='string'||!op.materialId.trim())return null;result.materialId=op.materialId;}
      return ['baseColor','roughness','metalness','opacity','materialId',...PHYSICAL_MATERIAL_KEYS].some(k=>k in result)?result:null;
    }
    case 'setMaterial': {
      const targetId = cleanTargetId(op);
      if (!targetId) return null;
      const materialId = typeof op.materialId === 'string' ? op.materialId.trim() : '';
      return { op: 'setMaterial', targetId, materialId };
    }
    default:
      return null;
  }
}

// ============ 网络请求 ============
// 浏览器统一走本站模型代理；Tauri 走原生 HTTP。失败不退回跨域直连。
let resolvedFetch: typeof fetch | null = null;
export async function getFetch(): Promise<typeof fetch> {
  if (resolvedFetch) return resolvedFetch;
  const tauriInternals = (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (tauriInternals) {
    try {
      const mod = await import('@tauri-apps/plugin-http');
      resolvedFetch = mod.fetch as unknown as typeof fetch;
      return resolvedFetch;
    } catch {
      throw new Error('桌面原生网络插件无法加载，请重新安装完整桌面客户端；不会退回浏览器直连');
    }
  }
  resolvedFetch = typeof window!=='undefined'?createBrowserProxyFetch():globalThis.fetch;
  return resolvedFetch;
}

export async function generateBatch(
  text: string,
  cfg: ModelConfig,
  ctx: SceneContext,
  signal?: AbortSignal,
  images: string[] = [],
  history: ConversationTurn[] = [],
  onProgress?: (event: GenerationProgress) => void,
): Promise<GeneratedBatch> {
  cfg = {...cfg, generationStyle: normalizeGenerationStyle(cfg.generationStyle), generationQuality: normalizeGenerationQuality(cfg.generationQuality), taskBudget: cfg.taskBudget ? {...cfg.taskBudget} : undefined};
  const base = (cfg.baseURL || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('未配置 API 地址（baseURL）');
  if (!cfg.apiKey.trim()) throw new Error('未配置 API Key');
  if (!cfg.model.trim()) throw new Error('未配置模型名');

  const url = `${base}/chat/completions`;
  const messages = buildMessages(text, ctx, images, history, cfg.generationQuality, cfg.generationStyle);

  // 解析失败自动纠偏重试一次：把模型的错误回复顶回去，再强调格式
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const report = (phase: GenerationProgress['phase'], characters = 0, streaming = cfg.stream !== false) => onProgress?.({phase, characters, streaming, attempt: attempt + 1, lastEventAt: Date.now()});
    report(attempt ? 'correcting' : 'waiting');
    const content = await fetchChat(url, cfg, messages, signal, (characters, streaming) => report('receiving', characters, streaming));
    report('validating', content.length);
    try {
      const parsed = parseModelResponse(content);
      if (parsed.operations.length) parsed.summary = `${cfg.generationQuality === 'fast' ? '快速' : '精细'}模式数据草稿（未经视觉验收）\n${parsed.summary}`;
      return parsed;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt === 0) {
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: '上一条命令批未通过统一契约，整批未执行。请一次纠正以下全部字段，不删减用户需求，也不要改用不相关构建路线。\n'+lastErr.message+'\n仅输出合法JSON命令批，不要markdown或解释。',
        });
      }
    }
  }
  throw lastErr;
}

async function fetchChat(
  url: string,
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
  update: (characters: number, streaming: boolean) => void = () => {},
): Promise<string> {
  const f = await getFetch();
  const res = await f(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: cfg.model.trim(),
      ...(cfg.reasoningEffort ? {reasoning_effort: cfg.reasoningEffort} : {}),
      messages,
      temperature: 0.2,
      max_tokens: 8192,
      stream: cfg.stream !== false,
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(describeHttpError(res.status, detail));
  }

  return readChatResponse(res, signal, update);
}

// 测试连接：只验证「能联通 + key 有效 + 模型名被服务方接受」
// 不要求模型按 DSL 格式回答（生成链路的 JSON 校验放在 chat 侧）
export async function testConnection(cfg: ModelConfig, signal?: AbortSignal): Promise<{ ok: boolean; text: string }> {
  cfg = {...cfg};
  const base = (cfg.baseURL || '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, text: '未配置 API 地址（baseURL）' };
  if (!cfg.apiKey.trim()) return { ok: false, text: '未配置 API Key' };
  if (!cfg.model.trim()) return { ok: false, text: '未配置模型名' };
  const url = `${base}/chat/completions`;
  try {
    const f = await getFetch();
    const res = await f(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: cfg.model.trim(),
        ...(cfg.reasoningEffort ? {reasoning_effort: cfg.reasoningEffort} : {}),
        messages: [{ role: 'user', content: 'ok' }],
        temperature: 0,
        stream: false,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, text: describeHttpError(res.status, detail) };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[];
    };
    const msg = data?.choices?.[0]?.message;
    let content = msg?.content;
    // 思考型模型可能把答案放在 reasoning_content
    if (!content && typeof msg?.reasoning_content === 'string' && msg.reasoning_content.trim()) {
      content = msg.reasoning_content;
    }
    if (!content || !content.trim()) return { ok: false, text: '接口返回 200，但没有消息内容' };
    return { ok: true, text: `连接成功（模型回复：${content.trim().slice(0, 60)}）` };
  } catch (e) {
    return { ok: false, text: `请求失败：${e instanceof Error ? e.message : String(e)}。请检查代理部署、API 地址和服务端网络` };
  }
}

export function describeHttpError(status: number, detail: string): string {
  if (status === 403 && /origin[ _-]*(?:is[ _-]*)?not[ _-]*allowed|cors/i.test(detail)) {
    const origin = typeof location !== 'undefined' ? location.origin : '当前网页来源';
    return `网关拒绝当前网页来源（HTTP 403 / origin not allowed）。请在网关允许的来源中添加 ${origin}。手动填写模型名不能解决这个限制。`;
  }
  if (status === 404 || status === 405) return `HTTP ${status}：地址可能不正确，或服务没有提供此接口。请核对 API 根地址；若仅 /models 不受支持，可手动填写模型名。`;
  return `HTTP ${status}：${httpHint(status) || '服务请求失败，请检查网关响应与网络状态'}`;
}

// 常见 HTTP 状态码的排查提示（面向非技术用户）
function httpHint(status: number): string {
  switch (status) {
    case 401:
      return 'API Key 无效或已过期，检查是否复制完整、带没带多余空格';
    case 403:
      return '服务方拒绝访问。常见原因：key 没有该模型权限、地域/来源被拦截（如直连境外服务无代理时会被云防护拦 403）、或账号额度不足';
    case 404:
      return '地址或模型不存在。确认 baseURL 填到 /v1 这一级，且模型名在该服务上确实存在';
    case 429:
      return '请求太频繁或额度已用完，稍后再试或更换 key';
    default:
      return '';
  }
}

// 拉取服务方支持的模型列表（OpenAI 兼容协议 GET {baseURL}/models）
// 配置对话框用它做下拉选择；服务方不支持该接口时返回空列表+原因，调用方退回手动输入
export async function fetchModels(cfg: ModelConfig, signal?: AbortSignal): Promise<{ models: string[]; error?: string }> {
  const base = (cfg.baseURL || '').trim().replace(/\/+$/, '');
  if (!base) return { models: [], error: '未配置 API 地址（baseURL）' };
  if (!cfg.apiKey.trim()) return { models: [], error: '未配置 API Key' };
  try {
    const f = await getFetch();
    const res = await f(`${base}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { models: [], error: describeHttpError(res.status, detail) };
    }
    const data = (await res.json()) as unknown;
    // 标准格式是 {data:[{id}]}；个别服务直接返回数组或 {models:[...]}
    const arr: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: unknown[] })?.data)
        ? (data as { data: unknown[] }).data
        : Array.isArray((data as { models?: unknown[] })?.models)
          ? (data as { models?: unknown[] }).models ?? []
          : [];
    const ids = arr
      .map((m) => (typeof m === 'string' ? m : (m as { id?: unknown })?.id))
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.trim());
    if (ids.length === 0) return { models: [], error: '接口返回的模型列表为空（该服务可能不支持 /models 列表）' };
    return { models: [...new Set(ids)].sort((a, b) => a.localeCompare(b)) };
  } catch (e) {
    return { models: [], error: `请求失败：${e instanceof Error ? e.message : String(e)}（请检查代理部署或服务端网络；网页不再直接跨域请求模型服务）` };
  }
}

// 构造场景上下文（ChatPanel 调用）
export function buildSceneContext(doc: Pick<SceneDocument, 'nodes'|'animation'>, selection: string[],editScope?:EditScope): SceneContext {
  return {
    editingScope:{mode:editScope?.nodeIds?'explicit-selection':'all-scene',lockPlacement:!!editScope?.lockPlacement},
    animation:doc.animation,
    nodes: doc.nodes.map((n) => {
      const g = n.geometry;
      const desc = g?.type==='sectionLoft'?`sectionLoft ${g.params.shape}，${g.params.sections.length}个连续截面；局部编辑时读取完整sections参数`:g?.type==='profileSweep'?`profileSweep ${g.params.profile.length}点截面，${g.params.path.length}点${g.params.closed?'闭合':'开放'}路径；局部编辑时再读取轮廓参数`:g?.type==='mesh'?`导入网格，${g.params.positions.length/3}顶点，${g.params.indices.length/3}三角形；可变换/改材质，不要重新输出顶点` : g
        ? `${g.type} ${Object.entries(g.params)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}`
        : 'group';
      return { id: n.id, name: n.name, desc, position: n.transform.position, rotationQuaternion: n.transform.rotationQuaternion, scale: n.transform.scale, materialId: n.materialId, visible: n.visible, parentId: n.parentId, ...(n.assemblyId?{assemblyId:n.assemblyId}:{}),...(n.sceneRole?{sceneRole:n.sceneRole}:{}),...(n.planKey?{planKey:n.planKey}:{}),...(n.zone?{zone:n.zone}:{}) };
    }),
    selection,
  };
}
