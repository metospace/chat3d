# 单体资产、验收与场景复用

## 已实现
- 工作台可独立生成或导入模型，点「保存资产」入库；也可从已有场景选中部件保存。资产详情提供「用此资产新建场景」，新场景引用所选固定版本，不改变资产原件。
- 动画资产沿用 `chat3d-model-asset` schemaVersion 1，增加可选 `animation`，保存全部所选对象相关轨道、关键帧/表达式、时长、循环与跟随绑定；旧静态资产无需迁移。资产重开恢复播放控件，拖入/插入场景重映射对象与轨道 ID，旋转/平移同步变换运动位移、轴与旋转中心。团队发布结构白名单保留动画，压缩包、服务端验证和获取副本沿用现有流程。
- 只保存部分对象时保留相关目标；跟随源必须一起保存，不能静默丢失绑定。当前场景只有一个动画时间轴，已有动画与资产的时长、循环设置不一致时明确拒绝整次插入，避免改变原有节拍；相同设置合并轨道。动画插入与撤销/重做同属一个事务，播放状态不入库。
- 位移表达式的放置偏航保存在可选轨道字段 `expressionYaw`（有限角度 -180–180 度，仅限 position 表达式）；播放时先计算原始三分量，再绕世界 Y 轴旋转位移。重复保存/放置只合成这一角度，不包装或复制 AST；原有深度 8、每分量 64 节点预算不变。关键帧仍直接旋转数值，静态资产不增加字段，本地与团队发布保留相同语义。默认 `npm test` 包含 `tests/animated-model-assets.mjs`，也可运行 `npm run test:animated-assets`。
- 用途、必要结构、绑定真实零件的操作/抓握/进料/出料/安装/支撑/自定义连接点；坐标为零件局部米制坐标，法线为单位向量。编辑连接点建立新版本。
- 从编辑项目保存下一版本时按稳定 nodeId 保留用途、必要结构和局部连接点。仅重命名或改色不丢契约；维护空间随可确定的整体坐标变换迁移。连接点零件删除/改形、维护空间的关联零件缺失或相对变换不一致时明确拒绝新版本，要求先在资产详情调整契约，不猜测无效坐标；旧版本不变。
- 单体验收保存六项结论、文字依据和多视角图片，SHA-256绑定几何、材质及用途契约。仅软件图不得通过材质；自动渲染截图不等于通过。
- 实例保留来源零件映射；检测形体、相对姿态、材质及连接改动。未经修改的实例可返回人工通过的内在质量依据，连接和场景关系仍需检查。
- 对话工具 read_saved_asset、inspect_asset_instances、align_saved_instances。自动对齐仅平移整个来源实例，拒绝改形、用途不兼容或法线不相对，不提供碰撞或握持质量保证。
- 整库备份包含连续版本及验收记录，恢复原子地创建新身份，不覆盖旧数据。导入历史结论仅参考，重新复核前不得用于通过或复用依据。

## 使用
在资产库打开详情，可编辑资产、用此资产新建场景，或打开「资产版本与备份」。详情按当前版本读取验收记录，区分待验收、有待验项、需修正和人工已复核，不沿用其他版本结论。在「用途与连接点」填写用途、必要结构及零件绑定点，保存为新版本；「单体质量验收」记录多视角和逐项依据。软件图不能验收材质，实际来源随图片保存。
对话可要求按资产用途查找固定版本、插入多个实例、检查实例是否改动、按兼容连接点平移对齐。仍需检查通路、穿插、接触和实际画面。
在场景工作台打开左侧「资产」架，把资产卡片拖到画布可见地面，看到放置预览后松开鼠标；Esc 取消。也可聚焦卡片按 Enter，再点击画布放置。Windows 桌面版使用 WebView2 的 HTML 拖放来接收画布内的资产拖动，Tauri 窗口配置变更需要重新打包客户端。
通过“备份整个资产库”下载，另一浏览器通过“导入资产 JSON / 资产库备份”恢复整个库。资产库入口直接选择 JSON 文件，选择后复用现有导入流程；「导入 GLB 为新资产」入口明确新建资产项目，不随首页「完整场景」选择改变类型。普通项目 JSON 为 400 MiB，单个资产 JSON 与团队资产/场景内容为 500 MiB；资产打开编辑及 GLB 转换结果必须满足项目 400 MiB 预算，否则在创建会话前明确拒绝。GLB 原文件上限为 512 MiB，转 JSON 后可能膨胀超限。团队场景获取保持 500 MiB 预算，工作区恢复按文档结构校验，不套用便携项目 400 MiB 限制。完整资产库和工作台备份总上限各为 400 MiB，均按实际 UTF-8 字节数且包含上限值；备份包含元数据及多个版本，不保证单项达到上限时还能装入整库备份。资产库导出与导入共用各最多 200 条历史版本、验收记录、资产信息的限制，超限导出失败，请保留原库；逐项下载不替代完整历史备份。GLB 导入和项目重开不再受总计 50 万顶点、单网格 20 万顶点 / 三角形门槛限制；保留原有网格，不自动减面。坐标、索引、法线、UV 合法性及贴图预算仍生效，实际可编辑规模受设备内存和显卡约束。JSON 仍整体解析，AI 计算预算不变。备份不包含模型服务配置或密钥；资产库备份不包含聊天。

资产库、场景库提供「打开回收站」，草稿移入后可直接进入恢复。动画播放中或暂停在非零时间时，摆放仍锁定，并提供原因与「重置后摆放」动作，避免将动画姿态写为基准。GLB / HTML 为静态导出，菜单注明不含动画；保留动画用项目 JSON、资源库或工作台备份。

内嵌 PNG/JPEG 贴图支持 4K、8K 等尺寸，不再按单边 2048 像素拒绝；导入及项目保存保留原图，不自动改写图片。单张解码像素总量仍为 64 Mi像素（67,108,864 像素，RGBA 约 256 MiB，未计 mipmap）；单张压缩图片提高到 16 MiB、GLB 原始贴图总量 128 MiB、项目材质贴图数据 192 MiB。项目预算仍按每个材质槽内的 Base64 字符串累加，同一原图多次引用会重复计入。显卡最大贴图尺寸由设备决定，不保证任意设备原分辨率显示。回归覆盖真实 4096×4096 PNG 的 GLB 导入及项目重开；浏览器另验证了原图保留、真实解码与 WebGL 红绿像素读回。

GLB 层级中非均匀缩放叠加旋转产生的剪切会烘焙进该部件的顶点，非退化变换的法线按逆转置矩阵转换并归一化；含镜像时同步翻转三角形绕序。显式节点矩阵按源数据保留，避免加载器先分解为旋转/缩放而丢失剪切或在零缩放处产生 NaN。有限的零缩放等退化变换也可导入：保留部件、顶点、三角索引、UV 与材质，烘焙后由几何重算法线并显示退化提示；压成线或点的三角形没有可见面积，不虚构厚度或恢复原始形状。不修改共享同一源网格的其他部件。烘焙后使用单位变换，不保留原层级的缩放/旋转参数，可保存项目及重新导出 GLB。非有限、非仿射矩阵、计算溢出及现有坐标范围限制仍会明确拒绝。回归覆盖正/负缩放、单轴/双轴/全轴零缩放、索引/非索引、显式矩阵、共享网格、法线及项目和 GLB 往返；全退化三角形导出时可能由 Three.js 提示零法线归一化，不代表恢复出可见表面。以上不是原始用户模型的视觉验收。

GLB 的 HDR 发光强度允许有限非负数，不再用 0–2 的编辑预算拒绝原始材质，也不静默截断亮度；支持声明为必需的 `KHR_materials_emissive_strength`。RGB/RGBA 顶点色及材质开关、`KHR_materials_specular` 的镜面强度和颜色在导入、项目、资产、团队发布、显示和再导出中保留；UV 投影重建顶点时也保留对应颜色。

2026-11-09 使用桌面真实 `SMT车间（Scenivo兼容版）(1).glb`（72,713,384 字节）验证：导入 2,320 部件、4,588,489 顶点、3,303,489 三角形，保留 56 个退化变换网格、9 个顶点色部件、39 个自定义镜面材质，最大发光强度 4.800000190734863。项目 JSON 约 238 MB，保存重开通过；实际浏览器完成导入、自动保存、资产入库及数据库读回、全部贴图解码、WebGL 显示，以及 142,566,096 字节 GLB 再导出/导入，部件和三角形数量不变。内部诊断图仅临时隐藏两块屋顶，未改源文件或入库资产；整体默认视角仍有原模型屋顶遮挡。此项证明该固定模型兼容链路，不代表任意 GLB 无损支持或大型模型流畅性承诺。

大型模型保存：复用编辑器不可变文档作为读取基线，提交前核对同一文档身份与版本；资产构建仍创建独立版本。校验不再为只读文档复制全部几何，IndexedDB 直接使用自身结构化复制，不再预先额外复制整份资产。当前工作台保存缩略图优先复用该文档已加载的视口，其他会话/文档仍使用独立检查器；截图后恢复原视角与播放状态。保存对话框展示准备、预览图、检查、写入、工作区等实际阶段及原生进度条，完成数据库事务和工作区保存后才关闭；阶段数量不是字节或耗时百分比，不按计时器伪造推进。失败保留输入，提交期间阻止重复保存和关闭，旧版本/并发冲突保护不变。

同一桌面 SMT 文件的本次浏览器测量：点击后约 255 ms 出现进度，预览图阶段约 303 ms；完整首次入库约 22.5 秒。入库读回仍有 2,320 部件、3,303,489 三角形、9 个顶点色部件、最大发光强度 4.8 及 JPEG 缩略图。主线程单次最长停顿仍约 10.1 秒，主要校验/序列化尚未移至 worker；此修改减少重复复制与预览图重建，并提供阶段反馈，不承诺全过程无卡顿。原 CPU 分段测量累计约 39.6 秒仅用于定位冗余步骤，不是同一浏览器完整保存的对照基线。

大型项目导航：工作台布局保持同一个 React/Three.js 子树，不再因首页/工作台切换变更 ProLayout pure 模式而销毁重建视口。离开画布暂停 RAF、动画推进与隐藏绘制，返回同一文档复用当前画布/相机/几何；隐藏期间的文档修改在进入时同步，不复用其他项目的预览。几何缓存按不可变对象记忆键并保留等值几何共享，不在每次移动/改色时重序列化原网格；只保留当前 GPU 场景，切换不同项目仍释放旧资源。首页不可见时取消缩略图任务，已有资产缩略图未读出前不抢先重建整模。真实 SMT 热切换两次：返回首页 122/80 ms、再进入 71/62 ms；11,200 零件场景打开 561 ms、退出 226 ms，切回 SMT 1,507 ms。是本机单次浏览器情景测量，不是任意硬件承诺或冷启动时间。

浏览器本地存储现在对工作区与资产版本使用有界结构化分块，而非把几百 MiB 文档作为单条 IndexedDB 记录；修复 Chromium 单记录约 127 MiB 限制触发的自动保存/入库失败。根清单、所有分块、版本/目录更新在同一事务提交，失败不留下半个版本或推进工作区缓存。旧整份工作区、v2 字段记录与旧资产版本继续读取；资产库升级到数据库版本 5，旧页面需关闭后升级。保持数字精度、顶点/材质、undefined 与共享引用，便携 JSON 格式及现有容量限制不变。磁盘和浏览器总配额仍可能不足，并会明确失败。

## 边界与后续
- 当前质量记录由用户明确保存；没有把AI自述或多边形数量当作高质量认证，也没有自动制造“合格”资产。
- 自动构造高质量单体、自动计算连接点及人体握持仍待独立验收。
- 平移对齐不自动旋转、路径规划或避障；支持声明预留空间并检查保守包围盒占用候选，尚无完整场景自动避障求解器。
- 已有旧版本实例缺少来源零件映射时保守要求复核；不猜测对应关系。
- 真实生成测试见 docs/benchmarks/2026-10-04-workshop-budget.json。该次预算停止正常，质量未通过，不能宣称Token成本下降。

## 通用修复队列
质量检查和逐项审查现在返回具体组件/部件的修复队列：明确失败优先局部修复，未知项补证据，软件无法判断的材质标为验证受限。遮挡先隔离单体诊断，再检查全景关系。初次失败后两个实际修改版本仍失败时建议暂停该项，不改变原始未验收结论。重复检查同一版本不计作修改尝试；硬性总时长/轮数/Token上限仍由任务预算执行，队列不承诺能识别每个建模错误或保证修复成功。

## 结构驱动生成与局部重建
新增 build_structured_component：已有通用结构方案直接约束实际造型，必需特征一次生成并绑定真实零件。漏项、引用不存在的部件或专用造型方法不匹配时，整组拒绝，场景不变。截面、旋转体、扫掠/放样和网格方法按实际几何校验；不能给箱体附加一个截面装饰就声称该特征已采用截面造型。

新增 repair_structured_features：按已绑定结构特征局部重建，保留未选零件和其他组件。共享零件必须明确所有受影响特征。结构方案、特征标识和原始局部坐标随项目节点保存，下一轮可恢复，不必重新绑定。整体刚体平移/绕Y旋转后能恢复构造坐标；部件已相对移动、整体缩放或倾斜时拒绝猜测，需明确原点与角度。

同一结构方案支持多个实际组件，不再以方案key覆盖不同实例。已有普通编辑导致造型方法不符合方案，也会在结构覆盖检查中提示。上述都是结构一致性与编辑可靠性检查，不能代替视觉语义判断，负空间、用途正确性和真实材质仍需有效证据。

## 2026-10-04 跨类型真实测试
v75 以同一空场景生成工作人员、离心泵机组与工具推车，共102个零件/3组，34轮、48次工具调用、1,242,386已报告Token，达到1,200,000预算后停止。三类均未完成视觉验收，不能认定质量或成本改善。结构工具曾因姿态缺字段和混合造型方法被拒绝，后续模型改用普通编辑；该结果的节点未携带结构持久化元数据，不能用它声称结构驱动生成端到端已通过。

本轮修正结构工具的显式姿态参数定义，以及“不创建车间”等排除语句触发整场景规划的问题。真实102节点结果纳入singleton-replay：三类各自资产序列化、两份旋转实例、单零件局部编辑、未选对象不变及变更检测。浏览器另验证推车31零件入库、90度插入和撤销。离线数据检查不代替握持、内部流道、轮架接触或PBR材质验收。

普通编辑/导入模型通过bind_object_features显式绑定后，现在将方案、真实特征关联及局部构造坐标作为可撤销元数据保存到项目。绑定不修改几何或材质；越界、外部节点和冲突方案原子拒绝。首次绑定采用当前组件底面中心的平移坐标系（轴向与世界一致）；已保存的局部坐标不会因再次绑定而被静默重置。辅助零件可以保留局部坐标而没有特征声明，不被算作必需结构覆盖。仅元数据变化时保留已有相同画面证据，未知结论仍不通过。三类真实生成固定数据已覆盖绑定、项目往返及坐标恢复；这是数据回放，尚非新的真实模型调用质量对比。

## 局部替换与查询开销修正
普通replaceAssemblyParts替换承载方案的首个零件时，会把仍适用的原结构方案保留在同组件中；新零件保持未关联，不因沿用锚点ID而自动继承旧零件的结构合格状态。全部零件替换后仅保留待重新关联的方案。每次编辑后从实际持久化元数据刷新当前关联；缺失结构继续显示待关联。宿主迁移在同一批原子操作内，支持撤销重做，不影响其他组件。

read_scene指定nodeIds时只返回所请求节点使用的材质，保留节点全部原有字段与编辑范围。find_scene_parts对大小写、空白、关键词重复/顺序和默认分页参数规范化，使等价查询复用同一版本结果，不把字段不同的查询合并。固定102节点真实数据中单节点查询响应从5244字符降到768字符（材质50项降到1项）；这只是该工具响应的字符数，不是Token或总任务成本降幅，未新增付费模型验证。

## 单体自身取景与声明尺寸
capture_component_intrinsic使用整个组件的全部零件，隔离其他组件而不改模型，供外形、功能结构和用途细节核对。该证据不能通过连接/接触或场景关系，软件图仍不能通过材质；全景与人物手部关系要求保留。局部任意选件的diagnostic图仍不能作为通过证据。当前服务端渲染器不支持保留全场景的目标取景时明确回退，禁止悄悄隐藏外部遮挡后把图片标为上下文验收。

结构方案可声明明确要求的局部轴向尺寸dimensions（x/y/z，米，只填已知轴）。build_structured_component按真实整体几何范围校验，容差2%或2mm；repair_structured_features校验修后完整组件范围，超出声明则整批拒绝。根级摆放旋转不改变局部尺寸判定。该约束验证声明与实际几何一致，不能证明声明本身准确或取代比例、轮廓及语义视觉判断。

固定三类真实模型CPU侧视回放：人员可见目标像素2425→4332，泵6502→9136，推车7984→7984；单体全部零件数保持30/41/31不变。该数据说明隔离取景减少外部遮挡，不代表生成形体改善、材质通过或整体质量达标。未新增模型调用。

## 固定椅子/台灯实测驱动的改进
v79固定空场景、gpt-6.1-sol、10分钟/20轮/600000已报告Token预算，20轮20工具537892Token到轮数上限，生成17节点；质量未完成验收，不作为高质量或效率改善基准结论。

此次复现并修复：profile方案可接受实际同为轮廓挤出的roundedPlate，仍拒绝box冒充；轮廓/边缘圆角失败给出数值安全界限；retry_structured_component只补失败参数最多8处、2次，场景/任务/方案变化立即失效且不允许改目标身份，仍原子校验。结构方案更新保留key/名称/用途角色稳定的真实关联，新增或改变身份需重绑定；局部修复同步持久化方案并清除失效关联。

补充bottom垂直仰视和underside斜下仰视，覆盖下向开口与底部结构。真实灯泡固定数据：正面及垂直仰视受灯罩/底座遮挡，可见目标像素0；斜下仰视1992（160×120目标近景）。模型几何未变化，只增加正确取景。软件图仍不能用于材质验收，隔离图仍不能证明场景连接关系。

固定需求候选v80复测：17轮17工具441498已报告Token，主动提交16节点未验收预览；两个单体首次结构生成成功。基线v79为20轮20工具537892Token、17节点、轮数预算停止。UI已完成事件累计时间分别388.9秒与328.5秒（显示四舍五入）；不是精确计费/墙钟测量。相同prompt、空场景、模型、预算，均不使用已保存资产；但仅一次对照且均未完成材质/细微接触验收，不得宣称同质量总体性能改善。

候选还复现了证据分类问题：已有当前版本两个完整场景视角，更新环境关系仍受旧的隔离图限制。已将contextEvidence独立记录，仅当前完整全景多视角可支持环境关系；它不能代替细微接触近景、不能让软件材质通过。此修复通过回归验证，未另跑付费生成。

## Customer workflow update (v82)

- Composer always shows a whole-scene / selected-only boundary. Selected-only is validated before sending, fails closed for an empty/stale selection, and reuses the atomic scope guard. A language request cannot widen that UI boundary. Whole-scene still respects explicit local language constraints.
- Preview actions use Apply / Continue editing / Discard. Submission or interruption and overall quality are displayed separately. Applying does not enqueue another model request or prefill a continuation; unknown quality is never marked passed.
- Asset browsing and saving have separate surfaces. Insertion is above optional placement controls. Updating a version requires an explicit target and acknowledgement, reset when the source changes; known instances from a different asset are rejected. Existing immutable versions stay intact.
- Inspector is an in-layout pane (stacked on small screens). Export format guidance is visible before download; empty-state entry points include single model, composed scene and asset library. Appearance scopes show representative part names and warn before recoloring all selected parts.
- Verification includes UI lifecycle, undo, scoped mutation rejection, empty/stale selections, asset version target and confirmation reset tests. The supervised visual preview runtime was unavailable in this execution environment, so the new layout has not had a live browser visual acceptance pass. No live paid modeling run was used to claim a quality improvement.

## Follow-up customer verification (v83)

The environment is portable (`SITES_MANAGED_LINUX_CONTAINER` unset); the earlier managed-preview assumption was incorrect. The published v82 page was exercised directly in the cloud browser. Empty selected-only submission was rejected with the draft preserved; inspector and software geometry image were visibly side by side; selected-only movement produced a preview, Apply did not prefill a follow-up, and Undo worked. This was a four-round, four-tool, 72,651-reported-Token live test, not a performance comparison. WebGL remains unavailable in that browser.

The live asset workflow revealed that updating an independent copy was over-blocked. Version source validation now accepts the actual editor nodes retained in that copy, while still rejecting unrelated foreign instances. The target is loaded and checked before enabling confirmation, and version saves preserve its name/category/front. Current-task text also reports applied/discarded state rather than repeating historical model prose asking for confirmation. Existing quality restrictions remain unchanged.

## v84: 可复核的局部几何检查

- WebGL 不可用时，软件检查支持全场景、选中近景（保留周边）、仅显示选中零件三种范围。后者明确标记不能据此验收外部连接或间距，所有软件图仍不能验收真实材质。
- 选中近景沿用同一软件渲染器的目标取景，保留周边遮挡；新增左侧视角。改变选择、文档、范围或视角会取消旧绘制并清空旧图，不把旧图当新状态。
- 三维未就绪时禁用不能工作的聚焦/视角/网格等三维按钮，并提示通过对象列表选择零件；属性面板的世界外包尺寸明确 X/Y/Z，显示到毫米，并显示底部 Y。
- 这是一轮检查能力和交互修复，不代表生成模型的六项质量已经通过。实时旋转、拾取、PBR 材质需要可用 WebGL 环境实测。
