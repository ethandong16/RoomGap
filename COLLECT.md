# 采集与刷新

正式采集入口为 `run-collect.ps1` / `collect-api.mjs`。它沿用单独Chrome配置中的登录状态，调用已从页面实际请求验证的教室使用查询接口。原先的逐点击脚本 `collect-all.mjs` 保留作参考，已不作为主要入口。

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

## 旧逐点击脚本说明

`collect-all.mjs` 是独立 Playwright 脚本，尚未实际运行，不能将此文件视为已经完成采集。

范围固定为2026-08-31至2027-01-17，共140天。使用页面目录中的可查询入口，不猜测接口地址。只保存校区、楼栋、房间、容量、类型、逐节状态和连续空闲区间，不保存课程或人员信息。

安装依赖：`npm install --no-save playwright`

运行：`node collect-all.mjs`

脚本使用单独的Chrome配置目录`.roomgap-browser`，不复制当前Chrome的Cookie或认证文件。运行时需保持学校VPN连接，在新Chrome窗口自行登录，然后按终端提示回车。此目录可能包含登录会话，已加入gitignore。

输出保存在`data/daily`，进度及覆盖状态在`data/daily-manifest.json`。重复运行跳过已经验证保存的楼栋日记录。日期通过页面已有左右箭头逐日切换；没有放开只读日期控件。异常页面、陌生颜色、结构改变或登录失效会暂停，不伪造空闲结果。

全学期最大查询量约10,640个楼栋日。空表记录标记待核实，不直接判定完整。教室未来排课和临时借用会变化，采集时间只代表该时点查询结果。

当前验证仅包括JavaScript语法检查及此前一栋楼一天的字段/颜色样本，独立脚本尚未通过端到端验证。
