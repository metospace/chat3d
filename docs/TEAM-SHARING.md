# 公司内部团队共享（0.2.0）

沿用 React/Vite/Tauri 与 Node 服务。首版是**一个公司、一个团队**：所有有效成员可查看、搜索、预览并复制已发布资产和场景；个人 IndexedDB、草稿、对话、模型 API 设置仍保留本地，没有后台同步或迁移上传。团队账户与模型 API 账户无关。

## 部署

需要 Node.js 24、一个持久化本地磁盘目录，以及由公司指定的 HTTPS 反向代理。SQLite 是 Node 内置模块，无新增数据库服务或 npm 依赖。不支持将数据库放在临时容器层、网络共享磁盘或多个副本中运行。Sites/静态托管/现有 Worker 不提供团队数据库；桌面安装包也不内嵌数据库服务器。

在选定服务器检出提交后：

```sh
npm ci
npm run build
export CHAT3D_TEAM_DB=/srv/chat3d-data/team.sqlite
# 浏览器实际来源必须精确匹配；不要设置通配符。
export CHAT3D_TEAM_ORIGINS=https://team.company.example,https://portal.jiezi-ai.com,http://tauri.localhost,tauri://localhost
# 协同平台（路径 A）。默认指向公司协同认证；只转发用户 accessToken，不使用服务账号令牌。
export CHAT3D_PLATFORM_AUTH_BASE=http://36.133.218.210:48080
export CHAT3D_PLATFORM_TENANT_ID=1
# 设为 0 时关闭本地团队密码登录（返回 403），只保留协同账号换票。
export CHAT3D_TEAM_PASSWORD_LOGIN=1
export HOST=127.0.0.1
export PORT=1420
npm start
```

Dockerfile 同时包含团队校验器。容器部署时将受限持久卷挂载至 `/data`，显式设置 `CHAT3D_TEAM_DB=/data/team.sqlite` 和来源白名单；目录须可由容器的 node 用户写入。不要将生产数据库放入构建上下文。

首次运行前由服务器管理员创建持久目录并限制服务用户访问。反向代理将指定 HTTPS 域名转发到 127.0.0.1:1420，允许至少 22 MB 请求体，设置至少 60 秒请求超时。公司域名、证书、服务器位置和运行账号须由部署方提供；仓库不含生产凭据。不要向公网开放无 TLS 的 Node 端口。已有模型代理配置保持独立，不必启用任何收费模型即可使用共享功能。

网页本机测试可以使用 `http://127.0.0.1:1420`，并将浏览器开发来源（例如 `http://localhost:1421`、`http://127.0.0.1:1420`）加入 `CHAT3D_TEAM_ORIGINS`。桌面客户端保留既有 Tauri 权限，仅支持标准 HTTPS 443（本机测试 HTTP 80）；不要填写 1420、1435 等自定义端口。公司部署应使用 HTTPS 443 反向代理到 Node 端口，不要扩大客户端通配权限。Vite dev 不自动承载团队服务；浏览器与桌面客户端填写另行启动的 Node 服务根地址。未设置 `CHAT3D_TEAM_DB` 时共享 API 不启用。

### 浏览器团队库（轻量 Web）

构建产物 `dist-team-web/` 由 `npm run build:team-web` 生成，并随 `npm run build` 一并产出。启用团队数据库的 Node 服务会在 `/team/` 提供独立 SPA（与桌面 `dist/` 主应用分离）：

- 地址示例：`https://portal.jiezi-ai.com/team/`（同域调用 `/api/team/`，无需在网页里填写端口）。
- 能力：登录、搜索、预览固定版本、**下载桌面导入包**（资产 JSON / 场景 `.chat3d.json`，含新 id，不写入浏览器 IndexedDB）。
- 不在 Web 端提供 AI 生成、工作台编辑或选择性发布；发布仍在桌面客户端顶部导航 **团队** 页完成。
- OAuth 回调页 `/team/sso/callback` 先清除 URL 中的凭据，再携带 `state` 单次调用 `/api/team/login/sso/code`。服务端兑换成功后按 `state` 暂存平台令牌（约 5 分钟、一次性）；成功后仍可通过 BroadcastChannel/localStorage 通知**同域**等待页。桌面端系统浏览器与 Tauri 不同源，BroadcastChannel/localStorage 不可达，因此桌面用同一 `state` 轮询 `POST /api/team/login/sso/claim` 领取平台令牌，再调用 `/api/team/login/sso` 建立自己的团队会话，不再二次兑换授权码。回调页兑换成功后只提示可关闭本页并返回 Scenivo，**不进入**门户团队库浏览。回调失败后请回桌面重新点「登录授权」。
- 单次兑换回归：`node tests/team-oauth-callback.mjs`（本地 HTTP 服务，覆盖回调兑换、令牌优先级、BroadcastChannel/storage/focus，以及跨源桌面 `claim` 轮询）。
- 平台授权码兑换支持 `{code:0,data:{access_token,refresh_token,expires_in}}`，优先读取内层 snake_case 令牌，兼容内层 camelCase 与顶层 OAuth 令牌字段；有效期优先使用 `expiresTime` / `expires_time` 绝对时间，否则将内层或顶层 `expires_in` 秒数换算为毫秒时间戳，缺失时为 `0`。`node tests/team-library.mjs` 使用本地平台 HTTP mock 验证兑换、团队会话、有效期优先级及未配置 secret 的 503。

**OpenResty / Nginx 要点（与现有门户并存）：**

```nginx
# 团队 API（已有）
location ^~ /api/team/ {
  proxy_pass http://127.0.0.1:1420;
  client_max_body_size 22m;
  proxy_read_timeout 60s;
}

# 浏览器团队库 SPA（Node 1420 已内置静态路由；反代整站或仅 /team/ 均可）
location ^~ /team/ {
  proxy_pass http://127.0.0.1:1420;
  proxy_read_timeout 60s;
}

# 桌面更新（勿改动路径）
location ^~ /desktop-updates/chat3d/ {
  # 继续由门户静态目录或现有规则提供
}
```

将 **`https://portal.jiezi-ai.com`**（以及实际提供 `/team/` 的精确来源，无尾部斜杠）加入 `CHAT3D_TEAM_ORIGINS`。门户根路径可继续只放桌面更新说明页；团队浏览入口使用 `/team/` 子路径即可。

## 账号管理

没有开放注册或默认密码。管理员通过服务器命令创建账户，密码从标准输入读取（不少于12字符，最多256字符），不要放在命令行参数、仓库或日志中。以下交互提示中的密码由管理员自行选择：

```sh
read -rs -p 'New account password: ' TEAM_PASSWORD; printf '\n'
printf '%s' "$TEAM_PASSWORD" | node server/team/admin.mjs add alice member
unset TEAM_PASSWORD
# add 名称 admin|member|viewer；禁用账号立即撤销全部会话：
node server/team/admin.mjs disable alice
```

角色：`viewer` 只能读取和获取；`member` 可发布新原件和追加自己的原件版本；`admin` 可追加任意原件版本。现有版本不可编辑或删除。账号管理仍使用服务器命令，不向客户端提供提升权限入口。数据库保存 scrypt 密码哈希和会话 token 哈希，会话8小时过期。团队会话 token 保存在桌面进程内共享单例：切换资产库/场景库/团队资源等模块或离开团队页再返回仍保留连接，无需重新授权。关闭应用后需重新换票；默认会把协同 access/refresh 写入本机 localStorage（与模型 API Key 同级），下次打开用已保存的 accessToken 静默兑换团队会话；不保存协同密码。仅服务根地址与可选协同令牌保存在 localStorage；客户端不跟随 API 重定向。Windows/Tauri 沿用原生 HTTP 插件的既有权限范围与正常 TLS 校验。

## 使用

1. 在 **团队资源** 页点击 **登录授权**，在协同平台完成登录后自动返回（无需填写团队服务地址；桌面默认 `https://portal.jiezi-ai.com`，`/team/` 门户同域用当前 origin；可用 `VITE_CHAT3D_TEAM_DEFAULT_BASE` 覆盖）。资产和场景共用本次登录。
2. 浏览团队网格/列表，搜索名称和说明，按“已关联本地 / 可更新”筛选。可以多选资源并一次确认获取，列表显示逐项成功、失败与重试结果。
3. 本地资产库或场景库的详情及批量操作可直接 **发布至团队**，不再先跳页从底部长下拉框逐项找内容。仅已保存内容可发布；未保存场景、待确认预览和运行中的任务必须先处理。
4. 点击“准备发布”冻结选中快照，核对新团队原件或有权追加的目标后确认。准备阶段不上传；准备之后本地发生的新修改也不加入本次发布。失败重试复用同一请求标识，已成功项不会重复发布。
5. **版本关联**记录精确团队服务、原件和固定版本，以及对应的本地资源。发布和获取后显示关联版本；“检查团队更新”只查询版本，不自动上传或替换个人内容。
6. **获取新版并保留旧副本**始终新建独立本地资源：原来的资产版本、场景、手动修改和未确认草稿保持不变。相同团队固定版本再次获取会复用已关联副本，不无意创建重复项；本地副本被删除时先恢复旧副本。场景中的固定资产引用不会自动升级。
7. 批量传输显示逐项结果，只重试失败项。服务端拒绝旧版本追加时需刷新并重新准备，不能覆盖他人更新。结果不确定时关闭仅停止本机重试，不能撤回已完成的发布；重开后应先核对团队记录。

团队发布仍是完整几何、材质和可选动画快照，不包含聊天、模型密钥或生成历史。关联保存在独立的本机数据库，不包含 token；个人工程/备份格式保持不变，资源备份不迁移团队写入关系或账号。关联不是自动同步、实时协作或团队质量认证。

预览沿用真实缩略图渲染器，不调用生成模型。软件几何预览不代表材质、光影或人工验收。团队服务维持不可变版本和乐观并发检查，不需要部署新的同步服务器。

## 运维与边界

- 备份：停止服务后复制整个持久目录（含 SQLite、WAL、SHM）；恢复到受限目录，保持相同 Node 版本后启动。在线备份须使用 SQLite 的备份工具，不要仅复制正在写入的主文件。备份含密码哈希与有效会话，应按内部敏感数据保管。
- 限制：单进程服务，单团队，没有实时协作、外部客户租户、发布撤回或在线用户管理。登录主路径是 **登录授权**：打开协同 SSO 页 `{SSO_UI}/#/sso?client_id=scenivo&redirect_uri=…&response_type=code&state=…`（**hash 路由** `/#/sso`，勿用 path `/sso`；不传 `scope`，避免协同自动授权跳转，等待用户点击同意授权或拒绝）；默认 SSO UI `http://pm.jiezi365.com:48001`，API `http://36.133.218.210:48080`。回调 `/team/sso/callback` 带回 code 后服务端 `/api/team/login/sso/code` 兑换。新账号为 member，已有账号保留角色；停用账号与平台 401 均拒绝。SSO 会话超过 5 分钟或发布时会用同一用户 token 复核 `get-permission-info`，平台 401 删除会话。本地团队密码登录默认隐藏，仅 `VITE_CHAT3D_TEAM_SHOW_PASSWORD_LOGIN=1` 调试展示；服务端可用 `CHAT3D_TEAM_PASSWORD_LOGIN=0` 关闭。单次发布22 MB HTTP上限，现有格式校验20 MB上限。容量规划与磁盘配额由部署方管理。
- 防护：服务端认证、数据库事务、不可变版本、逐原件写权限、跨源白名单；登录错误累计8次暂时限流15分钟。生产代理还应限制连接与登录速率。TLS在公司反向代理终止。
- 测试仅创建临时账号与临时数据库，不触及真实个人数据、不调用真实收费模型。

## 验证与 Windows 交付

```sh
npm test             # 原有完整回归
npm run test:team    # SQLite/HTTP、桌面团队页、Web 导入包与 /team 静态路由测试
npm run build        # TypeScript、前端、Worker、团队校验器构建
```

`.github/workflows/windows-desktop.yml` 在 main 推送后先运行上述回归，再打包 **0.2.1** Windows x64 NSIS，并调用安装测试。每次制品都记录本次提交 SHA、工作流 ID、版本和 SHA256；安装测试校验这些字段与安装后的 ProductVersion，再执行现有可访问性/UI 操作。安装包与 `windows-installed-smoke-{sha}` 包含原始证据。该流程不代表用户 GPU 或公司实际 HTTPS 部署已经验证，也不能用旧0.1.3结果替代。本次 CI 结果与链接见交付记录。
