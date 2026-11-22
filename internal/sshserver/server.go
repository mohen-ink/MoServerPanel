package sshserver

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/ssh"

	"win-server-panel/internal/auth"
	"win-server-panel/internal/config"
)

type Status struct {
	Running         bool          `json:"running"`
	Enabled         bool          `json:"enabled"`
	AutoStart       bool          `json:"autoStart"`
	ListenAddr      string        `json:"listenAddr"`
	Port            int           `json:"port"`
	Username        string        `json:"username"`
	PasswordSet     bool          `json:"passwordSet"`
	DefaultShell    string        `json:"defaultShell"`
	EnableSFTP      bool          `json:"enableSftp"`
	ActiveSessions  int           `json:"activeSessions"`
	HostFingerprint string        `json:"hostFingerprint"`
	Sessions        []SessionInfo `json:"sessions"`
}

type SessionInfo struct {
	ID        string    `json:"id"`
	RemoteIP  string    `json:"remoteIp"`
	Username  string    `json:"username"`
	Mode      string    `json:"mode"` // "connected", "shell", "exec", "sftp"
	StartedAt time.Time `json:"startedAt"`
}

type UpdateConfigInput struct {
	AutoStart    bool   `json:"autoStart"`
	ListenAddr   string `json:"listenAddr"`
	Port         int    `json:"port"`
	Username     string `json:"username"`
	Password     string `json:"password"` // optional: empty keeps existing password
	DefaultShell string `json:"defaultShell"`
	EnableSFTP   bool   `json:"enableSftp"`
}

type activeSession struct {
	info SessionInfo
	conn *ssh.ServerConn
}

type Manager struct {
	mu          sync.Mutex
	store       *config.Store
	limiter     *auth.RateLimiter
	listener    net.Listener
	hostSigner  ssh.Signer
	fingerprint string
	running     bool
	sessions    map[string]*activeSession
	sessMu      sync.RWMutex
}

func NewManager(store *config.Store, limiter *auth.RateLimiter) *Manager {
	return &Manager{
		store:    store,
		limiter:  limiter,
		sessions: make(map[string]*activeSession),
	}
}

func (m *Manager) ensureHostKeyLocked() error {
	if m.hostSigner != nil {
		return nil
	}
	keyPath := m.store.SSHHostKeyPath()
	raw, err := os.ReadFile(keyPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		_, priv, genErr := ed25519.GenerateKey(rand.Reader)
		if genErr != nil {
			return fmt.Errorf("生成 SSH 主机密钥失败: %w", genErr)
		}
		block, marshalErr := ssh.MarshalPrivateKey(priv, "MoServerPanel SSH Host Key")
		if marshalErr != nil {
			return fmt.Errorf("编码 SSH 主机密钥失败: %w", marshalErr)
		}
		raw = pem.EncodeToMemory(block)
		if writeErr := os.WriteFile(keyPath, raw, 0o600); writeErr != nil {
			return fmt.Errorf("保存 SSH 主机密钥失败: %w", writeErr)
		}
	}

	signer, err := ssh.ParsePrivateKey(raw)
	if err != nil {
		return fmt.Errorf("解析 SSH 主机密钥失败: %w", err)
	}
	m.hostSigner = signer
	m.fingerprint = ssh.FingerprintSHA256(signer.PublicKey())
	return nil
}

func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.startLocked()
}

func (m *Manager) startLocked() error {
	if m.running {
		return nil
	}
	cfg := m.store.GetConfig().SSH
	if strings.TrimSpace(cfg.Username) == "" || strings.TrimSpace(cfg.PasswordHash) == "" {
		return errors.New("请先设置 SSH 用户名和密码后再启动服务")
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return errors.New("SSH 端口必须在 1-65535 之间")
	}

	if err := m.ensureHostKeyLocked(); err != nil {
		return err
	}

	addr := fmt.Sprintf("%s:%d", cfg.ListenAddr, cfg.Port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("监听 SSH 地址 %s 失败: %w", addr, err)
	}

	m.listener = ln
	m.running = true

	_ = m.store.UpdateConfig(func(c *config.PanelConfig) error {
		c.SSH.Enabled = true
		return nil
	})

	go m.acceptLoop(ln)
	return nil
}

func (m *Manager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stopLocked(true)
}

func (m *Manager) Shutdown() {
	m.mu.Lock()
	defer m.mu.Unlock()
	_ = m.stopLocked(false)
}

func (m *Manager) stopLocked(persistDisabled bool) error {
	if !m.running {
		return nil
	}
	m.running = false
	if m.listener != nil {
		_ = m.listener.Close()
		m.listener = nil
	}

	m.sessMu.Lock()
	for _, s := range m.sessions {
		if s.conn != nil {
			_ = s.conn.Close()
		}
	}
	m.sessions = make(map[string]*activeSession)
	m.sessMu.Unlock()

	if persistDisabled {
		_ = m.store.UpdateConfig(func(c *config.PanelConfig) error {
			c.SSH.Enabled = false
			return nil
		})
	}
	return nil
}

func (m *Manager) UpdateConfig(in UpdateConfigInput) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if in.Port < 1 || in.Port > 65535 {
		return errors.New("SSH 端口必须在 1-65535 之间")
	}
	username := strings.TrimSpace(in.Username)
	if username == "" {
		return errors.New("SSH 用户名不能为空")
	}
	listenAddr := strings.TrimSpace(in.ListenAddr)
	if listenAddr == "" {
		listenAddr = "0.0.0.0"
	}
	shell := strings.ToLower(strings.TrimSpace(in.DefaultShell))
	if shell != "cmd" {
		shell = "powershell"
	}

	var newHash string
	if in.Password != "" {
		if len(in.Password) < 6 {
			return errors.New("SSH 密码长度至少为 6 位")
		}
		h, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		newHash = string(h)
	}

	prevCfg := m.store.GetConfig().SSH
	if err := m.store.UpdateConfig(func(c *config.PanelConfig) error {
		c.SSH.AutoStart = in.AutoStart
		c.SSH.ListenAddr = listenAddr
		c.SSH.Port = in.Port
		c.SSH.Username = username
		if newHash != "" {
			c.SSH.PasswordHash = newHash
		}
		c.SSH.DefaultShell = shell
		c.SSH.EnableSFTP = in.EnableSFTP
		return nil
	}); err != nil {
		return err
	}

	// If running and bind address/port changed, restart listener cleanly
	if m.running && (prevCfg.Port != in.Port || prevCfg.ListenAddr != listenAddr) {
		_ = m.stopLocked(false)
		return m.startLocked()
	}
	return nil
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	running := m.running
	fp := m.fingerprint
	m.mu.Unlock()

	cfg := m.store.GetConfig().SSH
	sessions := m.ListSessions()
	return Status{
		Running:         running,
		Enabled:         cfg.Enabled,
		AutoStart:       cfg.AutoStart,
		ListenAddr:      cfg.ListenAddr,
		Port:            cfg.Port,
		Username:        cfg.Username,
		PasswordSet:     cfg.PasswordHash != "",
		DefaultShell:    cfg.DefaultShell,
		EnableSFTP:      cfg.EnableSFTP,
		ActiveSessions:  len(sessions),
		HostFingerprint: fp,
		Sessions:        sessions,
	}
}

func (m *Manager) ListSessions() []SessionInfo {
	m.sessMu.RLock()
	defer m.sessMu.RUnlock()
	out := make([]SessionInfo, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s.info)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].StartedAt.After(out[j].StartedAt)
	})
	return out
}

func (m *Manager) KickSession(id string) error {
	m.sessMu.RLock()
	sess, ok := m.sessions[id]
	m.sessMu.RUnlock()
	if !ok {
		return errors.New("会话不存在或已断开")
	}
	if sess.conn != nil {
		return sess.conn.Close()
	}
	return nil
}

func (m *Manager) updateSessionMode(id, mode string) {
	m.sessMu.Lock()
	defer m.sessMu.Unlock()
	if s, ok := m.sessions[id]; ok {
		s.info.Mode = mode
	}
}

func (m *Manager) acceptLoop(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			if !errors.Is(err, net.ErrClosed) {
				log.Printf("[ssh] accept error: %v", err)
			}
			return
		}
		go m.handleConn(conn)
	}
}

func (m *Manager) buildSSHConfig() *ssh.ServerConfig {
	cfg := &ssh.ServerConfig{
		ServerVersion: "SSH-2.0-MoServerPanel",
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			ip := extractIP(c.RemoteAddr())
			if banned, _ := m.limiter.IsBanned("ssh", ip); banned {
				return nil, errors.New("too many failed authentication attempts")
			}

			sshCfg := m.store.GetConfig().SSH
			if c.User() != sshCfg.Username || sshCfg.PasswordHash == "" {
				m.limiter.RecordFailure("ssh", ip)
				return nil, errors.New("invalid credentials")
			}
			if err := bcrypt.CompareHashAndPassword([]byte(sshCfg.PasswordHash), pass); err != nil {
				m.limiter.RecordFailure("ssh", ip)
				return nil, errors.New("invalid credentials")
			}

			m.limiter.RecordSuccess("ssh", ip)
			return &ssh.Permissions{
				Extensions: map[string]string{
					"user": c.User(),
				},
			}, nil
		},
	}
	cfg.AddHostKey(m.hostSigner)
	return cfg
}

func (m *Manager) handleConn(rawConn net.Conn) {
	defer rawConn.Close()

	ip := extractIP(rawConn.RemoteAddr())
	if banned, _ := m.limiter.IsBanned("ssh", ip); banned {
		return
	}

	sshConn, chans, reqs, err := ssh.NewServerConn(rawConn, m.buildSSHConfig())
	if err != nil {
		return
	}
	defer sshConn.Close()

	sessID := config.GenerateID()
	m.sessMu.Lock()
	m.sessions[sessID] = &activeSession{
		info: SessionInfo{
			ID:        sessID,
			RemoteIP:  ip,
			Username:  sshConn.User(),
			Mode:      "connected",
			StartedAt: time.Now(),
		},
		conn: sshConn,
	}
	m.sessMu.Unlock()

	defer func() {
		m.sessMu.Lock()
		delete(m.sessions, sessID)
		m.sessMu.Unlock()
	}()

	go ssh.DiscardRequests(reqs)

	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			_ = newChannel.Reject(ssh.UnknownChannelType, "unsupported channel type")
			continue
		}
		channel, requests, err := newChannel.Accept()
		if err != nil {
			continue
		}
		go m.handleSessionChannel(sessID, channel, requests)
	}
}

func extractIP(addr net.Addr) string {
	if addr == nil {
		return "unknown"
	}
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		return addr.String()
	}
	return host
}
