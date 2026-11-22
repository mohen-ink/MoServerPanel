package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/windows"
)

type Store struct {
	mu          sync.RWMutex
	dataDir     string
	cfg         PanelConfig
	proxies     []ProxySite
	certs       []Certificate
	dnsAccounts []DNSAccount
	fwRules     []FirewallRule
}

func NewStore(dataDir string) (*Store, error) {
	absDir, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("resolve dataDir: %w", err)
	}
	subDirs := []string{
		absDir,
		filepath.Join(absDir, "store"),
		filepath.Join(absDir, "certs"),
		filepath.Join(absDir, "acme-webroot", ".well-known", "acme-challenge"),
		filepath.Join(absDir, "acme-accounts"),
	}
	for _, d := range subDirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, fmt.Errorf("create dir %s: %w", d, err)
		}
	}
	absDir = ExpandLongPath(absDir)

	s := &Store{
		dataDir:     absDir,
		proxies:     []ProxySite{},
		certs:       []Certificate{},
		dnsAccounts: []DNSAccount{},
		fwRules:     []FirewallRule{},
	}

	if err := s.loadAll(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) DataDir() string {
	return s.dataDir
}

// ExpandLongPath converts Windows 8.3 short path segments (e.g. RUNNER~1) into
// full long path names so embedded Windows Nginx (which rejects 8.3 short paths) works reliably.
func ExpandLongPath(path string) string {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return path
	}
	buf := make([]uint16, 260)
	n, err := windows.GetLongPathName(p, &buf[0], uint32(len(buf)))
	if err != nil || n == 0 {
		return path
	}
	if n > uint32(len(buf)) {
		buf = make([]uint16, n)
		n, err = windows.GetLongPathName(p, &buf[0], uint32(len(buf)))
		if err != nil || n == 0 || n >= uint32(len(buf)) {
			return path
		}
	}
	return windows.UTF16ToString(buf[:n])
}

func (s *Store) StoreDir() string {
	return filepath.Join(s.dataDir, "store")
}

func (s *Store) CertsDir() string {
	return filepath.Join(s.dataDir, "certs")
}

func (s *Store) ACMEWebrootDir() string {
	return filepath.Join(s.dataDir, "acme-webroot")
}

func (s *Store) ACMEAccountsDir() string {
	return filepath.Join(s.dataDir, "acme-accounts")
}

func (s *Store) NginxDir() string {
	return filepath.Join(s.dataDir, "nginx")
}

func (s *Store) SSHHostKeyPath() string {
	return filepath.Join(s.dataDir, "ssh_host_ed25519_key")
}

func (s *Store) loadAll() error {
	cfgPath := filepath.Join(s.StoreDir(), "config.json")
	if _, err := os.Stat(cfgPath); errors.Is(err, os.ErrNotExist) {
		secret, err := randomHex(32)
		if err != nil {
			return err
		}
		s.cfg = DefaultPanelConfig(secret)
		if err := atomicWriteJSON(cfgPath, s.cfg); err != nil {
			return err
		}
	} else {
		if err := readJSON(cfgPath, &s.cfg); err != nil {
			return fmt.Errorf("load config.json: %w", err)
		}
		changed := false
		if s.cfg.Auth.JWTSecret == "" {
			secret, err := randomHex(32)
			if err != nil {
				return err
			}
			s.cfg.Auth.JWTSecret = secret
			changed = true
		}
		if s.cfg.Auth.TokenTTLHours <= 0 {
			s.cfg.Auth.TokenTTLHours = 24
			changed = true
		}
		if s.cfg.ListenAddr == "" {
			s.cfg.ListenAddr = "0.0.0.0"
			changed = true
		}
		if s.cfg.Port <= 0 {
			s.cfg.Port = 8900
			changed = true
		}
		if s.cfg.SSH.ListenAddr == "" {
			s.cfg.SSH.ListenAddr = "0.0.0.0"
			changed = true
		}
		if s.cfg.SSH.Port <= 0 {
			s.cfg.SSH.Port = 2222
			changed = true
		}
		if s.cfg.SSH.DefaultShell == "" {
			s.cfg.SSH.DefaultShell = "powershell"
			changed = true
		}
		if changed {
			if err := atomicWriteJSON(cfgPath, s.cfg); err != nil {
				return err
			}
		}
	}

	if err := readJSONIfExists(filepath.Join(s.StoreDir(), "proxies.json"), &s.proxies); err != nil {
		return fmt.Errorf("load proxies.json: %w", err)
	}
	if err := readJSONIfExists(filepath.Join(s.StoreDir(), "certs.json"), &s.certs); err != nil {
		return fmt.Errorf("load certs.json: %w", err)
	}
	if err := readJSONIfExists(filepath.Join(s.StoreDir(), "dns_accounts.json"), &s.dnsAccounts); err != nil {
		return fmt.Errorf("load dns_accounts.json: %w", err)
	}
	if err := readJSONIfExists(filepath.Join(s.StoreDir(), "firewall.json"), &s.fwRules); err != nil {
		return fmt.Errorf("load firewall.json: %w", err)
	}
	return nil
}

func (s *Store) GetConfig() PanelConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *Store) UpdateConfig(fn func(*PanelConfig) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.cfg
	if err := fn(&next); err != nil {
		return err
	}
	if err := atomicWriteJSON(filepath.Join(s.StoreDir(), "config.json"), next); err != nil {
		return err
	}
	s.cfg = next
	return nil
}

func (s *Store) ListProxies() []ProxySite {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ProxySite, len(s.proxies))
	copy(out, s.proxies)
	return out
}

func (s *Store) GetProxy(id string) (ProxySite, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, p := range s.proxies {
		if p.ID == id {
			return p, true
		}
	}
	return ProxySite{}, false
}

func (s *Store) SaveProxies(fn func([]ProxySite) ([]ProxySite, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]ProxySite, len(s.proxies))
	copy(cp, s.proxies)
	next, err := fn(cp)
	if err != nil {
		return err
	}
	if next == nil {
		next = []ProxySite{}
	}
	if err := atomicWriteJSON(filepath.Join(s.StoreDir(), "proxies.json"), next); err != nil {
		return err
	}
	s.proxies = next
	return nil
}

func (s *Store) ListCerts() []Certificate {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Certificate, len(s.certs))
	copy(out, s.certs)
	return out
}

func (s *Store) GetCert(id string) (Certificate, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, c := range s.certs {
		if c.ID == id {
			return c, true
		}
	}
	return Certificate{}, false
}

func (s *Store) SaveCerts(fn func([]Certificate) ([]Certificate, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]Certificate, len(s.certs))
	copy(cp, s.certs)
	next, err := fn(cp)
	if err != nil {
		return err
	}
	if next == nil {
		next = []Certificate{}
	}
	if err := atomicWriteJSON(filepath.Join(s.StoreDir(), "certs.json"), next); err != nil {
		return err
	}
	s.certs = next
	return nil
}

func cloneStringMap(m map[string]string) map[string]string {
	if m == nil {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func cloneDNSAccount(a DNSAccount) DNSAccount {
	a.Config = cloneStringMap(a.Config)
	return a
}

func (s *Store) ListDNSAccounts() []DNSAccount {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]DNSAccount, len(s.dnsAccounts))
	for i, a := range s.dnsAccounts {
		out[i] = cloneDNSAccount(a)
	}
	return out
}

func (s *Store) GetDNSAccount(id string) (DNSAccount, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.dnsAccounts {
		if a.ID == id {
			return cloneDNSAccount(a), true
		}
	}
	return DNSAccount{}, false
}

func (s *Store) SaveDNSAccounts(fn func([]DNSAccount) ([]DNSAccount, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]DNSAccount, len(s.dnsAccounts))
	for i, a := range s.dnsAccounts {
		cp[i] = cloneDNSAccount(a)
	}
	next, err := fn(cp)
	if err != nil {
		return err
	}
	if next == nil {
		next = []DNSAccount{}
	}
	if err := atomicWriteJSON(filepath.Join(s.StoreDir(), "dns_accounts.json"), next); err != nil {
		return err
	}
	stored := make([]DNSAccount, len(next))
	for i, a := range next {
		stored[i] = cloneDNSAccount(a)
	}
	s.dnsAccounts = stored
	return nil
}

func (s *Store) ListFirewallRules() []FirewallRule {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]FirewallRule, len(s.fwRules))
	copy(out, s.fwRules)
	return out
}

func (s *Store) GetFirewallRule(id string) (FirewallRule, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.fwRules {
		if r.ID == id {
			return r, true
		}
	}
	return FirewallRule{}, false
}

func (s *Store) SaveFirewallRules(fn func([]FirewallRule) ([]FirewallRule, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]FirewallRule, len(s.fwRules))
	copy(cp, s.fwRules)
	next, err := fn(cp)
	if err != nil {
		return err
	}
	if next == nil {
		next = []FirewallRule{}
	}
	if err := atomicWriteJSON(filepath.Join(s.StoreDir(), "firewall.json"), next); err != nil {
		return err
	}
	s.fwRules = next
	return nil
}

func GenerateID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func randomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func readJSON(path string, v any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

func readJSONIfExists(path string, v any) error {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return readJSON(path, v)
}

func atomicWriteJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return err
	}
	// On Windows os.Rename replaces existing destination in Go 1.5+ via MoveFileEx MOVEFILE_REPLACE_EXISTING.
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}
