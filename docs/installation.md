# 安装指南

## 环境要求

| 用途 | 要求 |
| --- | --- |
| 网站构建、预览、数据校验 | Node.js 20+；新部署推荐 22 / 24 LTS |
| 数据采集 | 上述环境 + `npm ci` + Chromium 或 Chrome + 可访问教务系统的网络 |
| Linux 自动采集 | Bash、`flock`（util-linux）、cron；Bark 另需 curl |
| PC 登录桥接 | Windows PowerShell、Chrome、OpenSSH、学校账号 |

仓库的 `package-lock.json` 固定依赖版本。请使用 `npm ci`，不要从其他机器直接复制 `node_modules`。

## 只运行网站

```bash
git clone https://github.com/ethandong16/RoomGap.git
cd RoomGap
node scripts/build-site.mjs
node scripts/serve-site.mjs
```

打开 <http://127.0.0.1:4173>。构建会先校验数据，输出到 `dist/`。预览服务只提供 `dist`，不能代替生产环境的 HTTPS 托管。端口用 `ROOMGAP_PORT` 指定，Windows 也可使用 `./run-web.ps1 -Port 4174`。

## Debian / Ubuntu 采集机

以下是管理员安装系统依赖的示例。系统必须使用与当前发行版一致的软件源；Ubuntu 的 Chromium 包可能通过 Snap 提供，请确认实际浏览器路径。

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl chromium cron util-linux logrotate
sudo systemctl enable --now cron
```

通过 [Node.js 官方下载](https://nodejs.org/en/download) 安装适合 CPU 架构的 LTS 版本（ARM64 使用 arm64）。系统仓库中的 Node 版本若低于 20 不可用。安装后确认：

```bash
uname -m
node --version
npm --version
chromium --version
command -v node
command -v flock
df -h .
free -h
date '+%F %T %Z %z'
```

Chromium 启动需要较多内存；小设备可配置 swap，并预留充足磁盘空间用于依赖、浏览器配置、数据和构建产物。当前测试机的低剩余空间不应作为推荐安装规格。

使用一个有项目写权限的普通账号运行采集更合适。以下以项目路径 `/home/roomgap/RoomGap` 为例，替换成你的实际账号路径：

```bash
git clone https://github.com/ethandong16/RoomGap.git /home/roomgap/RoomGap
cd /home/roomgap/RoomGap
npm ci
chmod +x run-collect.sh
mkdir -p logs
install -d -m 700 "$HOME/.config"
install -m 600 deploy/roomgap.env.example "$HOME/.config/roomgap.env"
```

配置文件已有内容时，直接编辑它，避免覆盖现有 Bark Key。脚本默认读取当前用户的 `~/.config/roomgap.env`；也可以通过 `ROOMGAP_CONFIG` 指定另一个文件。配置是 Bash 语法，文件内赋值会覆盖同名环境变量。

脚本会自动发现系统的 `chromium`、`chromium-browser` 或 `google-chrome`。也可以设置 `ROOMGAP_BROWSER_EXECUTABLE` 为完整路径；若使用 Playwright 自带浏览器，则需自行执行 `npx playwright install --with-deps chromium`，小磁盘设备优先复用系统 Chromium。

## 登录和首次验证

1. 确保 Linux 能访问学校教务系统（校园网络或有效 VPN）。
2. 按 [登录态维护](login.md) 在 PC 登录，并上传 `.roomgap-auth.json`。
3. 在 Linux 执行 `./run-collect.sh`，先验证登录和已有数据。
4. 需要更新仓库中的旧快照时执行 `ROOMGAP_REFRESH=1 ./run-collect.sh`。
5. 首次完整运行成功后，再按 [自动采集](collection.md) 安装 cron。

必须部署完整仓库，包含 `semester-model.mjs`。只复制采集器和构建脚本会缺少依赖。Linux 入口现在会在采集前检查这些文件。

## 本项目现有测试机

当前连接方式是 `ssh -p 2222 root@127.0.0.1`，项目位于 `/root/RoomGap`，ARM64，Chromium 位于 `/usr/bin/chromium`，Node 20 位于 `/opt/node20/bin`。入口保留了这一路径的兼容逻辑。配置文件为 `/root/.config/roomgap.env`，密码、Cookie 和 Bark Key 不写入仓库。

这台机器最初按文件复制方式部署，后来加入 Git 自动推送。仅存在 `.git` 不代表网站源码、文档和依赖已经部署齐全；升级时对照完整仓库核对文件，尤其是 `semester-model.mjs`。保留现有数据和登录态；需要重新部署时可先备份，再将完整仓库安装到新目录。不要在正在采集的目录中覆盖代码或数据。
