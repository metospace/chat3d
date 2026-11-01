# 连续扫掠、接触阴影与浏览器验证

本次参考 Open 3D Skills 的 [threejs-scene](https://github.com/Moh4696/open-3d-skills/blob/main/skills/threejs-scene/SKILL.md)、[几何方法](https://github.com/Moh4696/open-3d-skills/blob/main/skills/threejs-scene/references/geometry.md)、[性能检查方法](https://github.com/Moh4696/open-3d-skills/blob/main/skills/threejs-scene/references/performance.md) 和 [site-check](https://github.com/Moh4696/open-3d-skills/blob/main/skills/site-check/SKILL.md)，在现有场景文档、结构规划、命令、预览确认和撤销流程上扩展能力。没有替换原建模流程。现有 profile、lathe、loft、sweepTube、基本体及导入网格继续使用。无需安装 Blender。

## 连续截面扫掠

新增 `profileSweep` 几何，由原来的 `edit_scene` / `build_structured_component` 调用：

```json
{
  "type": "profileSweep",
  "params": {
    "profile": [[-0.05,0],[0.05,0],[0.05,0.1],[-0.05,0.1]],
    "path": [[0,0],[1,0],[1,1]],
    "closed": false
  }
}
```

截面点为 `[横向偏移, 高度]`，路径点为水平面中的 `[X,Z]`，单位米。截面需要 3–64 点，不重复首点，当前不含截面孔；路径需要 2–64 点，闭合时至少 3 点、不重复首点。闭合路径的正偏移自动朝外；开放路径按路径顺序使用 XZ 平面的左法线。

折角保持斜接位置连续，开放端封口，UV 使用米制距离。校验拒绝自交、自接触、折返、过尖斜接、过宽截面及保守检测到的路径占位重叠。它适用于导轨、折角型材、连续收边等，不是任意空间曲线、布尔运算或通用 CAD 偏置器。已有曲线管继续用 sweepTube。

几何参数贯穿校验、项目 JSON、尺寸检查、属性面板、网格导出和原生建模工具。GLB 导出为实际三角网格；项目 JSON 保留可编辑截面与路径。

## 显示质量

“显示 → 显示质量”独立于生成风格和快速/精细生成档位：

| 选项 | 行为 |
| --- | --- |
| 自动 | 桌面硬件渲染优先精细；小屏、低并发设备或检测到软件渲染时优先均衡；持续有效绘制较慢时逐级降低，本次会话不自动升档 |
| 精细 | 像素比上限 2；写实棚拍下启用半分辨率 GTAO 接触阴影 |
| 均衡 | 像素比上限 1.5，关闭接触后处理 |
| 流畅 | 像素比上限 1，降低阴影分辨率，关闭接触后处理 |

接触阴影排除玻璃、透明材料、文字标注和操作预览。作用距离随模型尺度调整，后处理失败时保留基础渲染。静止画面按需绘制；自动降档忽略首次编译预热、空闲间隔、截图及长时间离开页面的间隔。方向光阴影包络按模型尺寸拟合，地面使用毫米级间隙。局部检查截图结束后恢复相机、灯光包络和接触作用尺度。

后处理是视口显示效果，不修改模型数据或材质，也不写入 GLB。现有离线 HTML 保留几何、材质和基础灯光，当前不携带精细视口的 AO 后处理。

## 验证

```sh
node tests/profile-sweep.mjs
node tests/scene-render-quality.mjs
npm run test:scene-quality
npm run test:realistic-rendering
```

浏览器测试使用独立端口、临时依赖缓存和新浏览器上下文，不使用日常项目数据或模型 API。测试覆盖桌面/平板/手机尺寸、精细/均衡/自动/流畅显示、非空画面、横向溢出、完整帧绘制计数，以及重复切换后的 GPU 纹理、几何和程序数量。局部截图需恢复灯光与接触尺度。

默认使用已有 Chromium/Chrome/Edge，可设置 `CHAT3D_BROWSER_PATH`。可用 `node tests/scene-quality-browser.mjs --browser=webkit` 检查已安装的 Playwright WebKit；脚本不会自动下载浏览器。

截图和报告写入忽略的 `home-visual-results/`。硬件渲染时统计多帧 RAF 间隔；SwiftShader/llvmpipe 等软件渲染明确标记为未验证时序，不据此承诺 60 fps。固定测试几何用于验证实现，不是实际 AI 生成质量或相似度评估。
