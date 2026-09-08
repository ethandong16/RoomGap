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

采集原始数据：`data/semester`。网站使用数据：`data/dataset`。完整性以两者的 `manifest.json`、`coverage.json` 为准。
