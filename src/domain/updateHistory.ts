export interface UpdateHistoryEntry {version:string;date:string;changes:readonly string[]}
/** Historical dates are version-commit times, not asserted deployment times. Newest first. */
export const UPDATE_HISTORY:readonly UpdateHistoryEntry[]=[
 {version:'0.2.42',date:'2026-11-10T08:35:31+08:00',changes:['看板库卡片默认只显示缩略图，不再为每张卡片下载完整看板；查看或接入时才加载该看板完整内容','侧栏与页面「看板接入」改名为「看板库」，并去掉顶部的可用模板/所属系统/当前场景统计栏','导出看板源码与组合大屏 HTML 时显示进度，完成后明确提示成功、失败或已取消','生成合入时，20 MiB 结构化组件预算只限制新导入的那一块，合并后的项目走 400 MiB 上限','单个新结构化组件预算从 20 MiB 放宽到 100 MiB']},
 {version:'0.2.41',date:'2026-11-10T01:03:08+08:00',changes:['新增看板接入：管理员可上传 HTML、ZIP 或文件夹模板；在场景对话输入 /看板，把当前模型嵌入大屏三维区域或叠加显示，可调整模型大小、位置、旋转和俯视角度，也可拖动编辑三维区域，并导出组合 HTML','看板按固定版本管理，支持所属系统筛选、隔离预览和源码导出；这是静态大屏与三维场景的展示组合，不是 WMS/MES 实时数据连接','大型模型本地保存改为分块写入，避免浏览器单条记录写不下导致自动保存或入库失败；进出工作台不再重建当前场景视口','保存大模型和团队发布时显示真实准备、压缩和上传进度；发布改为后台压缩并分块上传，减少主线程长时间卡住','GLB 导入不再按总顶点或单网格顶点数、三角形数截断，文件上限提高到 512 MiB；默认保留 4K/8K 原图，并保留顶点色、高亮度发光和零缩放等特殊变换','工作台备份与资产库备份总上限提高到 400 MiB']},
 {version:'0.2.40',date:'2026-11-09T17:13:40+08:00',changes:['贴图宽高上限提高到 4096，更大贴图导入时自动缩放','团队发布/资产/场景与 HTTP 体上限提高到 500 MiB','团队发布失败时显示 HTTP 状态与回包预览，便于诊断断流']},
 {version:'0.2.39',date:'2026-11-08T20:42:00+08:00',changes:['改进桌面 Blender 工作流与结果预览应用','团队发布支持分类与发布流程增强','补充相关桌面与团队测试']},
 {version:'0.2.38',date:'2026-11-06T23:30:42+08:00',changes:['团队门户资源卡片显示固定版本模型预览缩略图','恢复桌面资产拖放导入','提高本地导入与相关体积上限']},
 {version:'0.2.37',date:'2026-11-06T09:14:13+08:00',changes:['支持 Blender Python MCP 建模与结果预览应用','首页可选 Blender 建模；生成菜单统一为直接生成与 Blender 生成','修复任务诊断导出与空时间轴相关冒烟/回归断言','修复 Windows UI 冒烟全量诊断按钮命名']},
 {version:'0.2.36',date:'2026-11-05T19:03:07+08:00',changes:['修复 Codex/严格 schema 拒 TypeBox 元组与 ~kind（改写 prefixItems + 剥离内部键）','修复 GPT 拒空匹配 pattern（\\S）及 parameters 非 object']},
 {version:'0.2.35',date:'2026-11-05T16:36:11+08:00',changes:['修复 Codex 工具 schema 的 oneOf 拒收','恢复拖选中物体移动/旋转']},
 {version:'0.2.34',date:'2026-11-05T15:32:06+08:00',changes:['修复 Codex/严格 schema 拒收工具定义（去掉 uniqueItems）']},
 {version:'0.2.33',date:'2026-11-05T13:53:26+08:00',changes:['资产库草稿支持移至回收站，可从会话回收站恢复','提高本地项目/导入与团队发布的体积上限（本地项目 100 MiB，资产/GLB/团队场景 50 MiB）']},
 {version:'0.2.29',date:'2026-11-02T14:10:53+08:00',changes:['重设计项目工作台、画布与助手交互。','加强建模完成检查、缺陷保留与动画复核流程。','修复产品改版后的诊断、首页视觉及 Windows 冒烟检查。']},
 {version:'0.2.28',date:'2026-11-01T00:19:42+08:00',changes:['调整工作室界面与账户流程。','修复 Windows 检查中的登录弹窗关闭与导航。']},
 {version:'0.2.27',date:'2026-10-31T21:06:23+08:00',changes:['修复团队单点登录向桌面应用移交授权的流程。']},
 {version:'0.2.26',date:'2026-10-31T20:55:34+08:00',changes:['改进参考图建模流程，避免用不相关配方替代图中结构。','调整团队库登录界面。']},
 {version:'0.2.25',date:'2026-10-31T17:08:48+08:00',changes:['默认任务 Token 软上限提高到 200 万。','参考图任务优先观察与定制造型，不直接套用配方。']},
 {version:'0.2.24',date:'2026-10-31T16:33:54+08:00',changes:['修复团队单点登录授权确认后的页面停留问题。']},
 {version:'0.2.23',date:'2026-10-31T14:29:20+08:00',changes:['增加团队协同平台单点登录。']},
 {version:'0.2.22',date:'2026-10-30T22:08:17+08:00',changes:['同步桌面 Rust 依赖锁文件与应用版本。']},
 {version:'0.2.21',date:'2026-10-30T21:59:12+08:00',changes:['修复手动检查更新逻辑的类型构建问题。']},
 {version:'0.2.20',date:'2026-10-30T21:55:00+08:00',changes:['收敛工作台中的关于入口，减少画布操作干扰。']},
 {version:'0.2.19',date:'2026-10-30T21:52:27+08:00',changes:['应用启动后自动检查并提示可用更新。']},
 {version:'0.2.18',date:'2026-10-30T21:21:36+08:00',changes:['关于面板打开时只在面板内显示更新进度，避免重复弹窗。']},
 {version:'0.2.17',date:'2026-10-30T19:06:30+08:00',changes:['统一侧栏入口与视觉间距。']},
 {version:'0.2.16',date:'2026-10-30T10:55:05+08:00',changes:['修复导出保存对话框与临时结果反馈。']},
 {version:'0.2.15',date:'2026-10-28T17:48:38+08:00',changes:['重设计应用更新提醒和关于弹窗。']},
 {version:'0.2.14',date:'2026-10-28T17:13:54+08:00',changes:['修复关于弹窗说明文字纵向堆叠。']},
 {version:'0.2.13',date:'2026-10-28T16:38:42+08:00',changes:['改进多标签存储冲突提示、资源库详情与关于弹窗。']},
 {version:'0.2.12',date:'2026-10-28T15:17:04+08:00',changes:['优化渲染、资源加载和模型配置。','重设计创作工作区与项目导航。']},
 {version:'0.2.11',date:'2026-10-28T13:37:34+08:00',changes:['更新提醒改为居中弹窗。']},
 {version:'0.2.10',date:'2026-10-28T12:05:41+08:00',changes:['首页创作区一体化，收紧资源卡片布局。','放开参考附件类型与数量限制，保留单文件大小保护。']},
 {version:'0.2.9',date:'2026-10-28T10:29:27+08:00',changes:['重设计工作区并增加离线 HTML 模型导出。','缩减工作区持久化体积，改善存储额度错误恢复。']},
 {version:'0.2.8',date:'2026-10-27T21:18:18+08:00',changes:['桌面更新前探测下载地址，选择较快镜像线路。']},
 {version:'0.2.7',date:'2026-10-27T20:41:34+08:00',changes:['统一工作室视觉设计，修复顶栏重叠。']},
 {version:'0.2.6',date:'2026-10-27T18:33:54+08:00',changes:['版本更新；此前修复任务队列区域的无障碍标识。']},
 {version:'0.2.5',date:'2026-10-27T13:26:27+08:00',changes:['工作室界面改版。']},
 {version:'0.2.4',date:'2026-10-27T12:56:19+08:00',changes:['团队库界面改版。']},
 {version:'0.2.3',date:'2026-10-27T11:38:50+08:00',changes:['改进关于入口与一键更新体验。']},
 {version:'0.2.2',date:'2026-10-27T09:44:10+08:00',changes:['显示桌面更新下载进度条，支持配置安装包下载来源。']},
 {version:'0.2.1',date:'2026-10-26T23:33:00+08:00',changes:['产品更名为 Scenivo。']},
 {version:'0.2.0',date:'2026-10-26T22:04:47+08:00',changes:['增加浏览器及桌面可推迟更新提示。','支持持久化单团队资产与场景共享。']},
];

const updateHistoryDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatUpdateHistoryDate(date: string): string {
  const parts = Object.fromEntries(updateHistoryDateFormatter.formatToParts(new Date(date)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
