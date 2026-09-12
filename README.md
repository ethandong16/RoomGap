# RoomGap · 空闲教室

[![CI](https://github.com/ethandong16/RoomGap/actions/workflows/ci.yml/badge.svg)](https://github.com/ethandong16/RoomGap/actions/workflows/ci.yml)

面向天津科技大学同学的空闲教室查询网站。按日期、校区、楼栋和节次查找整段空闲的教室，查看全天安排。静态网站无需访客登录；维护者通过学校网络定期采集排课快照。

## 功能

- 手机与桌面布局、深浅主题、键盘操作、容量和名称筛选。
- 支持连续或不连续节次；未知数据不计为空闲。
- 按日期加载数据，使用目录摘要和版本目录避免新旧数据混用。
- Chromium / Playwright 获取查询参数与会话，随后通过接口完成逐楼逐日采集。
- Linux 无头采集、断点恢复、任务互斥和可选 Bark 通知。

## 快速开始

安装 [Node.js](https://nodejs.org/) 22 或 24 LTS（最低 20），然后：

```bash
git clone https://github.com/ethandong16/RoomGap.git
cd RoomGap
node scripts/build-site.mjs
node scripts/serve-site.mjs
```

打开 <http://127.0.0.1:4173>。预览服务监听 `0.0.0.0:4173`，局域网设备也可访问。仓库包含可直接构建的完整数据快照；只运行网站无需安装 Playwright，也无需登录学校系统。

### Cloudflare 使用观测

生产网站的匿名使用观测由 Cloudflare Pages Functions 写入 D1，管理界面位于部署后的 `/admin.html`。配置 D1 绑定和 `ANALYTICS_ADMIN_TOKEN` 后，维护者输入令牌即可查看访问次数、匿名会话、查询趋势、热门条件和最近事件，完整步骤见[网站部署](docs/deployment.md#cloudflare-pages-functions--d1-观测)。

本地 `node scripts/serve-site.mjs` 只提供查询网站的静态预览，不提供观测页面或 API，也不会保存或读取使用统计。前台只上报页面访问、查询、教室详情和主题切换，不保存 IP、User-Agent、账号或联系方式。

需要采集、登录桥接或开发时执行 `npm ci`。Windows 可用 `./run-web.ps1` 一键构建并预览。

## 安装与维护

| 任务 | 文档 |
| --- | --- |
| 安装环境、Linux 首次部署 | [安装指南](docs/installation.md) |
| Cloudflare Pages、其他静态托管、更新数据 | [网站部署](docs/deployment.md) |
| 手动刷新、cron、Bark、参数 | [Linux 自动采集](docs/collection.md) |
| PC 登录并通过 SSH 更新 Linux Cookie | [登录态维护](docs/login.md) |
| 日志、故障恢复、磁盘、备份 | [维护手册](docs/maintenance.md) |
| 字段、节次掩码、数据复核 | [数据格式](docs/data-format.md) |
| 开发与验证 | [贡献指南](CONTRIBUTING.md) |

## 数据如何到达网站

```text
学校查询 → collect-api.mjs → data/semester/（原始快照）
         → build-dataset.mjs + semester-model.mjs → data/dataset/（查询数据）
         → verify-dataset.mjs → scripts/build-site.mjs → dist/ → 静态托管
```

`run-collect.sh` 完成采集、数据构建和校验。默认不提交或推送；完整 Git 安装可选择 `ROOMGAP_GIT_PUSH=1` 自动提交数据并推送 `main`，触发已配置的 Cloudflare Pages Git 部署。Bark 的“采集完成”或“数据已推送”不表示网站已经发布。

网站底部的更新时间取自 `coverage.lastCapture`，按北京时间显示；仅重新构建网页不会改变实际采集时间。

## 项目结构

```text
site/                 网页源码
functions/            Cloudflare Pages Functions 观测接口
migrations/           D1 数据库迁移
scripts/              静态网站构建与预览
data/semester/        可复核、可重建的原始快照
data/dataset/         网站使用的完整快照
deploy/               配置、cron、日志轮转示例
docs/                 安装、部署、登录和维护文档
tests/                查询、数据、服务与采集入口测试
collect-api.mjs       采集器
semester-model.mjs    占用节次与空闲区间计算
run-collect.sh        Linux 采集入口
run-collect.ps1       Windows 采集入口
```

## 数据范围

当前采集器适配 **2026-08-31 至 2027-01-17** 的 20 周学期、第 1–13 节。教室数量和日期以 [覆盖报告](data/dataset/coverage.json) 为准，换学期需重新适配并验证。仓库中的原始快照不含课程名称、教师、学生信息或登录凭据。

本项目不是学校官方服务。排课快照需要随调课、考试和借用变更更新；无已记录占用不代表教室实际开放或允许自习。安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 许可证

代码与文档采用 [MIT License](LICENSE)。学校来源数据的原有权利和使用条件不因代码许可而改变。
