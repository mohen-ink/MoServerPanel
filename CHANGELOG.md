# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本 (SemVer)](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.2] - 2026-11-22

### Added
- **DNS 服务商账号管理**：在「SSL 证书管理」页面新增「DNS 账号」标签页，支持预先添加、编辑和删除 Cloudflare（API Token）与阿里云 DNS（AccessKey）账号，凭证以脱敏形式展示，编辑时留空密钥自动保留原凭证，并禁止误删仍关联证书的账号。
- **ACME 申请与自动续期关联**：申请 Let's Encrypt 免费证书时可直接下拉选用已保存的 DNS 账号（支持在弹窗内快捷新建并自动选中）；手动续期与到期前 30 天后台自动续期均实时读取所关联 DNS 账号的最新凭证，更换 Token 只需修改一次账号即可全局生效。
- **证书设置与自动续期管理**：支持在证书列表中一键切换自动续期开关，并新增「编辑证书设置」弹窗，可随时修改证书名称、联系邮箱、自动续期策略或将旧内联凭证证书重新绑定至已保存的 DNS 账号。

## [0.1.1] - 2026-11-22

### Added
- **GitHub 自动更新**：支持在 WebUI「面板设置 → 软件更新」或通过命令行 `mo-server-panel.exe update [--check]` 从 GitHub Releases 检查并一键更新；下载过程显示实时进度，自动完成 PE 头与 `SHA256SUMS.txt` 完整性校验、新版本自检、Windows 安全原子替换及服务/前台平滑重启，并在重启后自动清理旧版 `.old` 文件。
- SSH / SFTP 与网页终端支持自定义**默认工作目录**，默认落在 `C:\ssh-tmp`（目录不存在时自动创建），避免 Windows 服务模式下落入 `C:\Windows\system32\config\systemprofile` 或 `System32`。

## [0.1.0] - 2026-11-22

### Added
- **单文件架构**：Go 后端内嵌 React 前端静态资源与官方 Windows 版 Nginx（`nginx-1.30.7`），编译产出单个 `mo-server-panel.exe`。
- **端口通行（Windows 防火墙）**：支持面板托管入站规则的增删改查与启停（以 `MoServerPanel` 分组和 `MSP-` 前缀隔离）、本机监听端口与进程扫描、一键放行及系统入站规则查看。
- **Nginx 反向代理与 SSL 证书**：托管内嵌 Nginx 启停与日志查看；可视化管理 HTTP/HTTPS 反向代理、WebSocket 透传、真实 IP 请求头、301 强制跳 HTTPS 及自定义配置，保存前自动 `nginx -t` 校验并失败回滚；支持手动上传 PEM 证书与 Let's Encrypt (ACME) 自动签发（HTTP-01 / Cloudflare DNS-01 / 阿里云 DNS-01）及到期前自动续期。
- **内置 SSH / SFTP 服务**：独立账号与纯密码认证，基于 Windows ConPTY 与 `pkg/sftp`，内置防爆破 IP 封禁与活跃会话管理。
- **系统概览与网页终端**：实时 CPU / 内存 / 磁盘 / 网络速率监控，内置基于 `xterm.js` + ConPTY 的浏览器网页终端（支持 PowerShell / CMD）。
- **Windows 系统服务与 CLI**：支持 `service install|uninstall|start|stop|status` 及本地 `reset-password` 重置管理员密码。
- **现代 WebUI**：基于设计令牌与 CSS 变量，支持浅色 / 深色 / 跟随系统三种主题、侧边栏分组导航、顶栏面包屑与移动端抽屉布局。
- **CI/CD 自动发版**：新增 `.github/workflows/release.yml`，推送 `v*` 标签自动构建发布 `mo-server-panel.exe` 与 `SHA256SUMS.txt`。

### Changed
- 应用名称统一为 **MoServerPanel**（可执行程序 `mo-server-panel.exe`、Windows 服务 `MoServerPanel`、防火墙前缀 `MSP-`）。
- 默认数据目录调整为 `%ProgramData%\MoServerPanel`（通常为 `C:\ProgramData\MoServerPanel`），支持通过 `--data-dir` 参数与 `MSP_DATA_DIR` 环境变量覆盖。

### Fixed
- 修复内置 SSH `exec` 命令在客户端未关闭 stdin 时等待 EOF 导致的超时死锁问题，并改用 PowerShell `-EncodedCommand` 执行命令。
- 修复 Windows 8.3 短路径（如 `RUNNER~1` / `PROGRA~1`）导致内嵌 Nginx 校验与启动失败的问题，初始化数据目录与自定义 Nginx 目录时自动展开为完整长路径。

[Unreleased]: https://github.com/mohen-ink/MoServerPanel/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/mohen-ink/MoServerPanel/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mohen-ink/MoServerPanel/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mohen-ink/MoServerPanel/releases/tag/v0.1.0
