# RoomGap 维护手册

## 日常查看

采集任务在远程 Linux 机器 `/root/RoomGap` 后台运行。查看定时任务和日志：

```bash
crontab -l
tail -f /var/log/roomgap-collect.log
tail -f /var/log/roomgap-collect-manual.log
ps -ef | grep -E '[n]ode|[r]un-collect'
```

当前定时任务是每周日 03:00 断点续采：

```text
0 3 * * 0 cd /root/RoomGap && ./run-collect.sh >> /var/log/roomgap-collect.log 2>&1
```

## 手动采集

登录 SSH 后执行断点续采：

```bash
cd /root/RoomGap
./run-collect.sh
```

完整刷新整个学期：

```bash
cd /root/RoomGap
ROOMGAP_REFRESH=1 ./run-collect.sh
```

后台运行并保存日志：

```bash
cd /root/RoomGap
nohup env PATH=/opt/node20/bin:$PATH ROOMGAP_HEADLESS=1 ROOMGAP_BROWSER_EXECUTABLE=/usr/bin/chromium ./run-collect.sh >/var/log/roomgap-collect-manual.log 2>&1 </dev/null &
```

完成后检查日志中的 `SUCCESS`，并检查 `data/semester/manifest.json` 和 `data/dataset/manifest.json`。

## 登录态更新

当日志出现登录失效、认证失败或查询返回登录页时，在 PC 上按 [SSH-CHROME-LOGIN.md](SSH-CHROME-LOGIN.md) 完成登录桥接，然后上传：

```powershell
scp -P 2222 .roomgap-auth.json root@127.0.0.1:/root/RoomGap/.roomgap-auth.json
ssh -p 2222 root@127.0.0.1 "chmod 600 /root/RoomGap/.roomgap-auth.json"
```

上传后重新执行断点采集即可。

## Bark 通知

配置文件位于远程 Linux：`/root/.config/roomgap.env`，权限应为 600。通知会在开始、成功和失败时发送。

测试通知：

```bash
set -a
. /root/.config/roomgap.env
set +a
curl -fsS -G --data-urlencode 'title=RoomGap 测试' --data-urlencode 'body=通知正常' "$ROOMGAP_BARK_URL"
```

不要把 Bark Key 或 `.roomgap-auth.json` 提交到 Git。

## 网站更新

采集完成后会生成最新数据，但网站是否立即变化取决于部署方式。当前项目不会自动把文件上传到静态托管平台；需要在部署机执行：

```powershell
node scripts/build-site.mjs
```

然后将生成的 `dist` 目录整体发布到网站托管平台。构建成功后，网站底部的最新数据日期会随 manifest 自动更新。

## 常见故障

- 进程退出：查看对应日志末尾和 Bark 失败通知，确认磁盘、内存、Chromium 和网络。
- 登录失效：重新导出并上传 `.roomgap-auth.json`。
- 数据不完整：优先执行断点续采；开学初或排课大改时使用 `ROOMGAP_REFRESH=1`。
- 网站日期未变：确认已重新运行 `build-site.mjs` 并重新发布整个 `dist` 目录。
