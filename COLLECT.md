# 采集与刷新

正式采集入口为 `run-collect.ps1` / `collect-api.mjs`。它沿用单独Chrome配置中的登录状态，调用已从页面实际请求验证的教室使用查询接口。

在项目目录运行：

```powershell
.\run-collect.ps1
```

默认断点续采，只补缺失的楼栋日。已有排课发生变动时，完整刷新：

```powershell
.\run-collect.ps1 -Refresh
```

请保持学校VPN连接。登录过期时，在脚本打开的独立Chrome里完成登录并进入教室使用状况查询，程序检测到目录后继续。

本机启动脚本会优先使用已有Playwright运行库。其他电脑可安装 `package.json` 中的依赖，再执行 `node collect-api.mjs` 和 `node build-dataset.mjs`。

## Linux 运行

Linux 使用 `run-collect.sh`。需要 Node.js 20+、Chromium/Chrome 和 Playwright 依赖：

```bash
npm install
chmod +x run-collect.sh
```

第一次运行需要完成学校登录。服务器有图形界面时运行：

```bash
ROOMGAP_HEADLESS=0 ./run-collect.sh
```

登录状态保存在 `.roomgap-browser`。确认登录成功后，定时任务使用默认无头模式即可：

```bash
./run-collect.sh
```

如果系统没有自动找到浏览器，可设置 `ROOMGAP_BROWSER_EXECUTABLE`；如果登录状态使用其他目录，可设置 `ROOMGAP_BROWSER_PROFILE`。定时任务运行前需要保持学校 VPN 或网络连通。建议按周执行，开学初和考试前手动设置 `ROOMGAP_REFRESH=1` 做完整刷新。

## 手动操作和登录更新

Linux 上手动断点续采：

```bash
cd /root/RoomGap
./run-collect.sh
```

完整刷新：

```bash
ROOMGAP_REFRESH=1 ./run-collect.sh
```

PC 登录态更新仍使用项目目录中的 `login-bridge.mjs`。先建立 SSH SOCKS 隧道，再打开 PC Chrome 完成登录；登录桥接结束后，将生成的 `.roomgap-auth.json` 传到 Linux 的 `/root/RoomGap/.roomgap-auth.json`。Cookie 过期或学校要求重新认证时重复此流程即可。

当前定时任务为每周日凌晨 3:00：

```text
0 3 * * 0 cd /root/RoomGap && ./run-collect.sh >> /var/log/roomgap-collect.log 2>&1
```

可选 Bark 通知：在 Linux 创建 `/root/.config/roomgap.env`，写入你的 Bark 推送地址：

```bash
ROOMGAP_BARK_URL='https://api.day.app/你的设备Key'

# 通知函数会分别发送 title 和 body 字段（Bark 查询参数）。
```

脚本会在开始、成功完成或失败时推送；不配置时不发送通知。

采集原始数据：`data/semester`。网站使用数据：`data/dataset`。完整性以两者的 `manifest.json`、`coverage.json` 为准。
