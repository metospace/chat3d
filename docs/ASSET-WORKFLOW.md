# 单体资产、验收与场景复用

## 已实现
- 选中整个组件保存为固定版本资产，检索名称、分类与用途。
- 用途、必要结构、绑定真实零件的操作/抓握/进料/出料/安装/支撑/自定义连接点；坐标为零件局部米制坐标，法线为单位向量。编辑连接点建立新版本。
- 单体验收保存六项结论、文字依据和多视角图片，SHA-256绑定几何、材质及用途契约。仅软件图不得通过材质；自动渲染截图不等于通过。
- 实例保留来源零件映射；检测形体、相对姿态、材质及连接改动。未经修改的实例可返回人工通过的内在质量依据，连接和场景关系仍需检查。
- 对话工具 read_saved_asset、inspect_asset_instances、align_saved_instances。自动对齐仅平移整个来源实例，拒绝改形、用途不兼容或法线不相对，不提供碰撞或握持质量保证。
- 整库备份包含连续版本及验收记录，恢复原子地创建新身份，不覆盖旧数据。导入历史结论仅参考，重新复核前不得用于通过或复用依据。

## 使用
顶部“模型资产库”选取资产；在“用途与连接点”中填写用途、必要结构及零件绑定点，保存为新版本。在“单体质量验收”生成三个视角，再记录逐项结论和依据。生成截图优先已就绪WebGL，支持的服务端渲染次之，最后软件几何检查；实际来源随图片保存。
对话可要求按资产用途查找固定版本、插入多个实例、检查实例是否改动、按兼容连接点平移对齐。仍需检查通路、穿插、接触和实际画面。
在场景工作台打开左侧「资产」架，把资产卡片拖到画布可见地面，看到放置预览后松开鼠标；Esc 取消。也可聚焦卡片按 Enter，再点击画布放置。Windows 桌面版使用 WebView2 的 HTML 拖放来接收画布内的资产拖动，Tauri 窗口配置变更需要重新打包客户端。
通过“备份整个资产库”下载，另一浏览器通过“导入资产文件”恢复整个库。本地单个资产 JSON 与 GLB 的文件上限各为 200 MiB，场景项目 JSON 为 400 MiB。完整资产库和工作台备份的总上限仍为 200 MiB；接近或超过整库预算时请逐项导出。均按实际字节数计算并包含上限值。恢复最多 200 个资产版本。GLB 的顶点和贴图预算不变。备份不包含模型服务配置、API 密钥；资产库备份也不包含聊天，不是云端自动同步。

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
