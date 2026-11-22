# AGENTS.md

本文件定义 **MoServerPanel** 项目的工程约定与标准操作流程，供协作者与 AI Agent 共同遵守。

---

## 1. 项目基础约定

- **应用名称**：`MoServerPanel`
- **默认单文件产物**：`mo-server-panel.exe`
- **Windows 服务名**：`MoServerPanel`
- **防火墙规则隔离**：分组 `MoServerPanel`，规则名前缀 `MSP-`（显示名前缀 `[MSP]`）
- **默认数据目录**：`%ProgramData%\MoServerPanel`（通常为 `C:\ProgramData\MoServerPanel`），优先级为 `--data-dir` > `MSP_DATA_DIR` > `%ProgramData%\MoServerPanel`
- **一键本地构建**：
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
  ```
- **全量单元测试**：
  ```powershell
  go test ./...
  ```
  > 注意：`web/embed.go` 和 `internal/nginx/embed.go` 分别内嵌 `web/dist` 与 `internal/nginx/embed/nginx.zip`。在干净环境中首次运行 `go test ./...` 前，需先执行一次 `.\scripts\build.ps1`（或至少构建前端并拉取 Nginx 包）。

---

## 2. Git 提交规范

遵循中文 **Conventional Commits**：

```text
<type>(<scope>): <中文简短描述>
```

- 常用 `type`：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`
- 标题末尾不加句号；改动较复杂时在空一行后补充中文要点列表
- 禁止提交构建产物与运行期数据（`*.exe`、`web/dist/`、`internal/nginx/embed/nginx.zip`、`data/` 等均已加入 `.gitignore`）

---

## 3. 发版与推送 Tag 流程

仓库通过 `.github/workflows/release.yml` 监听 `v*` 标签自动完成构建、测试与 GitHub Release 发布。每次发版**必须**按以下顺序执行：

### 步骤 1：确认分支状态与验证通过
1. 确认当前处于 `main` 分支，工作区没有遗漏或未跟踪的临时文件（`git status`）。
2. 执行本地全量构建与测试，确保前后端编译、测试和版本输出均正常：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1 -Version <X.Y.Z>
   go test ./...
   .\mo-server-panel.exe version
   ```

### 步骤 2：更新 `CHANGELOG.md`
1. 打开根目录的 `CHANGELOG.md`（遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范）。
2. 将 `## [Unreleased]` 下的条目归档到新版本标题 `## [<X.Y.Z>] - YYYY-MM-DD`（按 `Added` / `Changed` / `Fixed` / `Removed` 等分组整理），并保留一个空的 `## [Unreleased]` 标题供后续开发使用。
3. 更新文末的对比链接：
   ```markdown
   [Unreleased]: https://github.com/mohen-ink/MoServerPanel/compare/v<X.Y.Z>...HEAD
   [<X.Y.Z>]: https://github.com/mohen-ink/MoServerPanel/compare/v<PREV>...v<X.Y.Z>
   ```
   > `.github/workflows/release.yml` 会自动提取 `CHANGELOG.md` 中 `## [<X.Y.Z>]` 章节作为 GitHub Release 正文；若未找到对应章节，才会回退为 GitHub 自动生成的 Release Notes。

### 步骤 3：同步版本号并提交推送 `main`
1. 如有需要同步更新 `scripts/build.ps1` 中的默认 `-Version` 与 `web/package.json` 的 `version`（可选，CI 会以 Tag 为准注入 `main.Version`）。
2. 提交发版准备变更并推送到远端 `main`：
   ```powershell
   git add CHANGELOG.md
   git commit -m "chore(release): 准备发布 v<X.Y.Z>"
   git push origin main
   ```

### 步骤 4：打 Tag 并推送触发自动发布
1. 创建带附注的语义化版本标签（必须以 `v` 开头，如 `v0.1.0`；预发布版本带 `-` 后缀，如 `v0.2.0-beta.1`，CI 会自动标记为 GitHub Pre-release）：
   ```powershell
   git tag -a v<X.Y.Z> -m "Release v<X.Y.Z>"
   git push origin v<X.Y.Z>
   ```
2. 推送后，前往 GitHub 仓库的 **Actions → Build & Release** 确认流水线通过，并检查生成的 Release 是否包含：
   - 正确的版本标题与 `CHANGELOG.md` 正文
   - 附件 `mo-server-panel.exe`
   - 附件 `SHA256SUMS.txt`

### 异常处理：撤回误打的 Tag
若 Tag 推送后发现构建失败或漏提交文件，在修复并推送到 `main` 后，可删除本地与远端旧 Tag（以及对应草稿/错误的 Release）后重新打 Tag：
```powershell
git tag -d v<X.Y.Z>
git push origin :refs/tags/v<X.Y.Z>
```
> 已被外部广泛下载的正式版本**不要**覆盖重推原 Tag，应递增修订号发布新版本（如 `v0.1.1`）。
