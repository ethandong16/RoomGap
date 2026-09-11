# 安全与会话信息

公开问题和 Pull Request 中不要包含 `.roomgap-auth.json`、浏览器配置、Bark 设备 Key、SSH 私钥、学校账号密码或未脱敏的认证响应。

Cookie 有效期内可代表你的登录会话。Linux 上将 Cookie 与 Bark 配置权限设为 `600`；PC 上使用独立浏览器配置，避免同步到公共网盘。`.gitignore` 仅阻止 Git 跟踪，不能阻止云盘同步。

只部署 `dist/`。不要将项目根目录或 `.roomgap-*` 目录交给公开文件服务器。登录桥接的 SOCKS 和 CDP 调试端口只监听本机。

若凭据曾被提交，删除文件并不能从 Git 历史中撤回凭据，应先使其失效或更换，再处理历史副本。

发现可导致会话泄露、任意文件访问等问题时，优先使用仓库 Security 页的私密报告功能（若已启用），或通过[维护者主页](https://github.com/ethandong16)联系，确认私下沟通渠道后提供细节；普通功能问题可提交 Issue。
