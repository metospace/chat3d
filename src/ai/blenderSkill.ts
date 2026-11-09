import {generationStylePrompt} from './generationStyle';
// Domain-specific notes supplement the shared standard only when relevant.
const general = generationStylePrompt('blender')+`\n# Blender 数据与取景约定
- 颜色贴图用 sRGB，法线/粗糙度等用 Non-Color；GLB 不能携带的程序节点需要兼容烘焙或明确说明限制。
- 局部修改沿用上一份脚本，保留未涉及的几何、材质、位置和动作；新无关任务不得套用旧场景。
- 每次选择最能判断当前改动的相机角度，近景与全形证据按问题需要获取，不默认全量审计。输出文件成功不代表视觉、动作或工程验收。`;

const topics = [
 {match:/\b(?:SMT|PCB|MES|SPI|AOI)\b|贴片|回流焊|上板机|下板机|接驳台|飞达|钢网|板流|料盘/i, guide:`### SMT、输送与过站
- 按用户工艺、参考和现场方向布置，不套用固定设备顺序、型号、标高或操作侧。沿同一板流基准对齐进出料轨道中心、净宽和板面标高；用命名锚点表达入口、出口与操作侧，不拉伸整机凑齐轨道。
- 按参考区分原料板（焊盘/丝印、无已焊元件）和成品板；如有飞达，检查料带、料盘和装配朝向。扫码过站是事件，不等于连续实时定位或已接入 MES。`},
 {match:/按钮|按键|急停|指示灯|塔灯|操作面板|\b(?:push.?button|e.?stop|control panel|indicator light)\b/i, guide:`### 操作件与指示灯
- 按可见实物做底座、压圈、按压面和灯芯等层次，不用同一圆柱替代所有开关。急停的蘑菇头、防滑齿、铭牌或护罩以参考为准；看不清的标识与安全联动不编造。`},
 {match:/键盘|键帽|鼠标|手持终端|扫码枪|\b(?:keyboard|keycaps?|mouse|PDA|handheld|barcode scanner)\b/i, guide:`### 键鼠与手持终端
- 只在对象确实包含这些部件时使用：键帽有厚度、小倒角、行高和倾角，曲率轴向、间隔和键位按参考；鼠标核对掌心曲线、上下壳接缝、左右键和滚轮；手持终端核对屏框、背壳过渡及扫描窗位置，不照搬固定外形。`},
 {match:/动画|动起来|关键帧|循环|联动|升降|夹持|\b(?:animation|animate|animated|keyframes?|kinematics|articulation)\b/i, guide:`### 机构运动
- 用真实父子层级和转轴表达导轨、滑移、升降、夹持等动作；检查改动机构的关键姿态、净空和循环首尾衔接。沿轨迹的物体不瞬移、不穿壳；演示动作不能冒充实测或真实安全控制。用户明确不要动画时不创建动画。`},
] as const;

export function blenderSkillGuide(intent:string):string {
 const relevant=topics.filter(({match})=>match.test(intent));
 return relevant.length?[general,'以下专题仅用于本次确实涉及的对象，不代表新增需求。',...relevant.map(({guide})=>guide)].join('\n\n'):general;
}
