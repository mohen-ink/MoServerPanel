# MoServerPanel

面向 Windows 服务器的**单文件、零依赖、低占用**轻量级管理面板（`mo-server-panel.exe`）。

## 核心功能

* **单文件开箱即用**：Go 后端内嵌 React 前端静态资源与官方 Windows 版 Nginx（`nginx-1.30.7`），无需在目标服务器安装 Node.js、Python 或手动部署 Nginx。
* **端口通行（Windows 防火墙）**：
  * 可视化增删改、启停面板托管的入站端口规则（支持 TCP/UDP、端口段、来源 IP/CIDR 白名单与备注），以 `MoServerPanel` 分组及 `MSP-` 前缀安全隔离。
  * 实时扫描本机监听端口与对应进程（支持一键放行），并支持查看系统已有入站规则。
* **Nginx 反向代理与 SSL 证书**：
  * 全权托管内嵌 Nginx 启停、开机自启与运行日志查看。
  * 可视化配置 HTTP/HTTPS 反向代理、WebSocket 透传、真实 IP 请求头、强制 301 跳 HTTPS 与自定义指令；每次应用前自动执行 `nginx -t` 校验，失败自动回滚。
  * 支持手动上传 PEM 证书以及 **Let's Encrypt (ACME)** 自动签发（HTTP-01 / Cloudflare DNS-01 / 阿里云 DNS-01）与到期前 30 天自动续期。
* **内置 SSH / SFTP 服务**：
  * 纯密码登录、独立账号体系（无需修改 Windows 系统密码），基于 Windows ConPTY 与 `pkg/sftp`，兼容 Xshell / Tabby / FinalShell / WinSCP / OpenSSH。
  * 内置防爆破 IP 自动封禁、活跃连接实时查看与一键断开。
* **系统概览与网页终端**：
  * 实时 CPU / 内存 / 磁盘 / 网络速率监控。
  * 内置基于 `xterm.js` + ConPTY 的浏览器网页终端（支持 PowerShell / CMD）。
  * 现代 WebUI，支持浅色 / 深色 / 跟随系统三种主题及移动端响应式布局。

---

## 快速开始

### 1. 下载运行

前往本仓库的 [GitHub Releases](https://github.com/mohen-ink/MoServerPanel/releases) 页面下载最新版 `mo-server-panel.exe`（可对照同附的 `SHA256SUMS.txt` 校验文件完整性）。

> **权限提示**：修改 Windows 防火墙规则及监听 80/443 低端口需要**管理员权限**，建议以管理员身份运行或直接注册为 Windows 系统服务。

```powershell
# 前台运行（默认监听 0.0.0.0:8900，默认数据目录为 C:\ProgramData\MoServerPanel）
.\mo-server-panel.exe

# 自定义监听端口与数据目录
.\mo-server-panel.exe --port 8900 --data-dir D:\MoServerPanel\data

# 注册为开机自启 Windows 系统服务（需管理员 PowerShell）
.\mo-server-panel.exe service install --port 8900

# 服务管理
.\mo-server-panel.exe service status
.\mo-server-panel.exe service start
.\mo-server-panel.exe service stop
.\mo-server-panel.exe service uninstall

# 忘记面板密码时在服务器本地重置
.\mo-server-panel.exe reset-password --password YourNewPassword123
```

首次启动后访问 `http://<服务器IP>:8900`，按引导完成管理员账号初始化即可使用。

### 2. 命令行参数与环境变量

| 参数 / 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `--addr` | `0.0.0.0` | 覆盖面板监听地址 |
| `--port` | `8900` | 覆盖面板监听端口 |
| `--data-dir` | `%ProgramData%\MoServerPanel` | 指定数据目录路径（最高优先级） |
| `MSP_DATA_DIR` | — | 通过环境变量指定数据目录（次于 `--data-dir`） |

### 3. 数据目录结构

默认数据统一保存在 `C:\ProgramData\MoServerPanel`（程序与数据分离，移动或替换 `mo-server-panel.exe` 不会丢失配置，且避免中文路径导致的 Nginx 兼容问题）：

```text
C:\ProgramData\MoServerPanel\
├── store\                  # 面板配置、反代站点、防火墙规则及证书元数据
├── certs\                  # SSL/TLS 证书与私钥文件
├── acme-accounts\          # Let's Encrypt ACME 账户信息
├── acme-webroot\           # ACME HTTP-01 验证目录
├── nginx\                  # 自动解压的内嵌 Nginx 程序、配置与日志
└── ssh_host_ed25519_key    # 内置 SSH 服务主机私钥
```

---

## 从源码构建与发版

### 本地构建

本机需安装 **Go（1.26+）** 与 **Node.js（20+）**，在仓库根目录运行一键构建脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

构建完成后会在项目根目录生成 `mo-server-panel.exe`（自动下载并内嵌官方 Windows 版 Nginx 与编译后的前端资源）。

### GitHub Actions 自动构建发布

仓库已配置 [.github/workflows/release.yml](.github/workflows/release.yml)：

* **推送版本 Tag 自动发版**：推送以 `v` 开头的标签（如 `v0.1.0`，含 `-` 的如 `v0.1.0-beta.1` 会自动标记为 Pre-release）时，自动在 `windows-latest` 上完成前端编译、内嵌 Nginx 下载、Go 单文件构建、单元测试与 SHA256 校验，并创建 GitHub Release 上传 `mo-server-panel.exe` 和 `SHA256SUMS.txt`。
* **手动触发测试构建**：也可在 GitHub 仓库的 **Actions → Build & Release → Run workflow** 中手动触发构建并下载 Artifact。

```powershell
git tag v0.1.0
git push origin v0.1.0
```
