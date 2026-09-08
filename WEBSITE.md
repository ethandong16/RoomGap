# RoomGap 网站

网站使用已采集的排课快照，学生查询不需要登录或连接学校 VPN。网页为静态 HTML、CSS、JavaScript，无后端或数据库，支持手机和电脑。

## 本机运行

需要 Node.js 20 或更新版本，无需安装额外运行依赖。在项目目录运行：

```powershell
.\run-web.ps1
```

服务监听 `0.0.0.0:4173`。本机打开 http://127.0.0.1:4173，局域网设备使用本机局域网 IP；更换端口可使用 `.\run-web.ps1 -Port 4174`。

也可以分别执行 `node scripts/build-site.mjs` 和 `node scripts/serve-site.mjs`。服务可由本机和局域网设备访问，但只能读取 dist 中的网页和数据，不提供项目或浏览器配置目录。

## 部署

运行 `node scripts/build-site.mjs`，构建会先验证完整数据。将 **dist 内全部文件和 data 文件夹** 整体上传到 HTTPS 静态托管服务；首页是 index.html，不需要 SPA 路由重写。支持网站根目录或子目录部署。不要直接双击 HTML 文件。

也可上传 `roomgap-website-2026-fall.zip` 解压后的全部内容。该压缩包只包含可部署网站，不含学校登录会话、采集脚本和原始记录。

托管平台需将 `.mjs` 作为 JavaScript（text/javascript 或 application/javascript）提供。HTML、脚本及 dataset.json 应使用 no-cache；版本目录下的数据可以长期缓存。dist 中的 `_headers` 适用于支持该格式的托管平台，其他平台按这些规则配置。网站通过 HTTPS 校验教室目录 SHA-256；localhost 本机预览同样支持。

## 更新排课

```powershell
.\run-collect.ps1 -Refresh
node scripts/build-site.mjs
```

刷新采集时保持学校 VPN 连接，必要时在独立 Chrome 中登录。构建成功后整体替换已部署网站。优先使用托管平台的原子部署；手工上传时先传新的 data 版本目录及网页文件，最后传 dataset.json，保留旧数据目录供已打开页面使用。

每次构建按数据内容生成独立版本目录，避免将新旧目录及每日记录混用。网页每次打开读取当前版本，日期数据在当前会话按需缓存。

## 查询规则

- 北京时间当天默认查第 1–2 节。非学期日期默认展示学期首日，并提示范围；不根据未核实的铃声时间推测“当前节次”。
- 校区选项来自普通教室及未注明类型的候选目录；只在用户浏览器保存最近所选校区。
- 只列出所选全部节次都空闲的教室，按覆盖查询时段的连续空闲长度排序，再按校区、楼栋、教室自然排序。
- 容量是座位总数。类型未注明的教室仍可查询，但不等于已确认可自习。页面不展示虚拟、体育及专用资源。
- 数据失败、版本冲突时停止展示结果并提供重试；未知时段永不计为空闲。

## 验证

```powershell
node --test semester-model.test.mjs tests/query.test.mjs
node scripts/build-site.mjs
node --test tests/server.test.mjs
```

浏览器端回归脚本为 `tests/browser.mjs`，需已启动本机服务，并能加载 Playwright。可设置 ROOMGAP_PLAYWRIGHT_MODULE 指向已有 Playwright 的 index.mjs，再运行 `node tests/browser.mjs`。测试结果及桌面、手机截图输出至 artifacts/（不进入部署包）。

现有采集脚本保持独立；网站没有预约、账号、开放上报及自动定时采集功能。
