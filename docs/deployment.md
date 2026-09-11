# 网站部署与数据发布

## 构建

```bash
node scripts/build-site.mjs
```

构建先执行完整性校验，成功后生成 `dist/`。只对外发布这个目录中的文件。学校 Cookie、浏览器配置、采集代码和原始记录不属于部署包。

每次构建依据内容生成版本目录 `data/<version>/`；`dataset.json` 指向当前版本。构建失败时不要发布中间产物。重新构建会替换本地 `dist/`，请使用独立托管环境对外服务。

## Cloudflare Pages：Git 集成

在 Cloudflare Pages 创建项目并连接本仓库，使用：

| 设置 | 值 |
| --- | --- |
| 生产分支 | `main`（或你选择的部署分支） |
| 框架预设 | None |
| 根目录 | 仓库根目录 |
| 构建命令 | `node scripts/build-site.mjs` |
| 输出目录 | `dist` |
| Node.js 环境变量 | `NODE_VERSION=22` |

首次保存后检查构建日志。后续推送到绑定分支会触发新部署；只有 Pages 的构建和发布都成功，网站才会变化。GitHub CI 负责验证和提供可下载的静态产物，本项目的 CI 不会直接发布网站。

## 其他 HTTPS 静态托管

整体上传 `dist/` 内的网页、脚本、`dataset.json` 和 `data/`。支持根路径和子目录，无需 SPA 路由重写。`.mjs` 须作为 JavaScript 提供。

HTML、脚本、样式和 `dataset.json` 使用 `Cache-Control: no-cache`；版本目录 `/data/*` 可使用长期缓存。生成的 `_headers` 适用于支持该格式的托管平台，其他平台请配置等价规则。

优先使用平台的原子部署。手工上传时先上传新数据版本目录及网页文件，最后上传 `dataset.json`；保留旧版本数据供已打开的网页使用。HTTPS 或 localhost 可直接使用浏览器摘要 API，项目也提供普通局域网 HTTP 的摘要校验回退。

## 采集机的数据如何发布

`./run-collect.sh` 默认只采集并校验；设置 `ROOMGAP_GIT_PUSH=1` 才会自动提交数据和推送 GitHub，见下面的自动发布配置。它不会直接上传托管平台。成功后，先确认日志末尾有 `SUCCESS` 和 `"verified":true`。

如果 Linux 本身是完整 Git checkout，可以在确认没有采集进程后执行：

```bash
node verify-dataset.mjs
git status --short
git add data/semester data/dataset
git diff --cached --stat
git commit -m "Update verified classroom snapshot"
git push origin main
```

如果 Linux 采用文件复制部署、没有完整 Git checkout，先打包指定数据目录（无登录凭据）。以下使用现有测试机的连接地址和项目路径：

```bash
cd /root/RoomGap
tar -czf /tmp/roomgap-data.tar.gz data/semester data/dataset
```

然后在 **PC 的 RoomGap 仓库目录**执行以下 PowerShell 命令。导入会替换本机相同日期的数据，先确认本机改动已提交或备份：

```powershell
git pull --ff-only
New-Item -ItemType Directory -Force artifacts | Out-Null
scp -P 2222 root@127.0.0.1:/tmp/roomgap-data.tar.gz artifacts/roomgap-data.tar.gz
tar -tzf artifacts/roomgap-data.tar.gz
# 确认包中只有 data/semester/ 与 data/dataset/ 后导入。
tar -xzf artifacts/roomgap-data.tar.gz
node verify-dataset.mjs
node scripts/build-site.mjs
git add data/semester data/dataset
git diff --cached --stat
git commit -m "Update verified classroom snapshot"
git push origin main
```

每条验证命令都必须成功才继续。推送后查看托管平台部署状态；不要把“采集完成”或“Git 推送成功”当成线上发布成功。

## 网站底部的时间

页面显示 `data/dataset/coverage.json` 中的 `lastCapture`，转换为北京时间。它是本包内最晚一条采集记录的时间；最早时间是 `firstCapture`，断点续采可能产生跨度较大的采集区间。

仅重新生成 `dist` 不会改变采集时间。日期未更新时，依次核对采集是否刷新了已有记录、新数据是否提交到部署分支、部署是否成功，以及线上 `dataset.json` 是否指向新版本。

## 可选：Linux 采集后自动推送

这一模式适合独立的维护 checkout。必须满足：完整 Git 仓库、当前分支为 `main`、`origin` 指向你的目标仓库、暂存区为空，运行账号已设置 Git 姓名邮箱及无需交互的推送认证。不要在这个 checkout 中同时暂存开发改动。

```bash
git branch --show-current
git remote -v
git status --short
git config user.name '你的名字'
git config user.email '你的 GitHub 提交邮箱'
git push --dry-run origin main
```

服务器使用仅供该仓库的推送凭据，例如具有写权限的 SSH deploy key；在 GitHub 仓库配置相应公钥，私钥仅留服务器并核对 GitHub 主机指纹。不要把令牌放进远程 URL 或配置示例。dry-run 应无需密码询问且成功，之后在 `~/.config/roomgap.env` 加入：

```bash
ROOMGAP_GIT_PUSH=1
```

配合 cron 中的 `ROOMGAP_REFRESH=1`，流程是：刷新 → 构建 → 校验 → 仅提交 `data/semester`、`data/dataset` → 推送 `main` → 托管平台自动构建。脚本会在采集前检查仓库、分支、提交身份和暂存区；不会帮你解决非快进冲突或绕过分支保护。

推送失败时数据和本地提交保留，日志标注 `GitHub 推送` 阶段失败。修好网络、认证或分支同步后，可直接 `git push origin main` 重试，无需再抓取。脚本没有接入托管平台部署状态查询，因此 Bark 只确认数据已推送。
