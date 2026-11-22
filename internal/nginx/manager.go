package nginx

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/process"

	"win-server-panel/internal/config"
)

type Status struct {
	Installed  bool   `json:"installed"`
	Running    bool   `json:"running"`
	PID        int32  `json:"pid"`
	Version    string `json:"version"`
	NginxDir   string `json:"nginxDir"`
	AutoStart  bool   `json:"autoStart"`
	SiteCount  int    `json:"siteCount"`
	ActiveSite int    `json:"activeSite"`
}

type SiteInput struct {
	Name              string   `json:"name"`
	Enabled           bool     `json:"enabled"`
	Domains           []string `json:"domains"`
	ListenPort        int      `json:"listenPort"`
	Upstream          string   `json:"upstream"`
	SSL               bool     `json:"ssl"`
	CertID            string   `json:"certId"`
	ForceHTTPS        bool     `json:"forceHttps"`
	WebSocket         bool     `json:"webSocket"`
	RealIPHeaders     bool     `json:"realIpHeaders"`
	ClientMaxBodySize string   `json:"clientMaxBodySize"`
	CustomConfig      string   `json:"customConfig"`
}

type Manager struct {
	mu    sync.Mutex
	store *config.Store
}

func NewManager(store *config.Store) *Manager {
	return &Manager{store: store}
}

func (m *Manager) NginxDir() string {
	cfg := m.store.GetConfig()
	if strings.TrimSpace(cfg.Nginx.CustomPath) != "" {
		return config.ExpandLongPath(strings.TrimSpace(cfg.Nginx.CustomPath))
	}
	return m.store.NginxDir()
}

func (m *Manager) ExePath() string {
	return filepath.Join(m.NginxDir(), "nginx.exe")
}

func (m *Manager) ConfDir() string {
	return filepath.Join(m.NginxDir(), "conf", "conf.d")
}

func (m *Manager) EnsureReady() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.ensureReadyLocked()
}

func (m *Manager) ensureReadyLocked() error {
	dir := m.NginxDir()
	cfg := m.store.GetConfig()
	if strings.TrimSpace(cfg.Nginx.CustomPath) == "" {
		if err := EnsureExtracted(dir); err != nil {
			return err
		}
	} else {
		if _, err := os.Stat(filepath.Join(dir, "nginx.exe")); err != nil {
			return fmt.Errorf("自定义 Nginx 路径下未找到 nginx.exe: %w", err)
		}
		for _, sub := range []string{"conf", filepath.Join("conf", "conf.d"), "logs", "temp"} {
			_ = os.MkdirAll(filepath.Join(dir, sub), 0o755)
		}
	}

	masterPath := filepath.Join(dir, "conf", "nginx.conf")
	if err := os.WriteFile(masterPath, []byte(RenderMasterConfig()), 0o644); err != nil {
		return fmt.Errorf("写入主配置 nginx.conf 失败: %w", err)
	}
	return m.syncAllSitesLocked()
}

func (m *Manager) syncAllSitesLocked() error {
	confDir := m.ConfDir()
	if err := os.MkdirAll(confDir, 0o755); err != nil {
		return err
	}

	sites := m.store.ListProxies()
	validFiles := make(map[string]bool)

	for _, site := range sites {
		if !site.Enabled {
			continue
		}
		var certPtr *config.Certificate
		if site.SSL {
			c, ok := m.store.GetCert(site.CertID)
			if !ok {
				continue
			}
			certPtr = &c
		}
		rendered, err := RenderSiteConfig(site, certPtr, m.store.ACMEWebrootDir())
		if err != nil {
			continue
		}
		fname := site.ID + ".conf"
		validFiles[fname] = true
		if err := os.WriteFile(filepath.Join(confDir, fname), []byte(rendered), 0o644); err != nil {
			return err
		}
	}

	entries, err := os.ReadDir(confDir)
	if err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".conf") {
				continue
			}
			if e.Name() == "_acme_temp.conf" {
				continue
			}
			if !validFiles[e.Name()] {
				_ = os.Remove(filepath.Join(confDir, e.Name()))
			}
		}
	}
	return nil
}

func (m *Manager) Status() Status {
	dir := m.NginxDir()
	exe := filepath.Join(dir, "nginx.exe")
	_, statErr := os.Stat(exe)
	installed := statErr == nil

	pid, running := m.detectRunningPID()
	sites := m.store.ListProxies()
	active := 0
	for _, s := range sites {
		if s.Enabled {
			active++
		}
	}

	version := ""
	if installed {
		version = m.readVersion(dir, exe)
	}

	return Status{
		Installed:  installed,
		Running:    running,
		PID:        pid,
		Version:    version,
		NginxDir:   dir,
		AutoStart:  m.store.GetConfig().Nginx.AutoStart,
		SiteCount:  len(sites),
		ActiveSite: active,
	}
}

func (m *Manager) detectRunningPID() (int32, bool) {
	pidPath := filepath.Join(m.NginxDir(), "logs", "nginx.pid")
	raw, err := os.ReadFile(pidPath)
	if err != nil {
		return 0, false
	}
	pidVal, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pidVal <= 0 {
		return 0, false
	}
	pid := int32(pidVal)
	exists, err := process.PidExists(pid)
	if err != nil || !exists {
		return 0, false
	}
	if p, err := process.NewProcess(pid); err == nil {
		if name, err := p.Name(); err == nil && !strings.Contains(strings.ToLower(name), "nginx") {
			return 0, false
		}
	}
	return pid, true
}

func (m *Manager) readVersion(dir, exe string) string {
	cmd := exec.Command(exe, "-v")
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	out, _ := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if idx := strings.Index(s, "nginx/"); idx >= 0 {
		return strings.TrimSpace(s[idx:])
	}
	return s
}

func (m *Manager) TestConfig() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.testConfigLocked()
}

func (m *Manager) testConfigLocked() (string, error) {
	dir := m.NginxDir()
	exe := filepath.Join(dir, "nginx.exe")
	prefix := dir + string(os.PathSeparator)

	cmd := exec.Command(exe, "-t", "-p", prefix, "-c", "conf/nginx.conf")
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return strings.TrimSpace(out.String()), err
}

func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.startLocked()
}

func (m *Manager) startLocked() error {
	if _, running := m.detectRunningPID(); running {
		return nil
	}
	if err := m.ensureReadyLocked(); err != nil {
		return err
	}
	if out, err := m.testConfigLocked(); err != nil {
		return fmt.Errorf("Nginx 配置校验失败: %s", out)
	}

	dir := m.NginxDir()
	exe := filepath.Join(dir, "nginx.exe")
	prefix := dir + string(os.PathSeparator)

	cmd := exec.Command(exe, "-p", prefix, "-c", "conf/nginx.conf")
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 Nginx 失败: %w", err)
	}
	go func() {
		_ = cmd.Wait()
	}()

	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if _, running := m.detectRunningPID(); running {
			return nil
		}
		time.Sleep(150 * time.Millisecond)
	}

	errLog := m.readTailLog(filepath.Join(dir, "logs", "error.log"), 10)
	if errLog != "" {
		return fmt.Errorf("Nginx 启动超时或异常退出，错误日志:\n%s", errLog)
	}
	return errors.New("Nginx 启动超时，请检查端口占用或错误日志")
}

func (m *Manager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stopLocked()
}

func (m *Manager) stopLocked() error {
	pid, running := m.detectRunningPID()
	if !running {
		return nil
	}
	dir := m.NginxDir()
	exe := filepath.Join(dir, "nginx.exe")
	prefix := dir + string(os.PathSeparator)

	cmd := exec.Command(exe, "-p", prefix, "-c", "conf/nginx.conf", "-s", "quit")
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	_ = cmd.Run()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, still := m.detectRunningPID(); !still {
			return nil
		}
		time.Sleep(150 * time.Millisecond)
	}

	// Fallback: force stop
	stopCmd := exec.Command(exe, "-p", prefix, "-c", "conf/nginx.conf", "-s", "stop")
	stopCmd.Dir = dir
	stopCmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	_ = stopCmd.Run()

	time.Sleep(300 * time.Millisecond)
	if _, still := m.detectRunningPID(); still {
		if p, err := process.NewProcess(pid); err == nil {
			if children, err := p.Children(); err == nil {
				for _, ch := range children {
					_ = ch.Kill()
				}
			}
			_ = p.Kill()
		}
	}
	_ = os.Remove(filepath.Join(dir, "logs", "nginx.pid"))
	return nil
}

func (m *Manager) Reload() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.reloadLocked()
}

func (m *Manager) reloadLocked() error {
	if out, err := m.testConfigLocked(); err != nil {
		return fmt.Errorf("Nginx 配置校验失败: %s", out)
	}
	if _, running := m.detectRunningPID(); !running {
		return nil
	}
	dir := m.NginxDir()
	exe := filepath.Join(dir, "nginx.exe")
	prefix := dir + string(os.PathSeparator)

	cmd := exec.Command(exe, "-p", prefix, "-c", "conf/nginx.conf", "-s", "reload")
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Nginx 重载失败: %s", strings.TrimSpace(out.String()))
	}
	return nil
}

func (m *Manager) Restart() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.stopLocked(); err != nil {
		return err
	}
	return m.startLocked()
}

func (m *Manager) validateSiteInput(in SiteInput) (SiteInput, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return in, errors.New("站点名称不能为空")
	}

	domains := make([]string, 0, len(in.Domains))
	for _, d := range in.Domains {
		d = strings.TrimSpace(d)
		if d != "" {
			if strings.ContainsAny(d, ";{}\r\n") {
				return in, fmt.Errorf("域名包含非法字符: %s", d)
			}
			domains = append(domains, d)
		}
	}
	in.Domains = domains

	if in.ListenPort == 0 {
		if in.SSL {
			in.ListenPort = 443
		} else {
			in.ListenPort = 80
		}
	}
	if in.ListenPort < 1 || in.ListenPort > 65535 {
		return in, errors.New("监听端口必须在 1-65535 之间")
	}

	in.Upstream = strings.TrimSpace(in.Upstream)
	if in.Upstream == "" {
		return in, errors.New("反代目标地址 (Upstream) 不能为空")
	}
	u, err := url.Parse(in.Upstream)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return in, errors.New("反代目标地址格式无效，例如 http://127.0.0.1:3000")
	}
	if strings.ContainsAny(in.Upstream, ";{}\r\n ") {
		return in, errors.New("反代目标地址包含非法字符")
	}

	if in.SSL {
		if strings.TrimSpace(in.CertID) == "" {
			return in, errors.New("启用 HTTPS 时必须选择 SSL 证书")
		}
		if _, ok := m.store.GetCert(in.CertID); !ok {
			return in, errors.New("所选 SSL 证书不存在")
		}
	} else {
		in.ForceHTTPS = false
	}

	if strings.TrimSpace(in.ClientMaxBodySize) == "" {
		in.ClientMaxBodySize = "50m"
	} else if strings.ContainsAny(in.ClientMaxBodySize, ";{}\r\n ") {
		return in, errors.New("client_max_body_size 格式无效")
	}
	return in, nil
}

func (m *Manager) ListSites() []config.ProxySite {
	return m.store.ListProxies()
}

func (m *Manager) CreateSite(raw SiteInput) (config.ProxySite, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.ensureReadyLocked(); err != nil {
		return config.ProxySite{}, err
	}
	in, err := m.validateSiteInput(raw)
	if err != nil {
		return config.ProxySite{}, err
	}

	now := time.Now()
	site := config.ProxySite{
		ID:                config.GenerateID(),
		Name:              in.Name,
		Enabled:           in.Enabled,
		Domains:           in.Domains,
		ListenPort:        in.ListenPort,
		Upstream:          in.Upstream,
		SSL:               in.SSL,
		CertID:            in.CertID,
		ForceHTTPS:        in.ForceHTTPS,
		WebSocket:         in.WebSocket,
		RealIPHeaders:     in.RealIPHeaders,
		ClientMaxBodySize: in.ClientMaxBodySize,
		CustomConfig:      in.CustomConfig,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	if err := m.applySingleSiteWithRollbackLocked(site); err != nil {
		return config.ProxySite{}, err
	}

	if err := m.store.SaveProxies(func(sites []config.ProxySite) ([]config.ProxySite, error) {
		return append(sites, site), nil
	}); err != nil {
		return config.ProxySite{}, err
	}
	return site, nil
}

func (m *Manager) UpdateSite(id string, raw SiteInput) (config.ProxySite, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.ensureReadyLocked(); err != nil {
		return config.ProxySite{}, err
	}
	existing, ok := m.store.GetProxy(id)
	if !ok {
		return config.ProxySite{}, errors.New("站点不存在")
	}
	in, err := m.validateSiteInput(raw)
	if err != nil {
		return config.ProxySite{}, err
	}

	updated := existing
	updated.Name = in.Name
	updated.Enabled = in.Enabled
	updated.Domains = in.Domains
	updated.ListenPort = in.ListenPort
	updated.Upstream = in.Upstream
	updated.SSL = in.SSL
	updated.CertID = in.CertID
	updated.ForceHTTPS = in.ForceHTTPS
	updated.WebSocket = in.WebSocket
	updated.RealIPHeaders = in.RealIPHeaders
	updated.ClientMaxBodySize = in.ClientMaxBodySize
	updated.CustomConfig = in.CustomConfig
	updated.UpdatedAt = time.Now()

	if err := m.applySingleSiteWithRollbackLocked(updated); err != nil {
		return config.ProxySite{}, err
	}

	if err := m.store.SaveProxies(func(sites []config.ProxySite) ([]config.ProxySite, error) {
		for i := range sites {
			if sites[i].ID == id {
				sites[i] = updated
				return sites, nil
			}
		}
		return sites, errors.New("站点不存在")
	}); err != nil {
		return config.ProxySite{}, err
	}
	return updated, nil
}

func (m *Manager) DeleteSite(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.store.GetProxy(id); !ok {
		return errors.New("站点不存在")
	}
	confPath := filepath.Join(m.ConfDir(), id+".conf")
	oldBytes, existed := readOptionalFile(confPath)
	_ = os.Remove(confPath)

	if err := m.reloadLocked(); err != nil {
		if existed {
			_ = os.WriteFile(confPath, oldBytes, 0o644)
		}
		return err
	}

	return m.store.SaveProxies(func(sites []config.ProxySite) ([]config.ProxySite, error) {
		out := make([]config.ProxySite, 0, len(sites))
		for _, s := range sites {
			if s.ID != id {
				out = append(out, s)
			}
		}
		return out, nil
	})
}

func (m *Manager) PreviewSiteConfig(id string) (string, error) {
	site, ok := m.store.GetProxy(id)
	if !ok {
		return "", errors.New("站点不存在")
	}
	var certPtr *config.Certificate
	if site.SSL {
		c, ok := m.store.GetCert(site.CertID)
		if !ok {
			return "", errors.New("关联证书不存在")
		}
		certPtr = &c
	}
	return RenderSiteConfig(site, certPtr, m.store.ACMEWebrootDir())
}

// applySingleSiteWithRollbackLocked writes or removes conf.d/<id>.conf, runs nginx -t,
// automatically rolls back if validation fails, and reloads nginx if running.
func (m *Manager) applySingleSiteWithRollbackLocked(site config.ProxySite) error {
	confPath := filepath.Join(m.ConfDir(), site.ID+".conf")
	oldBytes, existed := readOptionalFile(confPath)

	if site.Enabled {
		var certPtr *config.Certificate
		if site.SSL {
			c, ok := m.store.GetCert(site.CertID)
			if !ok {
				return errors.New("所选 SSL 证书不存在")
			}
			certPtr = &c
		}
		rendered, err := RenderSiteConfig(site, certPtr, m.store.ACMEWebrootDir())
		if err != nil {
			return err
		}
		if err := os.WriteFile(confPath, []byte(rendered), 0o644); err != nil {
			return fmt.Errorf("写入站点配置失败: %w", err)
		}
	} else {
		_ = os.Remove(confPath)
	}

	if out, err := m.testConfigLocked(); err != nil {
		// Rollback!
		if existed {
			_ = os.WriteFile(confPath, oldBytes, 0o644)
		} else {
			_ = os.Remove(confPath)
		}
		return fmt.Errorf("Nginx 配置校验失败，已自动回滚:\n%s", out)
	}

	if err := m.reloadLocked(); err != nil {
		if existed {
			_ = os.WriteFile(confPath, oldBytes, 0o644)
		} else {
			_ = os.Remove(confPath)
		}
		return err
	}
	return nil
}

// WithACMEHTTP01Server temporarily ensures port 80 serves /.well-known/acme-challenge/
// for the target domains while an HTTP-01 challenge executes.
func (m *Manager) WithACMEHTTP01Server(domains []string, fn func() error) error {
	m.mu.Lock()
	if err := m.ensureReadyLocked(); err != nil {
		m.mu.Unlock()
		return err
	}

	// Check if any enabled site already listens on port 80 for these domains
	needsTemp := true
	for _, s := range m.store.ListProxies() {
		if s.Enabled && (s.ListenPort == 80 || (s.SSL && s.ForceHTTPS)) {
			if coversAllDomains(s.Domains, domains) {
				needsTemp = false
				break
			}
		}
	}

	wasRunning := false
	if _, running := m.detectRunningPID(); running {
		wasRunning = true
	}

	tempConf := filepath.Join(m.ConfDir(), "_acme_temp.conf")
	if needsTemp {
		rendered, err := RenderACMETempConfig(domains, m.store.ACMEWebrootDir())
		if err != nil {
			m.mu.Unlock()
			return err
		}
		if err := os.WriteFile(tempConf, []byte(rendered), 0o644); err != nil {
			m.mu.Unlock()
			return err
		}
	}

	var startErr error
	if !wasRunning {
		startErr = m.startLocked()
	} else if needsTemp {
		startErr = m.reloadLocked()
	}
	m.mu.Unlock()

	if startErr != nil {
		m.mu.Lock()
		if needsTemp {
			_ = os.Remove(tempConf)
			if wasRunning {
				_ = m.reloadLocked()
			}
		}
		m.mu.Unlock()
		return fmt.Errorf("准备 ACME HTTP-01 验证服务失败: %w", startErr)
	}

	// Execute ACME challenge
	runErr := fn()

	// Cleanup
	m.mu.Lock()
	if needsTemp {
		_ = os.Remove(tempConf)
	}
	if !wasRunning {
		_ = m.stopLocked()
	} else if needsTemp {
		_ = m.reloadLocked()
	}
	m.mu.Unlock()

	return runErr
}

func coversAllDomains(siteDomains, targetDomains []string) bool {
	set := make(map[string]bool, len(siteDomains))
	for _, d := range siteDomains {
		set[strings.ToLower(strings.TrimSpace(d))] = true
	}
	for _, t := range targetDomains {
		if !set[strings.ToLower(strings.TrimSpace(t))] {
			return false
		}
	}
	return len(targetDomains) > 0
}

func (m *Manager) ReadLogs(logType string, lines int) (string, error) {
	if lines <= 0 || lines > 2000 {
		lines = 200
	}
	filename := "access.log"
	if logType == "error" {
		filename = "error.log"
	}
	logPath := filepath.Join(m.NginxDir(), "logs", filename)
	return m.readTailLog(logPath, lines), nil
}

func (m *Manager) readTailLog(path string, maxLines int) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	all := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(all) <= maxLines {
		return strings.Join(all, "\n")
	}
	return strings.Join(all[len(all)-maxLines:], "\n")
}

func (m *Manager) UpdateSettings(autoStart bool, customPath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.store.UpdateConfig(func(c *config.PanelConfig) error {
		c.Nginx.AutoStart = autoStart
		c.Nginx.CustomPath = strings.TrimSpace(customPath)
		return nil
	})
}

func readOptionalFile(path string) ([]byte, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	return b, true
}
