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

2026-09-22 将服务器采集改为直接 HTTP 后，测试机不再需要 Chromium。卸载 Chromium 及仅由它引入的图形依赖、清理 8 MiB 归档日志和未运行的可再下载 Cursor 远程缓存后，3.3 GB 根分区的可用空间从 178 MiB 增至约 800 MiB，使用率从 95% 降至 75%。Avahi/mDNS 被明确保留，`openstick.lan` 不受影响。

APT 查询不会再写回两个大型二进制缓存。完整采集仍需以 `manifest.json`、覆盖校验和最终 `SUCCESS` 为准。原服务器采集入口备份在 `/root/.local/share/roomgap-backups/run-collect.YKWmvs.sh`；新增的系统配置可按下述文件路径检查和撤销，恢复 journald 策略后需重启该服务。已按保留策略清理的历史系统日志无法恢复；Cursor 远程缓存可在下次使用时自动下载。

当前小磁盘方案分三层：

1. [APT 配置](../deploy/roomgap-apt-cache.conf) 禁止持久化二进制索引缓存，并关闭安装包保留；软件源列表和已安装软件保留。`apt-get clean` 只清理下载缓存。
2. [journald 配置](../deploy/roomgap-journald.conf) 将系统日志目标占用设为 16 MiB、单文件 4 MiB、最长 7 天。它是全机日志策略，清理的旧日志无法恢复。
3. 采集入口在采集、构建、Git 推送前检查至少 128 MiB 可用空间；低于阈值时退出并通过 Bark 报告容量。可单独运行 `node scripts/check-space.mjs` 检查，不访问学校或推送数据。

采集日志单独维护：测试机未安装 logrotate，使用无额外依赖的 `scripts/rotate-logs.mjs`，每小时检查两个采集日志，达到 1 MiB 时压缩轮转，每个保留最近 3 份。配置参考 [小时任务](../deploy/roomgap-log-maintenance.cron.example)，安装到 `/etc/cron.d/roomgap-log-maintenance`。这只是日志维护任务，不会额外触发采集。

常规服务器也可使用 [logrotate 示例](../deploy/roomgap.logrotate.example)：每天检查，超过 1 MiB 可提前轮转，保留 3 份。两种方法选一种，避免重复轮转。两者均采用复制后截断，适合仍持有文件描述符的后台脚本；轮转瞬间可能丢少量新增日志，小时检查也不是日志体积的严格实时上限。

管理员在完整 checkout 中安装系统配置的示例（先备份已有同名文件）：

```bash
install -d -m 755 /etc/systemd/journald.conf.d
install -m 644 deploy/roomgap-apt-cache.conf /etc/apt/apt.conf.d/99roomgap-small-disk
install -m 644 deploy/roomgap-journald.conf /etc/systemd/journald.conf.d/zz-roomgap-storage.conf
# 按实际用户、Node 与项目路径编辑小时任务后，再安装。
install -m 644 deploy/roomgap-log-maintenance.cron.example /etc/cron.d/roomgap-log-maintenance
systemctl restart systemd-journald
journalctl --rotate
journalctl --vacuum-size=16M --vacuum-time=7d
journalctl --disk-usage
```

手动验证项目日志维护（小日志不会改变）：

```bash
flock -n .roomgap-logrotate.lock node scripts/rotate-logs.mjs /var/log/roomgap-collect.log /var/log/roomgap-collect-manual.log
```

网站构建保留在 PC、GitHub CI 或 Cloudflare，采集机只保留当前学期的原始数据和查询数据，不积攒压缩包与多份 `dist`。需要长期历史时在有足够空间的维护机备份，避免在小设备上自动保存无限版本。

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
