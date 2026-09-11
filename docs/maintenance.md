# 维护手册

## 常用命令

先进入项目目录；当前测试机使用 `ssh -p 2222 root@127.0.0.1` 和 `cd /root/RoomGap`。

| 操作 | 命令 |
| --- | --- |
| 查看定时任务 | `crontab -l` |
| 查看运行进程 | `pgrep -af 'node collect-api.mjs'` |
| 新安装的日志 | `tail -f logs/collect.log` |
| 当前测试机定时日志 | `tail -f /var/log/roomgap-collect.log` |
| 当前测试机手动日志 | `tail -f /var/log/roomgap-collect-manual.log` |
| 补齐缺失数据 | `./run-collect.sh` |
| 刷新所有已有排课 | `ROOMGAP_REFRESH=1 ./run-collect.sh` |
| 校验数据 | `node verify-dataset.mjs` |
| 构建网站 | `node scripts/build-site.mjs` |

当前测试机单独执行 Node 命令时，可先 `export PATH=/opt/node20/bin:$PATH`；入口脚本已有此兼容设置。

## 判断是否完成

```bash
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("data/semester/manifest.json"));const c=JSON.parse(fs.readFileSync("data/dataset/coverage.json"));console.log({complete:m.complete,completed:m.completedQueries,expected:m.expectedQueries,failures:m.failures.length,datasetComplete:c.complete,unknown:c.unknownRoomDays,lastCapture:c.lastCapture})'
```

采集 manifest 的 `complete=true` 只代表原始查询完整。`node verify-dataset.mjs` 成功才表示查询数据也通过校验。`lastCapture` 是 UTC 字符串，网页显示时转为北京时间。

## 抓取成功，构建失败

例如 `Cannot find module .../semester-model.mjs` 是部署文件缺失，不需要重抓。补齐同一版本完整代码后依次运行：

```bash
node build-dataset.mjs
node verify-dataset.mjs
```

本次新增的依赖预检会在大批抓取前发现共享模块缺失。`semester-model.mjs` 是计算占用节次和空闲区间的运行依赖，不应删除。

## 网络、登录或中途中断

先检查日志中 `FAILED` 的原因。无头模式遇到登录页会立即退出并要求更新 Cookie；按 [登录态维护](login.md) 完成后重启任务。

对首次采集留下的缺失文件，使用默认模式补齐即可。若在 `ROOMGAP_REFRESH=1` 刷新期间中断，已有文件可能是新旧时间的混合；默认续采只检查完整性，不会重新查询仍完整的旧文件。要求本轮全量新鲜时，再执行一次完整刷新，并核对 `firstCapture` / `lastCapture`。

不要在同一目录并行构建、更新代码、导入数据和采集。需要停止后台任务时先确认具体进程号，只终止对应任务；中止后检查进程是否退出，再继续操作。

## 磁盘与日志

```bash
df -h .
free -h
du -sh data node_modules dist .roomgap-browser logs 2>/dev/null
```

2026-09-11 检查时，测试机根分区剩余约 49 MB。出现 `ENOSPC` 时先处理空间；不要删除原始快照、浏览器配置或 Cookie 来碰运气。可以清理确认过的传输临时包、过期日志和可重建的 `dist`，对外托管使用中的目录须先确认。

按实际账号和日志路径修改 [logrotate 示例](../deploy/roomgap.logrotate.example)，由管理员安装到 `/etc/logrotate.d/roomgap`。先用 `logrotate -d /etc/logrotate.d/roomgap` 检查配置。它每周轮转、保留 4 份压缩日志，`copytruncate` 适合仍在写入的后台脚本，但轮转瞬间可能丢少量日志。

## 备份与升级

| 内容 | 处理方式 |
| --- | --- |
| 已提交的代码、`data/semester`、`data/dataset` | 可通过 Git 历史恢复；重要刷新前另存快照 |
| `.roomgap-auth.json`、`.roomgap-browser/`、`~/.config/roomgap.env` | 私下保管，不纳入网站或公共备份 |
| `dist/`、`node_modules/`、测试截图 | 可重建 |

完整 Git 安装应先停止并确认采集退出，提交或备份本地数据改动，再 `git pull --ff-only`、`npm ci`、运行测试与数据校验。不要用强制重置解决本地数据冲突。

原始记录虽然数量较多，但用于重新生成和复核网站数据，属于项目交付的一部分。过期的手写 `collection-status.json` 已删除，统一以自动生成的 manifest 和 coverage 为准。

## 网站时间不更新

依次检查是否使用完整刷新、生成数据是否通过校验、最新数据是否已经发布、线上 `dataset.json` 是否指向新版本。完整流程见 [网站部署](deployment.md)。采集通知、Git 提交成功与线上部署成功是不同状态。
