# PC 登录与 Linux 登录态更新

学校登录由你在 PC 上完成。专用 Chrome 通过 SSH SOCKS 代理借用 Linux 的出口网络，桥接脚本只导出学校域名 Cookie；SSH 加密传到 Linux 后由采集器使用。不需要保存账号密码。

以下示例对应当前测试机 `root@127.0.0.1:2222`。其他部署请替换主机、端口和 `/root/RoomGap` 路径。PC 项目目录应是普通本地目录，避免将浏览器登录配置自动同步到网盘；Git 的忽略规则无法控制网盘同步。

## 1. PC 准备

在 PowerShell 中进入 RoomGap 仓库目录，安装依赖并确认 Chrome / OpenSSH 可用：

```powershell
npm ci
ssh -V
```

## 2. 建立隧道

另开 PowerShell 窗口：

```powershell
ssh -D 127.0.0.1:1080 -N -p 2222 `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  root@127.0.0.1
```

输入 SSH 密码后窗口保持空白正常，整个登录过程保持它打开。首次连接核对服务器指纹。代理只监听本机。

```powershell
Test-NetConnection 127.0.0.1 -Port 1080
```

## 3. 打开可见的专用 Chrome

在 PC 的 RoomGap 目录中启动桥接：

```powershell
$env:ROOMGAP_BROWSER_CHANNEL = 'chrome'
$env:ROOMGAP_BROWSER_PROXY = 'socks5://127.0.0.1:1080'
node login-bridge.mjs
```

会打开一个可见 Chrome 窗口，使用独立的 `.roomgap-login-browser/` 配置，不影响日常 Chrome。登录学校账号、完成验证码或二次认证，进入“教室使用状况查询”页面后，回到终端按 Enter。

脚本验证查询目录存在，再导出学校域名 Cookie（包括 HttpOnly）到 `.roomgap-auth.json`。不要在只看到统一认证页面时确认。若窗口未出现，检查终端报错、Chrome 安装位置；可设置 `ROOMGAP_BROWSER_EXECUTABLE` 指向实际 `chrome.exe`。

## 4. 上传并验证

```powershell
scp -P 2222 .roomgap-auth.json root@127.0.0.1:/root/RoomGap/.roomgap-auth.json
ssh -p 2222 root@127.0.0.1 "chmod 600 /root/RoomGap/.roomgap-auth.json"
ssh -p 2222 root@127.0.0.1
```

然后在 Linux 执行：

```bash
cd /root/RoomGap
./run-collect.sh
```

入口自动载入项目根目录 Cookie。即使没有待补数据，也会访问学校目录以验证登录和目录。确认成功后可关闭 PC 的 SSH 隧道；Linux 后续采集直接使用自己的网络。导出的 PC 临时 Cookie 文件可删除，需再次导出时重新执行桥接。

Cookie 没有保证固定的有效时长。日志出现 `Login expired`、返回登录页或认证失效时重复上述流程。更换 Cookie 后必须重启采集进程，运行中的 API 会话不会自动重读文件。

## 可选：连接已手动启动的 Chrome

仅在需要手动打开浏览器时使用，通常不必操作调试端口。在 RoomGap 目录的 PowerShell：

```powershell
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$loginProfile = Join-Path $PWD '.roomgap-login-browser'
Start-Process -FilePath $chrome -ArgumentList @(
  "--user-data-dir=`"$loginProfile`"",
  '--proxy-server=socks5://127.0.0.1:1080',
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=9222',
  '--new-window',
  'http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/index'
)
$env:ROOMGAP_CDP_URL = 'http://127.0.0.1:9222'
node login-bridge.mjs
Remove-Item Env:ROOMGAP_CDP_URL
```

`9222` 只能供本机使用，不能暴露到局域网或公网。不要让两份浏览器同时使用同一 profile。

## 限制与排查

- Linux 也必须能访问学校系统；代理不会凭空提供校园网络权限。
- 学校可能绑定 IP、设备或使会话立即失效。借用 Linux 出口能减少 IP 变化，但不能保证 Cookie 永久可转移。
- 当前桥接只处理 Cookie。学校以后改用 localStorage 或其他认证机制，需要修改实现。
- 登录态、Bark Key 和浏览器配置都不进入 Git；导出文件在 Linux 的权限应为 `600`。
