# Chat3D 0.2.0 Linux 部署手册

更新日期：2026-10-26。适用包：`chat3d-server-4c16cad.tar.gz`。

这是已经发出的 0.2.0 部署记录。0.2.1 起桌面端对外名称是 Scenivo；本文里的路径、服务账号和 `Chat3D_0.2.0_x64-setup.exe` 仍对应该次安装包，不要按新名称改已有服务器目录。

本文部署的是 **公司内部团队共享服务**，供 Windows 客户端连接、发布和复用资产/场景。使用已编译部署包，不执行 `npm install`、`npm ci` 或 `npm run build`。模型 API 配置与团队账号独立；本文不启用公网模型代理，不涉及 MES/WMS 业务联动。

主线方案：**Linux + Node.js 24 + systemd + 宿主机 Nginx HTTPS**。命令针对首次部署，使用 Bash。每一步检查通过再继续，不要整篇一次性粘贴执行。

## 1 准备材料

| 项目 | 要求 |
| --- | --- |
| 服务器 | 使用 systemd 的 Linux；示例覆盖 Ubuntu/Debian、Rocky/AlmaLinux 等常见系统 |
| 架构 | x86_64 或 aarch64；本文二进制安装不适用于 Alpine/musl、32 位或其他架构 |
| 运行环境 | Node.js 24；本文固定使用官方 24.22.1，避免系统自带旧版 Node |
| 部署包 | 已提供的 `chat3d-server-4c16cad.tar.gz` |
| 域名 | 示例 `chat3d.example.com`，必须替换为你的真实域名；客户端能解析到服务器 |
| 证书 | 域名匹配且客户端信任的 HTTPS 证书及完整证书链 |
| 磁盘 | 本机持久磁盘，数据不放临时目录、容器临时层或网络共享盘 |
| 权限 | 可使用 sudo 的服务器管理员 |

**如果服务器已有 1Panel、宝塔或容器化 OpenResty/Nginx，不要重复安装另一个占用 80/443 的 Nginx。** 第 7 节给出处理原则；本文的 `127.0.0.1:1420` 反代配置要求 Nginx 与 Node 位于同一宿主机网络命名空间。

内网部署也需要客户端信任的 HTTPS。可以使用自有域名的内网解析与有效证书；不必把应用公开到互联网。企业内部 CA 需由公司管理员正规分发信任，不能通过关闭证书检查解决。

先检查：

```bash
cat /etc/os-release
uname -m
ldd --version | head -n 1
node --version
ps -p 1 -o comm=
ss -lnt | grep -E ':(80|443|1420)\b' || true
```

预期 PID 1 为 systemd。若系统过旧导致官方 Node 报 GLIBC 错误，请先升级系统或使用经验证的运行环境，不要强行替换系统 glibc。

后续需要写 `/opt`、`/etc` 等目录。进入管理员 Bash：

```bash
sudo -i
```

后文命令均在这个管理员终端执行。密码仅在服务器交互提示中输入，不粘贴到聊天、工单或脚本。

## 2 安装独立的 Node.js 24

已有可靠的 Node 24 也可以使用，但后续 systemd 的路径必须对应。以下安装到 `/opt/node24`，不替换服务器原有的 Node，不影响其他应用。

先安装下载/解压工具，按发行版二选一：

```bash
# Ubuntu / Debian
apt-get update
apt-get install -y ca-certificates curl xz-utils tar
```

```bash
# Rocky / AlmaLinux / RHEL 系
# 仓库和系统版本须仍受支持
dnf install -y ca-certificates curl xz tar
```

下载并核对官方 SHA256，然后解压。若 `/opt/node24` 已存在，先核对原环境，不要覆盖安装。

```bash
NODE_VERSION=v24.22.1
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) echo '本文未覆盖此 CPU 架构，请停止'; exit 1 ;;
esac

NODE_FILE="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}"
WORK_DIR=$(mktemp -d)
cd "$WORK_DIR"
curl -fSLO "$NODE_URL/$NODE_FILE"
curl -fSLO "$NODE_URL/SHASUMS256.txt"
awk -v file="$NODE_FILE" '$2 == file { print }' SHASUMS256.txt > selected.sha256
[ -s selected.sha256 ] || { echo '未找到校验值，停止'; exit 1; }
sha256sum -c selected.sha256 || { echo '校验失败，停止'; exit 1; }
[ ! -e /opt/node24 ] || { echo '/opt/node24 已存在，请先核对'; exit 1; }
mkdir /opt/node24
tar -xJf "$NODE_FILE" -C /opt/node24 --strip-components=1
/opt/node24/bin/node --version
/opt/node24/bin/node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(':memory:'); console.log('SQLite OK'); db.close();"
```

应看到 `v24.22.1` 和 `SQLite OK`。SQLite 实验性提示本身不等于启动失败；以实际错误和退出状态为准。

## 3 上传并解压服务端包

用 MobaXterm、SFTP 或其他既有传输方式，将文件上传到：

```text
/tmp/chat3d-server-4c16cad.tar.gz
```

本次提供文件的 SHA256：

```text
0123c34f0798c20c9a4db5d756d9e904fb6a647dad9d6c65b46f364e9de1dfad
```

检查文件一致性：

```bash
printf '%s  %s\n' \
  '0123c34f0798c20c9a4db5d756d9e904fb6a647dad9d6c65b46f364e9de1dfad' \
  '/tmp/chat3d-server-4c16cad.tar.gz' | sha256sum -c -
```

出现 `OK` 后继续；否则重新下载/上传，不使用损坏文件。

创建专用低权限服务账号与目录。下面账号仅供系统服务使用，不是 Scenivo 登录账号；如果已有同名账号，先确认其用途。

```bash
id chat3d >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/chat3d --shell /usr/sbin/nologin chat3d
install -d -m 0755 /opt/chat3d/releases
install -d -o chat3d -g chat3d -m 0700 /var/lib/chat3d
install -d -m 0755 /etc/chat3d

# 首次部署时此目录应不存在；已存在则先停止，核对是否为已有安装。
mkdir /opt/chat3d/releases/0.2.0-4c16cad
tar --no-same-owner -xzf /tmp/chat3d-server-4c16cad.tar.gz -C /opt/chat3d/releases/0.2.0-4c16cad
chown -R root:root /opt/chat3d/releases/0.2.0-4c16cad
chmod -R u=rwX,go=rX /opt/chat3d/releases/0.2.0-4c16cad
ln -s /opt/chat3d/releases/0.2.0-4c16cad /opt/chat3d/current
ls /opt/chat3d/current
```

应包含 `dist`、`dist-team`、`dist-team-web`、`server`、`node_modules`、`README-RUNTIME.txt`、`SOURCE-COMMIT.txt`。部署包已携带所需运行文件，不删除其中的 `node_modules`。

## 4 配置运行参数

编辑配置文件：

```bash
cat > /etc/chat3d/team.env <<'EOF'
CHAT3D_TEAM_DB=/var/lib/chat3d/team.sqlite
CHAT3D_TEAM_ORIGINS=https://chat3d.example.com,https://portal.jiezi-ai.com,http://tauri.localhost,tauri://localhost
CHAT3D_PUBLIC_ORIGIN=https://chat3d.example.com
CHAT3D_BLENDER_ENABLED=0
HOST=127.0.0.1
PORT=1420
EOF
chmod 0600 /etc/chat3d/team.env
```

**继续前将两处 `chat3d.example.com` 换成真实域名。** 可以使用 `nano /etc/chat3d/team.env` 或自己的编辑器。

- `CHAT3D_TEAM_DB` 必须是持久数据库绝对路径；未设置就不会启用团队共享 API。
- 来源白名单使用逗号分隔，无空格、无尾部 `/`，必须精确匹配协议和来源。保留示例中的两个 Tauri 来源供桌面端使用，不设置 `*`。
- `HOST=127.0.0.1` 让 Node 仅监听本机，由 HTTPS 反代对外提供服务。
- `1420` 仅是内部端口，不是 Windows 客户端要填写的端口。

## 5 配置 systemd 并启动

```bash
cat > /etc/systemd/system/chat3d-team.service <<'EOF'
[Unit]
Description=Chat3D Team Sharing
After=network.target

[Service]
Type=simple
User=chat3d
Group=chat3d
WorkingDirectory=/opt/chat3d/current
EnvironmentFile=/etc/chat3d/team.env
ExecStart=/opt/node24/bin/node /opt/chat3d/current/server/start.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/chat3d

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now chat3d-team
systemctl status chat3d-team --no-pager
journalctl -u chat3d-team -n 50 --no-pager
```

应为 `active (running)`。启动工作目录不能遗漏，否则静态网页文件路径会错误。

验证本机服务：

```bash
curl -I http://127.0.0.1:1420/
curl -i http://127.0.0.1:1420/api/team/me
```

预期：首页 `200`；未登录的 `/api/team/me` 返回 JSON `401`。这里的 401 是正常鉴权行为，说明团队接口存在，不是让你关闭鉴权。返回 404 通常说明团队数据库配置未生效。

## 6 创建团队登录账号

默认没有账号、没有初始密码、没有开放注册。先创建管理员，再创建两个测试成员。账号名使用字母、数字、下划线、点、@ 或连字符；密码 12～256 字符。

下面函数在当前 Bash 中定义，使用标准输入传递密码，不把密码写到命令行参数或历史：

```bash
create_chat3d_user() {
  local account="$1" role="$2" password confirm rc
  [ -n "$account" ] && [ -n "$role" ] || return 1
  read -r -s -p "为 $account 输入密码：" password; printf '\n'
  read -r -s -p '再次输入密码：' confirm; printf '\n'
  [ "$password" = "$confirm" ] || { echo '两次密码不一致'; unset password confirm; return 1; }
  printf '%s' "$password" | runuser -u chat3d -- env \
    CHAT3D_TEAM_DB=/var/lib/chat3d/team.sqlite \
    /opt/node24/bin/node /opt/chat3d/current/server/team/admin.mjs add "$account" "$role"
  rc=$?
  unset password confirm
  return "$rc"
}

create_chat3d_user teamadmin admin
create_chat3d_user member_a member
create_chat3d_user member_b member
```

成功会返回账号 ID、名称和角色，不会返回密码。用户名重复会失败，不要反复创建同名账号。

| 角色 | 能力 |
| --- | --- |
| admin | 查看、复制、发布；可追加任意原件的新版本 |
| member | 查看、复制、发布；只能追加自己的原件版本 |
| viewer | 只读；不能发布 |

禁用账号时使用以下命令，执行后会立即撤销该账号会话。**只在确实需要禁用时执行：**

```bash
runuser -u chat3d -- env CHAT3D_TEAM_DB=/var/lib/chat3d/team.sqlite \
  /opt/node24/bin/node /opt/chat3d/current/server/team/admin.mjs disable member_a
```

0.2.0 暂不提供密码重置和重新启用命令；不要直接改数据库。需要更换时由管理员禁用旧账号并新建不同名称的账号。

## 7 配置 HTTPS 入口

### 7.1 主线使用宿主机 Nginx

已有面板/反向代理的服务器跳到 7.3，不重复安装。裸机按系统选择：

```bash
# Ubuntu / Debian
apt-get install -y nginx
```

```bash
# Rocky / AlmaLinux / RHEL 系
dnf install -y nginx
```

准备真实域名对应的证书和私钥，例如：

```text
/etc/nginx/ssl/chat3d/fullchain.pem
/etc/nginx/ssl/chat3d/privkey.pem
```

这是你放置有效证书的目标路径，部署包不包含证书。私钥需限制读取权限。证书应包含完整链，且域名匹配；确认续期由谁负责。没有可信证书时，先完成证书配置再做跨电脑桌面验收，不使用 `curl -k` 或关闭客户端 TLS 校验。

新建 `/etc/nginx/conf.d/chat3d.conf`，替换域名和证书路径：

```nginx
server {
    listen 443 ssl;
    server_name chat3d.example.com;

    ssl_certificate     /etc/nginx/ssl/chat3d/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/chat3d/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 512m;

    # 本手册仅开放团队共享，不把模型代理/Blender 变为公共接口。
    location ^~ /api/model/ { return 403; }
    location ^~ /api/blender/ { return 403; }

    location / {
        proxy_pass http://127.0.0.1:1420;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

本配置不占用 80 端口，也不改动其他站点。确认 Nginx 主配置包含 `conf.d/*.conf`，且没有重复域名站点后执行：

```bash
nginx -t
systemctl enable --now nginx
systemctl reload nginx
```

只有 `nginx -t` 成功才重新加载。Node 启动日志可能显示 `model proxy enabled`，本手册仍在 HTTPS 入口明确拦截相关路径。此限制不代替公司网络访问控制；共享服务建议只对公司内网/VPN 提供。

### 7.2 网络与证书检查

- 域名在所有客户端上解析到正确服务器地址。
- 公司防火墙/云安全组仅按实际使用范围允许 TCP 443；不要对公网开放 1420。
- 保留已有 SSH 管理规则，不为本应用关闭防火墙或 SELinux。
- 采用内网域名解析时，证书仍需匹配域名并被客户端信任。可由管理员通过已有证书平台或 DNS 验证签发。

从客户端能访问的网络测试：

```bash
curl -I https://chat3d.example.com/
curl -i https://chat3d.example.com/api/team/me
curl -i -X OPTIONS https://chat3d.example.com/api/team/login \
  -H 'Origin: http://tauri.localhost' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

预期依次是 `200`、JSON `401`、`204`。预检响应应包含对应的 `Access-Control-Allow-Origin`。这些检查不登录、不提交密码。

### 7.3 已有 1Panel 或宝塔

复用面板中已有的 HTTPS 网站/反代，证书、域名、512 MiB 请求体上限（`client_max_body_size 512m`）和 60 秒超时与上述一致。面板菜单名称随版本不同，不照搬其他版本截图。

**重点：** 面板 Nginx/OpenResty 若在容器中，容器内 `127.0.0.1` 并不是宿主机。不要盲目填写 `127.0.0.1:1420`，也不要为图省事把 Node 改为 `0.0.0.0` 并公网开放。先由管理员确认实际网络拓扑，配置受限的容器到宿主机连接，或采用统一的同网络部署。该分支需要根据现有面板确认网络配置，不能直接当成主线已完成。

## 8 Windows 客户端连接

1. 安装配套 `Chat3D_0.2.0_x64-setup.exe`，升级前先备份已有本地数据。此版本安装包尚未签名，按公司软件准入流程处理，不关闭系统安全防护。
2. 点击顶部导航 **团队**（浏览器用户可打开 `https://你的真实域名/team/`）。
3. 服务地址填写 `https://你的真实域名`，不加 `/api/team`、`/manage` 或 `:1420`。
4. 使用第 6 节创建的团队账号登录。模型 API Key 不是团队登录账号。
5. 第二台电脑使用另一个成员账号连接同一地址。

此版桌面客户端使用标准 HTTPS 443；本机 HTTP 80 仅用于本机测试，不作为跨电脑生产部署方案。登录会话仅保存在内存中，关闭库页面/应用后需要重新登录，服务端会话最长 8 小时。

## 9 最小验收清单

先使用无敏感信息的测试资产和场景，无需真实收费模型：

- [ ] 本机服务、HTTPS 首页和接口检查通过。
- [ ] 两台电脑、两个成员账号都能登录。
- [ ] A 的未发布草稿不会出现在 B 的团队库。
- [ ] A 选择性发布后，B 能搜索、预览并复制。
- [ ] B 修改本地副本，不改变 A 原件。
- [ ] A 发布新版本，不会自动改坏 B 已复制的旧场景。
- [ ] 普通成员不能更新其他人的原件；viewer 不能发布。
- [ ] 重启服务后共享数据仍存在。
- [ ] 发布遇到网络失败先刷新核对，再使用“重试同一次发布”，不重复创建。

以上通过只表示团队共享闭环可用，不代表真实 GPU、大场景生成质量、模型费用或 MES/WMS 对接已经验收。

## 10 日常运维

```bash
systemctl status chat3d-team --no-pager
journalctl -u chat3d-team -n 100 --no-pager
systemctl restart chat3d-team
```

只修改 `/etc/chat3d/team.env` 后需重启应用；修改 systemd 文件还需先 `systemctl daemon-reload`。分享日志前遮蔽公司域名、账号及敏感业务内容，不发送密码或会话令牌。

### 停机备份

安排维护窗口，确认没有正在发布，再停止服务。完整备份持久数据目录，不只复制在线写入中的单个 sqlite 文件。

```bash
install -d -m 0700 /var/backups/chat3d
STAMP=$(date +%Y%m%d-%H%M%S)
systemctl stop chat3d-team
tar -czf "/var/backups/chat3d/data-$STAMP.tar.gz" -C /var/lib chat3d
chmod 0600 "/var/backups/chat3d/data-$STAMP.tar.gz"
systemctl start chat3d-team
systemctl status chat3d-team --no-pager
```

若备份失败，先记录失败原因并恢复服务，不把损坏备份当作成功。另行保管运行配置、部署包及 Node 版本记录；证书私钥单独受控备份。数据库备份含密码哈希和会话信息，应按内部敏感数据保管，避免同步到公开文件夹。

### 恢复与升级

恢复前停服务，并将当前数据目录改名保留，不直接覆盖唯一副本。在维护窗口解压完整备份回 `/var/lib/chat3d`，确认所属 `chat3d:chat3d`、目录权限 0700 后启动，再完成双账号检查。

更新代码时解压到新的 `/opt/chat3d/releases/版本目录`，先备份数据库，再在停机时切换 `current` 链接。**不要覆盖或清空 `/var/lib/chat3d`。** 若新版本修改数据库结构，回退旧程序前须确认兼容性；必要时连同升级前数据库一并恢复，不能只回退程序。

## 11 常见问题

| 现象 | 检查和处理 |
| --- | --- |
| `node:sqlite` 不存在 | 确认使用 `/opt/node24/bin/node`，不是系统旧 Node |
| systemd `203/EXEC` | Node 路径错误、二进制不兼容或不可执行；检查架构、权限和 glibc |
| 首页或静态文件 404 | 确认 `WorkingDirectory=/opt/chat3d/current` 和 `dist` 完整 |
| `/api/team/me` 返回 404 | 确认 `CHAT3D_TEAM_DB` 配置存在并已重启服务 |
| 未登录 `/api/team/me` 返回 401 | 预期行为；不要为了消除 401 关闭认证 |
| 客户端 403 来源不允许 | 核对 Origin 与白名单精确一致，不使用通配符 |
| 客户端无法连自定义端口 | 使用 HTTPS 443 根地址，不填 Node 的 1420 |
| 证书错误 | 检查域名、链、有效期与设备信任；不要使用跳过校验选项 |
| 502 | 检查 Node 状态、反代目标、是否存在容器网络隔离；SELinux 系统查审计拒绝，由管理员按策略配置而非关闭 SELinux |
| 发布 413 | 检查反代是否配置 `client_max_body_size 512m`；服务端 HTTP 请求体上限为 500 MiB，团队格式校验上限为 500 MiB，模型过大须缩减，不能只无限增大代理限制 |
| 数据库权限错误 | 数据目录须由 chat3d 可写；只给数据目录权限，不全盘 chmod 777 |
| 账号无法登录 | 账号名/角色/密码核对；连续失败会触发限流，不反复尝试；不要把密码发出来排查 |
| 重启后数据消失 | 检查是否换了数据库路径、用了临时磁盘，或错误启动了另一实例 |
| 安装包能打开但看不到同事资产 | 确认同一团队地址，且资产已明确发布；安装客户端不等于部署共享服务 |
| 网页模型请求 403 | 本手册主动关闭外部模型代理；共享验收不需要它，模型代理接入另行评估 |

## 12 本版本边界与来源

本包为 0.2.0、来源提交 `4c16cad2bbfc15c54b9e4e00da65b472bf6196eb`，不是后续 main 合并提交的重新打包。只支持单团队、单进程；不是实时协同编辑、多租户、SSO 或在线账号管理系统。完整 Docker 冷构建、公司实际 HTTPS 环境和用户 GPU 尚未完成验收；已有依赖安全告警仍需在正式上线前复核。

本文已核对实际包结构、启动程序、账号 CLI 和接口路径；未在你的服务器执行部署，不保证未知发行版/面板网络可直接照搬。先做内部试用和备份恢复验证，再决定正式上线。

参考：
- [Scenivo 团队共享部署与使用说明](https://github.com/WangZai6936/chat3d/blob/main/docs/TEAM-SHARING.md)
- 部署包内 `README-RUNTIME.txt`、`DEPLOYMENT.md`、`SOURCE-COMMIT.txt`
- [Node.js 24.22.1 官方发布与下载](https://nodejs.org/en/blog/release/v24.22.1)
- [Nginx 反向代理指令](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Nginx 请求体大小等核心指令](https://nginx.org/en/docs/http/ngx_http_core_module.html)
