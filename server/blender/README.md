# Optional local Blender inspection renderer

This renderer is part of Scenivo, not the Blender Agent Studio community plugin. It renders self-contained GLB geometry using the installed Blender executable; it never accepts Python, shell commands, user-selected paths, or external asset URLs.

Status: local testing adapter. It is disabled by default and is not a production-hosting solution. The deployed Sites Worker explicitly reports it unavailable because that runtime cannot launch Blender processes. Community skill integration and permanent execution hosting remain separate work.

## Local run

Install Blender from its official source. Build Scenivo normally. On a loopback-only trusted computer, set CHAT3D_BLENDER_ENABLED=1 and optionally BLENDER_EXECUTABLE to its actual executable, then use npm start. Leave HOST at its default 127.0.0.1. The browser discovers /api/blender/status. If WebGL cannot supply an inspection image, it can use this renderer.

Do not expose this local adapter directly to the Internet or forward it through an unauthenticated reverse proxy. Server deployment requires owner-authenticated access, quotas, process/container isolation, and a reviewed network boundary before activation. An Origin check is not authentication.

## Bounds

- 20 MB self-contained GLB input; ordinary geometry and embedded PNG/JPEG only
- At most three distinct requested views and one active Blender process
- 90 second process timeout; disconnect cancels the child process
- Blender factory startup and auto-execution disabled
- Temporary input/output directory owned by the job and removed afterward
- No scene mutation or arbitrary Python from the model
- Pictures are evidence for review, not automatic visual acceptance

## 在 Scenivo 中试用建模

使用 Node.js 24。先运行 `npm ci` 和 `npm run build`，再在 PowerShell 中启动本机服务（把 Blender 路径换成你的实际安装路径）：

```powershell
$env:CHAT3D_BLENDER_ENABLED = "1"
$env:BLENDER_EXECUTABLE = "D:\Blender\blender.exe"
npm.cmd start
```

打开 `http://127.0.0.1:1420`，配置支持工具调用的模型，打开工作台 AI 助手并勾选「Blender 建模实验」。不用打开 Blender 界面，也不需要另装 Blender 插件。界面首版只开放四孔安装板。

1. 发送「生成一块 120 × 80 × 8 mm 安装板，四角开直径 8 mm 的通孔，孔中心距板边 12 mm，外缘倒角 1 mm」。
2. 不应用草稿，继续发送「只把孔径改成 10 mm，其他不变」。检查预览仍为一块板。
3. 应用后撤销，确认正式场景恢复。

服务开启时可运行 `node tests/blender-modeling-live.mjs` 检查实际 GLB 几何。该实验不支持远程托管的 Worker 或直接运行 `npm run dev` 的 Vite 服务。

## 任意 Blender Python（仅本机，默认关闭）

这是本机代码执行能力，不是安全沙箱。脚本能以 Blender 进程身份读写文件、访问网络或启动进程。只在可信本机使用，不要通过反向代理公开，也不要执行不理解的脚本。后台 Blender 使用临时工程，生成结果回到 Scenivo 草稿，但丢弃草稿不会撤销脚本对系统造成的副作用。

除原有启动设置外，显式设置 `$env:CHAT3D_BLENDER_ALLOW_PYTHON = "1"` 后再启动。进入项目，在 AI 助手勾选 Blender Python 模式。启用该模式后，发送建模需求会自动执行脚本，不再逐次弹窗确认；仅对可信输入使用。导出的静态网格追加到草稿，不替换已有对象。不要在共享或公开服务上启用。

可运行 `node tests/blender-python-live.mjs` 验证脚本授权与多部件 AGV；通过 `SCENIVO_TEST_ORIGIN` 指定本机服务地址。

## Local geometry building

The same Node server also supports modeling. Discover it with GET /api/blender/build/status (checks configuration and executable presence, not whether the executable actually launches). POST /api/blender/build requires a same-origin loopback request with Content-Type: application/json and X-Chat3D-Build: 1. It returns a binary GLB (model/gltf-binary) or a JSON error. Example body:

```json
{"type":"mounting_plate","width":120,"depth":80,"thickness":8,"holeDiameter":6,"holeInset":12,"bevel":1}
```

Dimensions are millimeters; GLB is exported in meters. holeInset measures from the plate edges to each hole center. Also supported: box (width, depth, thickness, optional bevel) and cylinder (diameter, thickness, optional center holeDiameter and bevel). Each job runs in an empty, disposable Blender scene with a 90-second timeout. No user code, model file paths or external resources are accepted. Rendering and building share a single worker in the HTTP process.

To use MCP locally, configure your client to start node with an argument pointing to server/blender/mcp.mjs (absolute path recommended), and optionally set BLENDER_EXECUTABLE in the client's environment. The MCP transport is stdio; its build_model tool takes the same parameters and returns the GLB as an embedded base64 resource. It is a trusted local entry point independent of the Node HTTP enable flag. The HTTP bridge launches the local stdio MCP server, calls build_model, and returns the decoded GLB.
