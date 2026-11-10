# 应用更新

浏览器和桌面版共用 `package.json`、`src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 里的版本号。发版时这三处必须一起递增，测试会核对它们相同。

更新不会读取或上传模型密钥。生成、截图、校验、应用或待确认预览进行中，页面不会自动刷新，桌面版也不会自动重启。

## 更新日志

设置 → 关于 → 关于与更新，以及独立关于弹窗，均显示离线可用的更新日志。仅收录从 0.2.0 开始的已发布版本，按时间倒序显示版本、时间和变更内容；默认展示最近三条，其余可展开。历史时间采用 Git 版本提交时间，不冒充实际部署或安装时间；最近和更早记录统一通过 `Intl.DateTimeFormat` 的 `Asia/Shanghai` 时区及 `hourCycle: 'h23'` 显示为完整的 `YYYY-MM-DD HH:mm:ss`，不重复附加时区文字，不依赖浏览器本地时区。

日志唯一数据源是 `src/domain/updateHistory.ts`。正式发版时新增实际版本的记录并保留旧记录，填写有依据的带时区完整时间，同时更新上述版本文件；不得编造版本、发布时间或缺失的时分秒。未发布开发事项在开发任务中追踪，不进入面向用户的更新日志，不新增“开发中”分组。发布时将实际发布的变更整理进对应版本记录，不得只改版本号而遗漏更新内容。服务端最新版本的 `notes` 仍用于更新提示，不覆盖历史日志。


## 浏览器

生产构建把版本写入 `dist/version.json`。Node 与 Cloudflare Worker 都用它响应 `GET /api/version`，并设置 `Cache-Control: no-store`。反向代理要把 `/api/version` 转到 Node，不能落到静态首页。

启动约 1.5 秒后会静默检查一次；之后约每 30 分钟、回到前台或窗口重新获得焦点时再检查。首次检查失败会在 15 秒、1 分钟、3 分钟自动重试，避免冷启动网络未就绪时一直不提示。设置或关于里的「检查更新」可以马上检查。发现更高版本后会主动弹出「应用更新」提示（关于面板打开时进度只显示在面板内，不再叠第二层弹窗）：

- 选择「稍后」，本次页面会话不再提示这一版本。
- 任务进行中选择「结束后提醒我」。任务结束后再提示，此时才可以刷新。
- 「下载备份」打开现有的备份与恢复。确认项目 JSON 已保存在电脑上之后，再选择「立即更新」。刷新只加载当前网站已经发布的前端。
- 桌面更新安装后及用户手动重启前，先等待工作区延迟写入与在途事务完成，再确认工作区已就绪、无保存异常且没有新任务；保存失败保留“已就绪，尚未重启”，提示先下载备份并处理异常，不直接退出。此门槛不替代用户主动备份。

可选的构建期环境变量（不要写入密钥）：

- `CHAT3D_UPDATE_NOTES`：最多 500 字的说明，写入 `version.json`
- `CHAT3D_UPDATE_PUB_DATE`：RFC 3339 UTC 时间，例如 `2026-10-26T00:00:00Z`

本地 `npm run dev` 用源码里的版本，避免旧的 `dist/version.json` 造成误报。

## 桌面

未配置更新源的安装包仍可运行。检查时会说明此包未启用自动更新，不会下载任何文件。

桌面更新清单是 Tauri 的静态 `latest.json`，不是 Electron 的 `latest.yml`。同一门户以后会放多个应用，这个应用继续使用一级目录 `chat3d`。对外产品名是 Scenivo，安装包文件名因此是 `Scenivo_<version>_x64-setup.exe`。已安装的签名包仍请求下面的清单地址，不要改目录。应用 ID 仍是 `com.chat3d.app`，主程序仍是 `chat3d.exe`。NSIS 默认用产品名记住旧安装位置；`src-tauri/windows/hooks.nsh` 在默认安装目录上发现 Chat3D 0.2.0 时，会改回原来的目录、把快捷方式换成 Scenivo，并删掉旧的卸载登记。不要运行旧卸载程序来清理数据，它会删除 `$APPDATA\com.chat3d.app`。

门户 `https://portal.jiezi-ai.com/` 的源站监听 38008，由 Cloudflare Tunnel 提供对外 https。客户端只访问 https，不要把 38008 写进安装包。

| 用途 | 路径 |
| --- | --- |
| 更新检查地址 | `https://portal.jiezi-ai.com/desktop-updates/chat3d/latest.json` |
| 服务器目录 | `/opt/1panel/www/sites/portal.jiezi-ai.com/index/desktop-updates/chat3d/` |
| Windows 安装包和 `.sig` | `desktop-updates/chat3d/windows/` |
| macOS 安装包和 `.sig`（预留） | `desktop-updates/chat3d/mac/` |
| Linux 安装包和 `.sig`（预留） | `desktop-updates/chat3d/linux/` |

清单放在应用目录下。不要把 `latest.json` 直接放进 `desktop-updates/`，也不要使用没有应用名的 `desktop-updates/windows/`、`desktop-updates/mac/`、`desktop-updates/linux/`。

当前 GitHub workflow 只有 Windows runner。没有对应产物时，清单里不要写 macOS 或 Linux，脚本也不会创建空的 `mac/`、`linux/`。本机如果自己打出这两个平台的签名包，同一脚本会放进对应目录。

桌面构建需要 Rust 1.90 或更新版本。发布签名包时设置这些环境变量。私钥不要进入仓库、镜像、日志或 `VITE_*` 变量。Tauri 不读取 `.env` 文件。

```sh
npm run tauri signer generate -- -w "$HOME/.chat3d/updater.key"
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.chat3d/updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="签名密码"
export CHAT3D_UPDATER_PUBKEY="tauri signer 打印的单行公钥"
export CHAT3D_UPDATER_ENDPOINT="https://portal.jiezi-ai.com/desktop-updates/chat3d/latest.json"
export CHAT3D_UPDATE_NOTES="产品更名为 Scenivo。"
export CHAT3D_UPDATE_PUB_DATE="2026-10-26T00:00:00Z"
npm run tauri:build:windows
npm run desktop-update:assemble -- --bundle src-tauri/target/x86_64-pc-windows-msvc/release/bundle
```

本机的 `TAURI_SIGNING_PRIVATE_KEY` 可以是私钥文件路径，也可以是文件内容。GitHub Actions 的 runner 上没有这台机器的路径，Secret 里必须粘贴私钥文件内容。没有密码时密码可以留空。

`npm run tauri:build` 会先写入被 git 忽略的 `src-tauri/updater.generated.json`，其中只有公钥、https 检查端点、`dangerousInsecureTransportProtocol`（允许清单里的 http 安装包直链）和安装包签名开关。`npm run tauri:build:windows` 在此之上使用现有的 Windows NSIS 配置。检查端点必须是 https，不能带账号、密码或查询参数。动态更新服务可以使用 `{{target}}`、`{{arch}}`、`{{current_version}}` 和 `{{bundle_type}}`；门户这份静态清单不要使用占位符。

发布时可选 `CHAT3D_UPDATER_DOWNLOAD_ORIGIN`（无末尾斜杠，例如 `http://36.133.218.210:38008`）：只替换 `latest.json` 里各平台 `url` 的 origin，检查地址仍是 `CHAT3D_UPDATER_ENDPOINT`。未设置时安装包 url 与清单同源。可选 `CHAT3D_UPDATER_DOWNLOAD_MIRRORS`：逗号分隔的额外 origin（同样不能带路径、账号或末尾斜杠），写入各平台的 `mirrors`。

当前配置是 `createUpdaterArtifacts: true`。Windows 的更新包就是 NSIS 安装包本身，旁边有 `.exe.sig`。`signature` 必须是该 `.sig` 的全文，不能写成路径或 URL。平台键只使用 `linux`、`darwin`、`windows` 加 `x86_64`、`aarch64`、`i686`、`armv7`。上传目录名则是 `windows`、`mac`、`linux`。

```json
{
  "version": "0.2.7",
  "notes": "安装包可从较快的镜像下载。",
  "pub_date": "2026-10-26T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<Scenivo_0.2.7_x64-setup.exe.sig 的全文>",
      "url": "http://36.133.218.210:38008/desktop-updates/chat3d/windows/Scenivo_0.2.7_x64-setup.exe",
      "mirrors": [
        "https://portal.jiezi-ai.com/desktop-updates/chat3d/windows/Scenivo_0.2.7_x64-setup.exe"
      ]
    }
  }
}
```

`mirrors` 可选，最多 6 个 http(s) 地址，不能带账号密码。它们必须是**同一份**已签名安装包，只是传输地址不同。`url` 仍是主地址：0.2.6 及更早的客户端忽略 `mirrors`，继续只下载 `url`。签名覆盖安装包内容，不覆盖 URL，所以换地址不会、也不应该换掉 `signature`。

门户这条发布路径会同时从 Cloudflare（`https://portal.jiezi-ai.com`）和源站直连（`http://36.133.218.210:38008`）提供同一个文件。`desktop-update:assemble` 在清单端点或主下载地址落在这一对 origin 上、且路径包含 `/desktop-updates/` 时，会把另一侧写进 `mirrors`。主地址仍由 `CHAT3D_UPDATER_DOWNLOAD_ORIGIN` 决定；没设时 `url` 与清单同源，直连地址进 `mirrors`。设了直连源时，`url` 保持直连，门户 https 进 `mirrors`。

0.2.7 客户端在「立即更新」之后、正式下载之前，对 `url`、`mirrors`，以及上面这一对已知地址（路径必须相同）做一次并行探测：每个地址最多读取 16KB，约 3.5 秒。能返回安装包样本的地址里选吞吐更高的一个。探测都失败时仍用 `url`。选中的地址交给 Tauri 更新插件下载；插件用清单里的 `signature` 和构建时写入的公钥校验，失败则不安装。校验逻辑没有放宽。关于页和更新条仍是原来的进度文案，探测期间显示「正在选择较快的下载线路…」。镜像下载如果在安装开始前失败，会再试一次主地址。

有 macOS 或 Linux 签名产物时才追加平台，例如 `darwin-aarch64` 指向 `desktop-updates/chat3d/mac/*.app.tar.gz`，`linux-x86_64` 指向 `desktop-updates/chat3d/linux/*.AppImage`。桌面端只安装签名校验通过的包。清单版本必须高于已经安装的版本，否则客户端会认为没有更新。

`npm run desktop-update:assemble` 扫描构建目录里的更新包和 `.sig`，写出：

```text
desktop-update-publish/UPLOAD.txt
desktop-update-publish/chat3d/latest.json
desktop-update-publish/chat3d/windows/Scenivo_<version>_x64-setup.exe
desktop-update-publish/chat3d/windows/Scenivo_<version>_x64-setup.exe.sig
```

把 `chat3d/` 同步到服务器，不要上传 `UPLOAD.txt` 或私钥：

```sh
rsync -a --delete desktop-update-publish/chat3d/ <用户>@<服务器>:/opt/1panel/www/sites/portal.jiezi-ai.com/index/desktop-updates/chat3d/
curl -fsS https://portal.jiezi-ai.com/desktop-updates/chat3d/latest.json
```

`latest.json` 不要被 Cloudflare 长期缓存。安装包 URL 含版本号，可以缓存。

### 静态清单和 Node 本机文件

推荐客户端直接请求门户上的静态 `latest.json`。构建时把 `CHAT3D_UPDATER_ENDPOINT` 设为 `https://portal.jiezi-ai.com/desktop-updates/chat3d/latest.json`。

Node 也可以读取同一份文件：设置 `CHAT3D_DESKTOP_UPDATE_MANIFEST=/opt/1panel/www/sites/portal.jiezi-ai.com/index/desktop-updates/chat3d/latest.json` 后，`GET /api/desktop-update` 返回校验过的内容。这个路径只在服务端读取，不要把它指到私钥。Worker 没有本机清单文件，不能用这条路径。

两种托管可以同时存在，但每个安装包只会请求构建时写入的那一个地址。门户发版使用静态清单。只有在希望客户端走 Node 时，才把 endpoint 改成该 Node 站点的 `https://<节点>/api/desktop-update`；安装包 URL 仍然来自上面的静态目录，不要用 Node 地址运行 `desktop-update:assemble`。

用户选择「立即更新」后，应用下载、校验并安装。若下载期间又开始了生成，安装完成后不会重启，需要等任务结束再点「立即重启」。

Windows 安装使用 NSIS 的 passive 模式。日常 `tauri build` 不生成更新签名；只有 `npm run tauri:build` 且 `CHAT3D_UPDATER_ENDPOINT` 与 `CHAT3D_UPDATER_PUBKEY` 都存在时才生成。

### GitHub Actions

`.github/workflows/windows-desktop.yml` 在 main 推送和手动运行时都会构建 Windows NSIS。签名是可选的：

- 未设置更新密钥时，保持原来的未签名 `npm run tauri -- build`，不生成 `latest.json`，也不上传门户。
- `TAURI_SIGNING_PRIVATE_KEY`、`CHAT3D_UPDATER_PUBKEY`、`CHAT3D_UPDATER_ENDPOINT` 都有值时，改为 `npm run tauri:build:windows`，并上传 artifact `chat3d-desktop-update-<sha>`。里面是可 rsync 的 `chat3d/` 目录。
- 只配置了其中一部分时，workflow 失败并指出缺少哪一项，避免把未签名包装成已发布的自动更新。密码 Secret 可以留空。

在仓库 Settings → Secrets and variables → Actions 添加：

| 名称 | 种类 | 值 |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Secret | `updater.key` 的文件内容，不是仓库路径 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret | 生成密钥时的密码；无密码则留空 |
| `CHAT3D_UPDATER_PUBKEY` | Secret | `tauri signer generate` 打印的单行公钥 |
| `CHAT3D_UPDATER_ENDPOINT` | Secret | `https://portal.jiezi-ai.com/desktop-updates/chat3d/latest.json` |
| `CHAT3D_UPDATE_NOTES` | Variable，可选 | 最多 500 字的说明 |
| `CHAT3D_UPDATE_PUB_DATE` | Variable，可选 | RFC 3339 UTC，例如 `2026-10-26T00:00:00Z`。不设则用构建时刻 |
| `CHAT3D_UPDATER_DOWNLOAD_ORIGIN` | Variable，可选 | 无末尾斜杠的 http(s) origin。只替换 `latest.json` 里的 `url`；不设则与清单同源 |
| `CHAT3D_UPDATER_DOWNLOAD_MIRRORS` | Variable，可选 | 逗号分隔的额外 origin，写入 `mirrors`。门户地址会自动带上另一侧镜像 |

workflow 不会登录门户，也不会把私钥放进 artifact。下载 `chat3d-desktop-update-<sha>` 后，按其中的 `UPLOAD.txt` 上传。已安装的签名包会向清单地址检查更新；未签名的日常包仍只提示未配置自动更新。

这次 workflow 不构建 macOS 或 Linux，也不会假装这些平台已经发布。

## 验证

自动测试：

```sh
node tests/app-update.mjs
node tests/desktop-update-publish.mjs
```

浏览器手工检查：

1. `npm run build && npm start`，确认 `curl -sD- http://127.0.0.1:1420/api/version` 的版本与 `package.json` 相同，且包含 `cache-control: no-store`。
2. 把 `dist/version.json` 的版本临时改成 `99.0.0` 后刷新已打开的页面。应出现更新提示。
3. 开始一次生成，确认没有「立即更新」，可以选择「结束后提醒我」。
4. 结束生成后选择「稍后」，提示关闭；选择「立即更新」会刷新页面。
5. 把 `dist/version.json` 改回构建版本。

桌面发布检查：

1. 确认 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 的版本一致，且高于已安装版本。
2. 配好密钥和 `CHAT3D_UPDATER_ENDPOINT=https://portal.jiezi-ai.com/desktop-updates/chat3d/latest.json` 后运行 `npm run tauri:build:windows`，再运行 `npm run desktop-update:assemble -- --bundle src-tauri/target/x86_64-pc-windows-msvc/release/bundle`。
3. 打开 `desktop-update-publish/chat3d/latest.json`。未设置下载源时，`windows-x86_64.url` 应指向 `https://portal.jiezi-ai.com/desktop-updates/chat3d/windows/` 下的 `.exe`，`mirrors` 含同一路径的 `http://36.133.218.210:38008` 地址。`signature` 与同目录 `.exe.sig` 全文一致。没有 macOS、Linux 产物时，清单里不应出现这两个平台。
4. 确认产物和 `UPLOAD.txt` 都不含私钥。把 `chat3d/` 同步到 `/opt/1panel/www/sites/portal.jiezi-ai.com/index/desktop-updates/chat3d/`。
5. `curl -fsS https://portal.jiezi-ai.com/desktop-updates/chat3d/latest.json` 应返回刚上传的 JSON，且 `Cache-Control` 不宜长期缓存。
6. 安装旧的签名包，打开应用或在设置中检查。任务进行中不应重启；空闲时「立即更新」应完成安装并重启。没有配置端点的调试包应继续启动，并在手动检查时说明未配置自动更新。
7. 未配置 GitHub Secrets 时，`.github/workflows/windows-desktop.yml` 的日志应写明继续构建未签名 NSIS，且没有 `chat3d-desktop-update-*` artifact。配齐密钥后，同一次 Windows job 改为签名构建，并附带该 artifact。
