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

### 桌面安装版

桌面版通过原生命令直接启动已安装的 Blender，不调用网页的 `/api/blender/python`，不需要安装 Node.js、启动本地网页服务或安装 Blender 桥接插件。在生成菜单选择「Blender 生成」，点击「连接 Blender」，在原生弹窗确认本次会话的可信 Python 执行权限。未自动找到 Blender 时，选择本机的 `blender.exe`；所选路径可保存，但执行授权不持久化，关闭应用即撤销。连接会验证 Blender 版本响应，不代表已经完成建模或渲染。

桌面执行与网页复用同一 Python runner；每次创建空工程，返回原始 `.blend`、GLB 和 PNG。单次脚本 256 KiB、执行 60 秒、日志 1 MiB、三文件分别最多 32/20/8 MiB；取消任务、关闭窗口或退出应用会终止并回收正在运行的 Blender，临时工程随后清理。原生 IPC 只允许本地主窗口调用，不开放网络监听端口。此能力仍是当前用户权限下的任意代码执行，不是沙箱；仅授权可信模型和输入。

执行期间对话显示实际收到的 Python 脚本、字符数、最近更新时间和当前操作。默认展示最近 8 行，可展开最多 24000 字符的保留片段；较早内容截断会明确提示。接收脚本不等于执行。桌面通过原生进度通道报告真实阶段：启动、执行脚本、保存工程、导出 GLB、渲染、读取输出；只显示已发生的阶段与时间，不编造百分比或当前代码行。脚本阶段标记仅作进度遥测，不是执行成功或质量证明。模型的公开说明也会流式展示，私有推理不展示。网页版只显示请求/接收文件阶段，不伪装已取得原生内部阶段。

### 本机网页版

使用 Node.js 24。先运行 `npm ci` 和 `npm run build`，再在 PowerShell 中启动本机服务（把 Blender 路径换成你的实际安装路径）：

```powershell
$env:CHAT3D_BLENDER_ENABLED = "1"
$env:BLENDER_EXECUTABLE = "D:\Blender\blender.exe"
npm.cmd start
```

打开 `http://127.0.0.1:1420`，配置支持工具调用的 Agent 模型，在首页或工作台的生成菜单中选择「Blender 生成」。还必须显式开启下节的 Python 执行权限；不用打开 Blender 界面或安装第三方插件。

原有受控 `build_model` MCP 工具与 `/api/blender/build` 安装板接口保留供本机调用，不是生成菜单的执行链路。可用 `node tests/blender-modeling-live.mjs` 检查受控安装板几何。本机适配器不支持远程托管的 Worker 或直接运行 `npm run dev` 的 Vite 服务。

## 任意 Blender Python（仅本机，默认关闭）

这是本机代码执行能力，不是安全沙箱。脚本能以 Blender 进程身份读写文件、访问网络或启动进程。只在可信本机使用，不要通过反向代理公开，也不要执行不理解的脚本。后台 Blender 使用临时工程；下载或关闭结果都不会撤销脚本对系统造成的副作用。

除原有启动设置外，显式设置 `$env:CHAT3D_BLENDER_ALLOW_PYTHON = "1"` 后再启动。在生成菜单选择「Blender 生成」后，发送需求会自动执行脚本，不再逐次弹窗确认；仅对可信输入使用。生成工具把实际 PNG 返回模型，下一轮记录当前源码版本的看图观察与问题；存在明确缺陷时可修改脚本、重新生成并复核。不运行 Scenivo 的完整质量复核。导出的 GLB 经现有网格导入流程进入待确认预览，应用后成为可选、可编辑、可撤销的零件；原生修改器、程序材质和未支持动画留在原文件。原始 `.blend`、GLB 和 PNG 可在当前会话原样下载；后续执行或模型服务失败仍保留上次成功文件。待复核及已知问题均明确展示，不因文件导出或单图复核宣称工程验收。不要在共享或公开服务上启用。

可运行 `node tests/blender-python-live.mjs` 验证脚本授权、三文件响应、多部件 AGV、未应用倒角的 GLB 导出、独立预览布光及脚本相机；通过 `SCENIVO_TEST_ORIGIN` 指定本机服务地址。测试还会在自动清理的临时目录中，用本机 Blender（`BLENDER_EXECUTABLE` 或 PATH 中的 `blender`）重新打开下载的 `.blend`，检查未应用的倒角、实际打包图片及像素颜色，而不是扫描文件字节判断图片格式。

代理工具为 `run_blender_python`、`read_blender_script`、`patch_blender_script`、`review_blender_result`。读取使用零基 UTF-16 字符窗口，`endChar` 不含，每页最多 12000 字符 / 120 行，按 `nextChar` 续读。补丁与整体重建已有结果必须使用当前 `expectedVersion`；每组 1–8 个唯一匹配且不重叠的字面替换，整组验证后才执行。Python 脚本仍受 256 KiB UTF-8 上限约束。未涉及源码保留，但完整脚本每次在空工程重执行，不是安全沙箱、几何作用域隔离或工作台手动编辑回写。

看图记录只允许在生成的后续模型轮次提交，版本必须匹配；重生成使旧复核失效。已知问题不能在未生成新结果时只清空列表。快速和精细档均保留用户明确要求；未完成复核或仍有问题时只保留未完成候选。模型上下文只保留最新生成图，用户参考图不移除。可用 `node tests/blender-direct.mjs` 验证反馈与补丁边界；`node tests/blender-direct-browser.mjs` 使用真实本机后端验证渲染进入模型请求、预览/应用/撤销及原始下载字节（`SCENIVO_TEST_ORIGIN` 指定地址）。

### Python artifact contract and bounds

`POST /api/blender/python` accepts only JSON `{ "script": "..." }`. Discover the endpoint with `GET /api/blender/python/status` and `X-Chat3D-Python: 1`, then supply its session authorization token as `X-Chat3D-Python` on same-origin POSTs. Activation still requires the explicit Python enable flag, a loopback bind, no configured public origin, a direct loopback connection, and no forwarding headers. The status check establishes executable presence, not successful Blender startup.

Success is `multipart/form-data` with three binary file parts, never JSON/base64 at the HTTP boundary:

| Field | Filename | Content type | Maximum |
| --- | --- | --- | --- |
| `blend` | `result.blend` | `application/octet-stream` | 32 MiB |
| `glb` | `result.glb` | `model/gltf-binary` | 20 MiB |
| `render` | `render.png` | `image/png` | 8 MiB |

Failures remain JSON `{ "error": "..." }` with a non-success status. There are no partial-success bundles. Responses use `Cache-Control: no-store`. The MCP `run_blender_python` tool returns the same three byte streams as embedded base64 resources named `scenivo-blender:///result.blend`, `scenivo-blender:///result.glb`, and `scenivo-blender:///render.png`, with the content types above. `build_model` is unchanged: one embedded `scenivo-blender:///model.glb` resource, and its HTTP bridge still returns a binary GLB.

- Each script starts in an empty factory scene. The native project packs generated/file textures and packable Blender resources, then saves uncompressed with authored objects, modifiers, cameras, lights, world, materials, and render settings intact. Blender cannot pack arbitrary external dependencies such as movie/image-sequence textures, linked libraries, or external simulation caches; scripts needing those remain responsible for portable assets. Missing required images that Blender cannot pack fail the job.
- The GLB is exported directly by Blender, with evaluated modifiers enabled (including unapplied bevels), current-frame rest transforms, and authored cameras/punctual lights where glTF supports them. Export does not destructively apply modifiers to the native project. Standard glTF material/feature limitations still apply: the `.blend` is the authoritative native artifact, not a claim that every Blender feature round-trips through GLB.
- Only after both model files are written does Blender prepare the PNG. It retains the active scene camera, or another scene camera if no camera is assigned, and authored lights. Missing camera/light components get a render-only auto-framed orthographic camera and/or three studio area lights. Those fallback objects and preview settings are never saved into either model file.
- Auto-framing uses evaluated visible geometry/instance bounds, at most 1,200 instances, finite coordinates and an extent no larger than `1e12` Blender units. Empty scenes without a usable authored setup or invalid bounds fail rather than return an invented image.
- Preview work uses CPU Cycles, at most 12 samples, a 35-second Cycles time limit, and a maximum 768-pixel side (authored aspect ratio retained). Sequencer rendering is disabled; world, materials, color management and scene compositor remain authored. Bounds/time limits prioritize a real Blender still, not visual acceptance or high-resolution final rendering.
- Script payload: 256 KiB UTF-8; one shared active Blender worker; 60-second Blender process limit including script, packing, export and render; 65-second MCP bridge limit; 1 MiB captured process-log limit. Disconnect cancels the MCP request and Blender process. The temporary job directory is removed afterward.
- These are operational limits, not OS isolation, memory/disk quotas or protection against trusted code deliberately modifying the runner environment. `--disable-autoexec` does not sandbox an explicitly authorized Python script.

## Local geometry building

The same Node server also supports modeling. Discover it with GET /api/blender/build/status (checks configuration and executable presence, not whether the executable actually launches). POST /api/blender/build requires a same-origin loopback request with Content-Type: application/json and X-Chat3D-Build: 1. It returns a binary GLB (model/gltf-binary) or a JSON error. Example body:

```json
{"type":"mounting_plate","width":120,"depth":80,"thickness":8,"holeDiameter":6,"holeInset":12,"bevel":1}
```

Dimensions are millimeters; GLB is exported in meters. holeInset measures from the plate edges to each hole center. Also supported: box (width, depth, thickness, optional bevel) and cylinder (diameter, thickness, optional center holeDiameter and bevel). Each job runs in an empty, disposable Blender scene with a 90-second timeout. No user code, model file paths or external resources are accepted. Rendering and building share a single worker in the HTTP process.

To use MCP locally, configure your client to start node with an argument pointing to server/blender/mcp.mjs (absolute path recommended), and optionally set BLENDER_EXECUTABLE in the client's environment. The MCP transport is stdio; its build_model tool takes the same parameters and returns the GLB as an embedded base64 resource. It is a trusted local entry point independent of the Node HTTP enable flag. The HTTP bridge launches the local stdio MCP server, calls build_model, and returns the decoded GLB.
