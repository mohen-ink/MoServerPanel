# WinServerPanel

面向 Windows 服务器的**单文件、零依赖、低占用**轻量级管理面板（`win-server-panel.exe`）。

## 核心功能

* **单文件开箱即用**：Go 后端内嵌 React 前端静态资源与官方 Windows 版 Nginx（`nginx-1.30.7`），无需在目标服务器安装 Node.js、Python 或手动配置 Nginx。
* **端口通行（Windows 防火墙）**：
  * 可视化增删改、启停面板托管的入站端口规则（支持 TCP/UDP、端口段、来源 IP/CIDR 白名单与备注），以 `WSP-` 前缀安全隔离。
  * 实时扫描本机监听端口与对应进程（支持一键放行）及系统已有入站规则查看。
* **Nginx 反向代理与 SSL 证书**：
  * 面板全权托管内嵌 Nginx 启停、开机自启与日志查看。
  * 可视化配置 HTTP/HTTPS 反向代理、WebSocket 透传、真实 IP 请求头、强制 301 跳 HTTPS 与自定义指令；每次应用前自动执行 `nginx -t` 校验，失败自动回滚。
  * 支持手动上传 PEM 证书以及 **Let's Encrypt (ACME)** 自动签发（HTTP-01 / Cloudflare DNS-01 / 阿里云 DNS-01）与到期前 30 天自动续期。
* **内置 SSH / SFTP 服务**：
  * 纯密码登录、独立账号体系（无需修改 Windows 系统密码），基于 Windows ConPTY 与 `pkg/sftp`，兼容 Xshell / Tabby / FinalShell / WinSCP / OpenSSH。
  * 内置防爆破 IP 自动封禁、活跃连接实时查看与一键断开。
* **系统概览与网页终端**：
  * 实时 CPU / 内存 / 磁盘 / 网络速率监控。
  * 内置基于 `xterm.js` + ConPTY 的浏览器网页终端（支持 PowerShell / CMD）。

## 快速使用

### 1. 构建单文件可执行程序

本机需安装 Go 与 Node.js，运行一键构建脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

构建完成后会在项目根目录生成 `win-server-panel.exe`（自动下载并内嵌官方 Windows 版 Nginx 与编译后的前端资源）。

### 2. 运行与安装为 Windows 服务

> 提示：修改 Windows 防火墙与监听 80/443 低端口需要**管理员权限**。

```powershell
# 前台运行（默认监听 0.0.0.0:8900，数据目录为 exe 同级 data/）
.\win-server-panel.exe

# 自定义端口与数据目录
.\win-server-panel.exe --port 8900 --data-dir C:\WinServerPanel\data

# 注册为开机自启 Windows 系统服务（需管理员 PowerShell）
.\win-server-panel.exe service install --port 8900

# 服务管理
.\win-server-panel.exe service status
.\win-server-panel.exe service start
.\win-server-panel.exe service stop
.\win-server-panel.exe service uninstall

# 忘记面板密码时在本地重置
.\win-server-panel.exe reset-password --password YourNewPassword123
```

首次访问 `http://<服务器IP>:8900` 会自动进入管理员初始化向导，设置账号密码后即可使用。
