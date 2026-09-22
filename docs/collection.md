# Linux 自动采集

请先完成 [安装](installation.md) 和 [登录](login.md)。Linux 要能通过校园网络或 VPN 访问教务系统；访问网站的同学不需要这些条件。

## 手动执行

在项目目录运行（当前测试机是 `/root/RoomGap`）。默认完整刷新，会重新查询全部楼栋日数据，以便纳入最新调课、考试和借用安排：

```bash
./run-collect.sh
```

仅在上一次采集被中断、需要复用已有完整快照时，显式使用断点续采：

```bash
ROOMGAP_REFRESH=0 ./run-collect.sh
```

要在断开 SSH 后继续执行，可以保存到项目日志目录：

```bash
mkdir -p logs
nohup ./run-collect.sh >> logs/collect.log 2>&1 </dev/null &
echo $!
tail -f logs/collect.log
```

`Ctrl+C` 结束 `tail -f` 只退出日志查看。入口使用 `flock` 阻止同一 checkout 的重复采集；锁文件可以保留，进程退出后内核会自动释放锁。直接运行 `node collect-api.mjs` 会绕过该保护，因此日常运维使用入口脚本。

## 运行过程与成功条件

1. 读取配置、检查 Node / 构建依赖，获取任务锁。
2. 使用登录 Cookie 直接通过 HTTP 读取教学楼目录、查询表单和元数据；登录失效时停止并要求重新扫码。
3. HTTP 会话抓取逐楼逐日数据；并发 3，请求启动间隔约 100 ms，单请求超时 30 秒，最多尝试 3 次。
4. `build-dataset.mjs` 调用 `semester-model.mjs` 计算节次状态。
5. `verify-dataset.mjs` 验证覆盖、目录摘要及未知状态。
6. 若设置 `ROOMGAP_GIT_PUSH=1`，提交数据并推送 GitHub；全部成功后输出 `SUCCESS`。

`FINISHED {"complete":true,...}` 只说明第 3 步完成，后面的构建或校验仍可能失败。最终以退出码 0、`"verified":true` 和 `SUCCESS` 为准。

采集、数据构建、可选 Git 推送前会检查可用空间，默认至少 **128 MiB**（`ROOMGAP_MIN_FREE_MB`）。不足时退出，日志和 Bark 失败通知带有 `DISK_LOW`、当前容量和阈值；不会为了继续运行而删除原始数据。该检查在阶段边界执行，不会阻止其他程序在运行中占用磁盘。

脚本输出 `data/semester/manifest.json` 和 `data/dataset/coverage.json`；没有 `data/dataset/manifest.json`。运行失败时保留已完成的查询文件，便于排查和恢复。

## 定时刷新

建议每周刷新一次；开学、考试安排变化期间可以增加手动刷新。即使常规课程固定，调课和临时借用仍会变化。

用 `crontab -e` **添加或编辑对应条目**，保留其他任务。不要直接用示例覆盖整份 crontab。假设项目路径为 `/home/roomgap/RoomGap`，先创建 `logs/`：

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
0 3 * * 0 cd /home/roomgap/RoomGap && ./run-collect.sh >> /home/roomgap/RoomGap/logs/collect.log 2>&1
```

这是服务器本地时间每周日 03:00。用 `date '+%F %T %Z %z'` 检查时区；需要北京时间时由管理员配置 `Asia/Shanghai`。cron 的 PATH 与交互式终端不同，Node 安装在非标准路径时，把完整 PATH 写入配置文件。

```bash
crontab -l
systemctl status cron --no-pager
```

[cron 示例](../deploy/roomgap.cron.example) 与 [日志轮转示例](../deploy/roomgap.logrotate.example) 可按实际账号和路径修改。

2026-09-11 检查到的**现有测试机**条目仍为：

```cron
0 3 * * 0 cd /root/RoomGap && ./run-collect.sh >> /var/log/roomgap-collect.log 2>&1
```

当前入口默认完整刷新，因此这条配置会更新已有排课。旧版本入口仍需显式添加 `ROOMGAP_REFRESH=1`。

## Bark 通知

复制 [配置示例](../deploy/roomgap.env.example) 到运行账号的 `~/.config/roomgap.env`，编辑并设置权限 `600`：

```bash
chmod 600 "$HOME/.config/roomgap.env"
```

文件内容示例（替换成自己的 Key）：

```bash
ROOMGAP_BARK_URL='https://api.day.app/YOUR_DEVICE_KEY'
```

使用设备基础 URL，不需要示例中的 `/Body`。空值或未配置时不推送。正常发送开始和校验完成通知；失败通知注明具体阶段。Bark 不可达会记录警告，不改变采集结果。仅安装本项目不会自动创建网站发布任务。

测试通知（会向配置设备发送一条消息）：

```bash
. "$HOME/.config/roomgap.env"
curl -fsS --max-time 10 -G \
  --data-urlencode 'title=RoomGap 配置测试' \
  --data-urlencode 'body=Bark 通知已配置' "$ROOMGAP_BARK_URL"
```

## 配置项

| 变量 | 默认 / 作用 |
| --- | --- |
| `ROOMGAP_CONFIG` | 默认 `$XDG_CONFIG_HOME/roomgap.env`，未设 XDG 时为 `$HOME/.config/roomgap.env` |
| `ROOMGAP_REFRESH` | 默认 `1`，重新查询全部楼栋日；设为 `0` 时复用已有完整数据以断点续采 |
| `ROOMGAP_MIN_FREE_MB` | 默认 `128`，单位 MiB；必须为正整数，空间不足时停止任务 |
| `ROOMGAP_COOKIES_FILE` | 自动使用项目根目录 `.roomgap-auth.json`（若存在） |
| `ROOMGAP_BARK_URL` | Bark 设备 URL；不要提交真实 Key |
| `ROOMGAP_GIT_PUSH` | 默认 `0`；`1` 在校验后提交两个数据目录并推送 `origin/main`，需先完成 [自动发布配置](deployment.md#可选linux-采集后自动推送) |

环境配置会覆盖同名命令行变量；因此示例中不设置 `ROOMGAP_REFRESH`。Windows 入口默认完整刷新，使用 `-Resume` 才会断点续采；它不读取 Linux 的 Bash 配置文件，也不提供 `flock` 或 Bark，不要同时启动多份 Windows 采集器。

## 换学期

当前采集器明确校验 2026-08-31 开课、20 周，并使用固定 140 天范围；构建、验证及部分测试也对应这个范围。遇到 `Official term differs from requested range` 时停止发布，先归档旧学期数据，再修改采集日期、范围及相关测试。它不会自动适配未知学期。
