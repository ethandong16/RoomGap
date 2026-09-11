# PC 登录并将登录态转发到 Linux

## 原理

PC 上的 Chrome 通过 SSH 隧道借用 Linux 的网络访问教务系统。用户在 PC 上手动登录，再把教务系统 Cookie 通过 SSH 加密传到 Linux。

```text
PC Chrome
  -> SOCKS5 127.0.0.1:1080
  -> SSH 隧道
  -> Linux 测试机
  -> 教务系统
```

`ssh -D` 会在 PC 上创建 SOCKS5 代理。Chrome 把网络请求发送到本机代理，SSH 再将请求转发到 Linux，由 Linux 访问学校系统。

## 1. 建立 SSH 隧道

在 PowerShell 中运行：

```powershell
ssh -D 1080 -N `
  -p 2222 `
  -o ServerAliveInterval=30 `
  -o ServerAliveCountMax=3 `
  root@127.0.0.1
```

参数：

| 参数 | 含义 |
| --- | --- |
| `-D 1080` | 在 PC 的 `127.0.0.1:1080` 建立 SOCKS5 代理 |
| `-N` | 不打开远程 Shell，只做端口转发 |
| `-p 2222` | SSH 服务端口 |
| `ServerAliveInterval=30` | 每 30 秒发送保活包 |
| `ServerAliveCountMax=3` | 连续三次无响应后断开 |

输入密码后终端保持空白是正常的。这个窗口不能关闭。

检查隧道：

```powershell
Test-NetConnection 127.0.0.1 -Port 1080
```

应看到：

```text
TcpTestSucceeded : True
```

## 2. 启动专用 Chrome

另开 PowerShell：

```powershell
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$profile = 'C:\Users\yimin\OneDrive\Desktop\RoomGap\.roomgap-login-browser'
$url = 'http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/index'

Start-Process -FilePath $chrome -ArgumentList @(
  "--user-data-dir=$profile",
  '--proxy-server=socks5://127.0.0.1:1080',
  '--remote-debugging-port=9222',
  '--new-window',
  $url
)
```

参数说明：

| 参数 | 含义 |
| --- | --- |
| `--user-data-dir` | 使用独立 Chrome 配置，不影响日常浏览器 |
| `--proxy-server` | 让 Chrome 通过 SSH SOCKS5 代理联网 |
| `--remote-debugging-port=9222` | 允许桥接脚本连接此 Chrome |
| `--new-window` | 打开独立窗口 |

不要使用日常 Chrome 配置目录。`9222` 只能监听本机，不要暴露到局域网或公网。

## 3. 手动登录

在新 Chrome 窗口中：

1. 打开统一认证页面。
2. 输入学校账号和密码。
3. 完成验证码或二次认证。
4. 进入“教室使用状况查询”页面。

账号密码只会进入学校登录页面。桥接脚本不会读取或保存账号密码。

## 4. 导出 Cookie

在第三个 PowerShell 窗口执行：

```powershell
cd C:\Users\yimin\OneDrive\Desktop\RoomGap

$env:ROOMGAP_PLAYWRIGHT_MODULE = `
  'C:\Users\yimin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'

$env:ROOMGAP_CDP_URL = 'http://127.0.0.1:9222'

node login-bridge.mjs
```

确认 Chrome 已登录并进入查询页面后，回到终端按 Enter。脚本会生成：

```text
.roomgap-auth.json
```

脚本只导出 `tust.edu.cn` 域名下的 Cookie，包括普通脚本无法读取的 `HttpOnly` Cookie。

## 5. 传输 Cookie 到 Linux

执行：

```powershell
scp -P 2222 .roomgap-auth.json `
  root@127.0.0.1:/root/RoomGap/.roomgap-auth.json
```

登录 Linux 并设置权限：

```powershell
ssh -p 2222 root@127.0.0.1
```

```bash
chmod 600 /root/RoomGap/.roomgap-auth.json
```

## 6. 使用登录态抓取数据

在 Linux 上执行：

```bash
cd /root/RoomGap

ROOMGAP_COOKIES_FILE=/root/RoomGap/.roomgap-auth.json \
ROOMGAP_REFRESH=1 \
./run-collect.sh
```

`ROOMGAP_REFRESH=1` 表示完整刷新整个学期。只补充缺失数据时执行：

```bash
cd /root/RoomGap
ROOMGAP_COOKIES_FILE=/root/RoomGap/.roomgap-auth.json ./run-collect.sh
```

## 7. 定时任务

定时任务也要指定 Cookie 文件：

```cron
0 3 * * 0 cd /root/RoomGap && ROOMGAP_COOKIES_FILE=/root/RoomGap/.roomgap-auth.json ./run-collect.sh >> /var/log/roomgap-collect.log 2>&1
```

这表示每周日凌晨 3 点执行一次断点续采。

查看任务：

```bash
crontab -l
```

查看日志：

```bash
tail -f /var/log/roomgap-collect.log
```

## 8. 安全注意事项

`.roomgap-auth.json` 在有效期内基本等同于临时密码：

- 不要上传到 Git、网盘或网站部署目录。
- 保持文件权限为 `600`。
- Cookie 失效后重新登录导出。
- 使用独立 Chrome 配置目录。
- 不要将 Chrome 的 `9222` 调试端口暴露到公网。

项目已经忽略以下文件：

```text
.roomgap-login-browser/
.roomgap-auth.json
```

## 9. 可能失败的情况

Cookie 转移不一定永久有效，原因包括：

1. 学校认证绑定了客户端 IP。
2. 学校认证绑定了浏览器或设备。
3. Cookie 已过期。
4. 登录态还依赖 `localStorage`。
5. 教务系统要求重新统一认证。

如果认证绑定 IP，PC 登录产生的 Cookie 可能只能在 PC 上使用，Linux 使用时仍会要求重新登录。

当前项目优先转移 Cookie。这个教务系统更接近 CAS + Session Cookie 的认证方式，因此 Cookie 方案有较大概率可以工作。
