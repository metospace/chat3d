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

打开 `http://127.0.0.1:1420`，配置支持工具调用的 Agent 模型，在首页或工作台的生成菜单中选择「Blender 生成」。还必须显式开启下节的 Python 执行权限；不用打开 Blender 界面或安装第三方插件。

原有受控 `build_model` MCP 工具与 `/api/blender/build` 安装板接口保留供本机调用，不是生成菜单的执行链路。可用 `node tests/blender-modeling-live.mjs` 检查受控安装板几何。本机适配器不支持远程托管的 Worker 或直接运行 `npm run dev` 的 Vite 服务。

## 任意 Blender Python（仅本机，默认关闭）

这是本机代码执行能力，不是安全沙箱。脚本能以 Blender 进程身份读写文件、访问网络或启动进程。只在可信本机使用，不要通过反向代理公开，也不要执行不理解的脚本。后台 Blender 使用临时工程；下载或关闭结果都不会撤销脚本对系统造成的副作用。

除原有启动设置外，显式设置 `$env:CHAT3D_BLENDER_ALLOW_PYTHON = "1"` 后再启动。在首页或工作台生成菜单中选择「Blender 生成」后，发送需求会自动执行脚本，不再逐次弹窗确认；仅对可信输入使用。导出的 GLB 通过现有网格导入流程进入工作台预览，应用后成为可选、可编辑、可撤销的零件；原生修改器、程序材质和未支持的动画留在原文件中。原始 `.blend`、GLB 和 PNG 在对话中折叠展示，当前会话可原样下载；若导入不兼容，仍可下载文件，已有场景不变。不运行 Scenivo 的质量复核。不要在共享或公开服务上启用。

可运行 `node tests/blender-python-live.mjs` 验证脚本授权、三文件响应、多部件 AGV、未应用倒角的 GLB 导出、独立预览布光及脚本相机；通过 `SCENIVO_TEST_ORIGIN` 指定本机服务地址。测试还会在自动清理的临时目录中，用本机 Blender（`BLENDER_EXECUTABLE` 或 PATH 中的 `blender`）重新打开下载的 `.blend`，检查未应用的倒角、实际打包图片及像素颜色，而不是扫描文件字节判断图片格式。

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
