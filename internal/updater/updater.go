package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"win-server-panel/internal/service"
)

const (
	DefaultRepo      = "mohen-ink/MoServerPanel"
	DefaultAssetName = "mo-server-panel.exe"
	ChecksumFileName = "SHA256SUMS.txt"
	defaultAPIBase   = "https://api.github.com"
)

type CheckResult struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	TagName        string `json:"tagName"`
	HasUpdate      bool   `json:"hasUpdate"`
	ReleaseName    string `json:"releaseName"`
	ReleaseNotes   string `json:"releaseNotes"`
	ReleaseURL     string `json:"releaseUrl"`
	PublishedAt    string `json:"publishedAt"`
	AssetName      string `json:"assetName"`
	AssetSize      int64  `json:"assetSize"`
	DownloadURL    string `json:"downloadUrl,omitempty"`
	ChecksumURL    string `json:"checksumUrl,omitempty"`
	HasChecksum    bool   `json:"hasChecksum"`
}

type UpdateState string

const (
	StateIdle        UpdateState = "idle"
	StateDownloading UpdateState = "downloading"
	StateVerifying   UpdateState = "verifying"
	StateReplacing   UpdateState = "replacing"
	StateRestarting  UpdateState = "restarting"
	StateDone        UpdateState = "done"
	StateError       UpdateState = "error"
)

type Status struct {
	State           UpdateState `json:"state"`
	TargetVersion   string      `json:"targetVersion,omitempty"`
	DownloadedBytes int64       `json:"downloadedBytes"`
	TotalBytes      int64       `json:"totalBytes"`
	Percent         int         `json:"percent"`
	Message         string      `json:"message,omitempty"`
	Error           string      `json:"error,omitempty"`
	RestartMode     string      `json:"restartMode,omitempty"` // "service", "foreground", or "manual"
}

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Name        string        `json:"name"`
	Body        string        `json:"body"`
	HTMLURL     string        `json:"html_url"`
	PublishedAt string        `json:"published_at"`
	Prerelease  bool          `json:"prerelease"`
	Draft       bool          `json:"draft"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type Manager struct {
	currentVersion string
	repo           string
	apiBase        string
	httpClient     *http.Client
	shutdownFn     func()

	mu     sync.RWMutex
	status Status
	busy   bool
}

func NewManager(currentVersion string, shutdownFn func()) *Manager {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	return &Manager{
		currentVersion: strings.TrimPrefix(strings.TrimSpace(currentVersion), "v"),
		repo:           DefaultRepo,
		apiBase:        defaultAPIBase,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   0, // per-request context timeout used instead so large downloads don't time out abruptly
		},
		shutdownFn: shutdownFn,
		status: Status{
			State: StateIdle,
		},
	}
}

// CleanupOldBinary removes the leftover "<exe>.old" binary created during a previous self-update.
func CleanupOldBinary() {
	exePath, err := currentExePath()
	if err != nil {
		return
	}
	oldPath := exePath + ".old"
	if _, err := os.Stat(oldPath); err == nil {
		if rmErr := os.Remove(oldPath); rmErr != nil {
			log.Printf("[updater] cleanup %s skipped: %v", oldPath, rmErr)
		} else {
			log.Printf("[updater] cleaned up previous binary %s", oldPath)
		}
	}
}

func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.status
}

func (m *Manager) setStatus(fn func(s *Status)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	fn(&m.status)
}

func (m *Manager) Check(ctx context.Context) (*CheckResult, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	url := fmt.Sprintf("%s/repos/%s/releases/latest", strings.TrimRight(m.apiBase, "/"), m.repo)
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", fmt.Sprintf("MoServerPanel/%s", m.currentVersion))

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接 GitHub API 失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, errors.New("GitHub 仓库尚无已发布的 Release")
	}
	if resp.StatusCode == http.StatusForbidden {
		return nil, errors.New("GitHub API 请求频率受限（403），请稍后再试")
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("GitHub API 返回异常状态 %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("解析 Release 数据失败: %w", err)
	}

	latestVer := strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v")
	res := &CheckResult{
		CurrentVersion: m.currentVersion,
		LatestVersion:  latestVer,
		TagName:        rel.TagName,
		HasUpdate:      CompareVersions(m.currentVersion, latestVer) < 0,
		ReleaseName:    rel.Name,
		ReleaseNotes:   rel.Body,
		ReleaseURL:     rel.HTMLURL,
		PublishedAt:    rel.PublishedAt,
	}

	for _, a := range rel.Assets {
		switch {
		case strings.EqualFold(a.Name, DefaultAssetName) || (res.DownloadURL == "" && strings.HasSuffix(strings.ToLower(a.Name), ".exe")):
			res.AssetName = a.Name
			res.AssetSize = a.Size
			res.DownloadURL = a.BrowserDownloadURL
		case strings.EqualFold(a.Name, ChecksumFileName):
			res.ChecksumURL = a.BrowserDownloadURL
			res.HasChecksum = true
		}
	}

	return res, nil
}

// StartAsyncUpdate checks for the latest release and performs download, verify, replace, and restart in background.
func (m *Manager) StartAsyncUpdate() (Status, error) {
	m.mu.Lock()
	if m.busy {
		st := m.status
		m.mu.Unlock()
		return st, errors.New("已有更新任务正在进行中")
	}
	m.busy = true
	m.status = Status{
		State:   StateDownloading,
		Message: "正在获取最新版本信息...",
	}
	st := m.status
	m.mu.Unlock()

	go func() {
		defer func() {
			m.mu.Lock()
			if m.status.State != StateRestarting {
				m.busy = false
			}
			m.mu.Unlock()
		}()

		ctx := context.Background()
		rel, err := m.Check(ctx)
		if err != nil {
			m.fail(err)
			return
		}
		if !rel.HasUpdate {
			m.setStatus(func(s *Status) {
				s.State = StateDone
				s.TargetVersion = rel.LatestVersion
				s.Percent = 100
				s.Message = fmt.Sprintf("当前已是最新版本 v%s", rel.CurrentVersion)
			})
			return
		}
		if rel.DownloadURL == "" {
			m.fail(fmt.Errorf("Release %s 中未找到 %s 下载附件", rel.TagName, DefaultAssetName))
			return
		}

		if err := m.downloadVerifyAndSwap(ctx, rel); err != nil {
			m.fail(err)
			return
		}

		if err := m.triggerRestart(rel.LatestVersion); err != nil {
			m.fail(fmt.Errorf("新版本已写入，但自动重启失败（请手动重启服务）: %w", err))
			return
		}
	}()

	return st, nil
}

// ApplyCLI performs a synchronous update suitable for CLI invocation (`mo-server-panel.exe update`).
func (m *Manager) ApplyCLI(ctx context.Context, rel *CheckResult, progressFn func(downloaded, total int64)) error {
	if rel.DownloadURL == "" {
		return fmt.Errorf("Release %s 中未找到 %s 下载附件", rel.TagName, DefaultAssetName)
	}
	if err := m.downloadVerifyAndSwapWithProgress(ctx, rel, progressFn); err != nil {
		return err
	}
	return nil
}

func (m *Manager) fail(err error) {
	log.Printf("[updater] update failed: %v", err)
	m.setStatus(func(s *Status) {
		s.State = StateError
		s.Error = err.Error()
		s.Message = "更新失败"
	})
}

func (m *Manager) downloadVerifyAndSwap(ctx context.Context, rel *CheckResult) error {
	return m.downloadVerifyAndSwapWithProgress(ctx, rel, nil)
}

func (m *Manager) downloadVerifyAndSwapWithProgress(ctx context.Context, rel *CheckResult, progressFn func(downloaded, total int64)) error {
	exePath, err := currentExePath()
	if err != nil {
		return fmt.Errorf("定位当前程序路径失败: %w", err)
	}
	newPath := exePath + ".new"
	oldPath := exePath + ".old"

	// 1. Download binary to <exe>.new
	m.setStatus(func(s *Status) {
		s.State = StateDownloading
		s.TargetVersion = rel.LatestVersion
		s.TotalBytes = rel.AssetSize
		s.DownloadedBytes = 0
		s.Percent = 0
		s.Error = ""
		s.Message = fmt.Sprintf("正在下载 v%s (%s)...", rel.LatestVersion, rel.AssetName)
	})

	dlCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, rel.DownloadURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", fmt.Sprintf("MoServerPanel/%s", m.currentVersion))

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("下载更新包失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载更新包失败，HTTP 状态码: %d", resp.StatusCode)
	}

	total := resp.ContentLength
	if total <= 0 {
		total = rel.AssetSize
	}
	m.setStatus(func(s *Status) {
		s.TotalBytes = total
	})

	outFile, err := os.OpenFile(newPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return fmt.Errorf("创建临时文件 %s 失败（请检查程序目录写入权限）: %w", newPath, err)
	}

	hasher := sha256.New()
	buf := make([]byte, 64*1024)
	var downloaded int64
	var copyErr error
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := outFile.Write(buf[:n]); wErr != nil {
				copyErr = wErr
				break
			}
			_, _ = hasher.Write(buf[:n])
			downloaded += int64(n)
			pct := 0
			if total > 0 {
				pct = int((downloaded * 100) / total)
				if pct > 100 {
					pct = 100
				}
			}
			m.setStatus(func(s *Status) {
				s.DownloadedBytes = downloaded
				s.TotalBytes = total
				s.Percent = pct
			})
			if progressFn != nil {
				progressFn(downloaded, total)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			copyErr = readErr
			break
		}
	}
	closeErr := outFile.Close()
	if copyErr != nil {
		_ = os.Remove(newPath)
		return fmt.Errorf("下载写入中断: %w", copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(newPath)
		return fmt.Errorf("关闭临时文件失败: %w", closeErr)
	}

	if downloaded < 1024*1024 {
		_ = os.Remove(newPath)
		return fmt.Errorf("下载文件异常偏小（%d 字节），已中止更新", downloaded)
	}

	// 2. Verify PE header & SHA256 checksum
	m.setStatus(func(s *Status) {
		s.State = StateVerifying
		s.Percent = 100
		s.Message = "正在校验文件完整性 (SHA256)..."
	})

	if err := verifyPEHeader(newPath); err != nil {
		_ = os.Remove(newPath)
		return err
	}

	gotHash := hex.EncodeToString(hasher.Sum(nil))
	if rel.ChecksumURL != "" {
		expectedHash, err := m.fetchExpectedSHA256(ctx, rel.ChecksumURL, rel.AssetName)
		if err != nil {
			_ = os.Remove(newPath)
			return fmt.Errorf("获取 SHA256 校验文件失败: %w", err)
		}
		if !strings.EqualFold(gotHash, expectedHash) {
			_ = os.Remove(newPath)
			return fmt.Errorf("SHA256 校验不匹配（期望 %s，实际 %s），已删除损坏文件", expectedHash, gotHash)
		}
	}

	// Smoke-test the downloaded executable via `<newPath> version`
	m.setStatus(func(s *Status) {
		s.Message = "正在验证新版本可执行文件..."
	})
	verCtx, verCancel := context.WithTimeout(ctx, 15*time.Second)
	defer verCancel()
	checkCmd := exec.CommandContext(verCtx, newPath, "version")
	checkCmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	out, err := checkCmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "MoServerPanel") {
		_ = os.Remove(newPath)
		return fmt.Errorf("新版本程序自检失败: %v (%s)", err, strings.TrimSpace(string(out)))
	}

	// 3. Atomic Windows binary swap: rename running exe -> .old, rename .new -> exe
	m.setStatus(func(s *Status) {
		s.State = StateReplacing
		s.Message = "正在替换可执行文件..."
	})

	_ = os.Remove(oldPath)
	if err := os.Rename(exePath, oldPath); err != nil {
		_ = os.Remove(newPath)
		return fmt.Errorf("备份当前可执行文件失败: %w", err)
	}
	if err := os.Rename(newPath, exePath); err != nil {
		// Roll back immediately so the system is never left without the binary
		_ = os.Rename(oldPath, exePath)
		_ = os.Remove(newPath)
		return fmt.Errorf("替换可执行文件失败（已回滚）: %w", err)
	}

	log.Printf("[updater] binary updated to v%s (sha256=%s)", rel.LatestVersion, gotHash)
	return nil
}

func (m *Manager) triggerRestart(targetVersion string) error {
	if service.IsWindowsService() {
		m.setStatus(func(s *Status) {
			s.State = StateRestarting
			s.RestartMode = "service"
			s.Message = fmt.Sprintf("已更新到 v%s，正在重启 Windows 服务...", targetVersion)
		})
		script := fmt.Sprintf(
			"Start-Sleep -Seconds 1; Stop-Service -Name '%s' -Force -ErrorAction SilentlyContinue; "+
				"for ($i=0; $i -lt 30; $i++) { if ((Get-Service -Name '%s' -ErrorAction SilentlyContinue).Status -eq 'Stopped') { break }; Start-Sleep -Milliseconds 500 }; "+
				"Start-Service -Name '%s'",
			service.ServiceName, service.ServiceName, service.ServiceName,
		)
		return spawnDetachedPowerShell(script)
	}

	exePath, err := currentExePath()
	if err != nil {
		return err
	}

	m.setStatus(func(s *Status) {
		s.State = StateRestarting
		s.RestartMode = "foreground"
		s.Message = fmt.Sprintf("已更新到 v%s，正在重启面板进程...", targetVersion)
	})

	// Build a detached PowerShell command that waits for current PID to exit, then launches the new exe with the same args.
	pid := os.Getpid()
	var argList []string
	for _, a := range os.Args[1:] {
		argList = append(argList, "'"+strings.ReplaceAll(a, "'", "''")+"'")
	}
	quotedExe := "'" + strings.ReplaceAll(exePath, "'", "''") + "'"
	startExpr := fmt.Sprintf("Start-Process -FilePath %s", quotedExe)
	if len(argList) > 0 {
		startExpr += fmt.Sprintf(" -ArgumentList @(%s)", strings.Join(argList, ","))
	}
	script := fmt.Sprintf(
		"Start-Sleep -Seconds 1; Wait-Process -Id %d -Timeout 15 -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; %s",
		pid, startExpr,
	)
	if err := spawnDetachedPowerShell(script); err != nil {
		return err
	}

	// Give the HTTP polling response a brief window to read "restarting", then gracefully shut down.
	go func() {
		time.Sleep(1200 * time.Millisecond)
		if m.shutdownFn != nil {
			m.shutdownFn()
		} else {
			os.Exit(0)
		}
	}()
	return nil
}

func spawnDetachedPowerShell(script string) error {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	// CREATE_NO_WINDOW (0x08000000) | DETACHED_PROCESS (0x00000008) | CREATE_NEW_PROCESS_GROUP (0x00000200)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000 | 0x00000008 | 0x00000200,
	}
	return cmd.Start()
}

func (m *Manager) fetchExpectedSHA256(ctx context.Context, checksumURL, assetName string) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, checksumURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", fmt.Sprintf("MoServerPanel/%s", m.currentVersion))

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return "", err
	}
	return ParseChecksum(string(raw), assetName)
}

// ParseChecksum parses a sha256sum-formatted text (e.g. "<hex>  mo-server-panel.exe") and returns the hex digest.
func ParseChecksum(content, assetName string) (string, error) {
	for _, line := range strings.Split(content, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		hash := fields[0]
		name := strings.TrimPrefix(fields[1], "*")
		if strings.EqualFold(filepath.Base(name), assetName) && len(hash) == 64 {
			if _, err := hex.DecodeString(hash); err == nil {
				return strings.ToLower(hash), nil
			}
		}
	}
	return "", fmt.Errorf("在 %s 中未找到 %s 的有效 SHA256 记录", ChecksumFileName, assetName)
}

func verifyPEHeader(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var magic [2]byte
	if _, err := io.ReadFull(f, magic[:]); err != nil {
		return fmt.Errorf("读取文件头失败: %w", err)
	}
	if magic[0] != 'M' || magic[1] != 'Z' {
		return errors.New("下载的文件不是有效的 Windows 可执行程序（缺少 MZ 头）")
	}
	return nil
}

func currentExePath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil && resolved != "" {
		return resolved, nil
	}
	return filepath.Abs(exe)
}

// CompareVersions compares two SemVer strings (with optional leading "v" and prerelease suffix).
// Returns -1 if a < b, 0 if a == b, 1 if a > b.
func CompareVersions(a, b string) int {
	pa := parseSemVer(a)
	pb := parseSemVer(b)
	for i := 0; i < 3; i++ {
		if pa.nums[i] < pb.nums[i] {
			return -1
		}
		if pa.nums[i] > pb.nums[i] {
			return 1
		}
	}
	// Stable release is newer than prerelease with identical major.minor.patch (e.g. 0.1.0 > 0.1.0-dev)
	if pa.pre == "" && pb.pre == "" {
		return 0
	}
	if pa.pre == "" {
		return 1
	}
	if pb.pre == "" {
		return -1
	}
	if pa.pre < pb.pre {
		return -1
	}
	if pa.pre > pb.pre {
		return 1
	}
	return 0
}

type semVer struct {
	nums [3]int
	pre  string
}

func parseSemVer(v string) semVer {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if idx := strings.IndexByte(v, '+'); idx >= 0 {
		v = v[:idx]
	}
	var pre string
	if idx := strings.IndexByte(v, '-'); idx >= 0 {
		pre = v[idx+1:]
		v = v[:idx]
	}
	parts := strings.Split(v, ".")
	var nums [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		n, err := strconv.Atoi(parts[i])
		if err == nil {
			nums[i] = n
		}
	}
	return semVer{nums: nums, pre: pre}
}
