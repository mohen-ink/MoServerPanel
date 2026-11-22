package config

import (
	"os"
	"strings"
	"testing"
)

func TestStorePersistence(t *testing.T) {
	dir := t.TempDir()
	s1, err := NewStore(dir)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}

	cfg := s1.GetConfig()
	if cfg.Port != 8900 || cfg.Auth.JWTSecret == "" {
		t.Fatalf("unexpected default config: %+v", cfg)
	}

	if err := s1.UpdateConfig(func(c *PanelConfig) error {
		c.Port = 9001
		c.SSH.Port = 2200
		return nil
	}); err != nil {
		t.Fatalf("UpdateConfig failed: %v", err)
	}

	if err := s1.SaveProxies(func(list []ProxySite) ([]ProxySite, error) {
		return append(list, ProxySite{
			ID:         "site1",
			Name:       "Test Site",
			Enabled:    true,
			ListenPort: 8080,
			Upstream:   "http://127.0.0.1:3000",
		}), nil
	}); err != nil {
		t.Fatalf("SaveProxies failed: %v", err)
	}

	// Reload from disk in a fresh Store instance
	s2, err := NewStore(dir)
	if err != nil {
		t.Fatalf("reload NewStore failed: %v", err)
	}
	if s2.GetConfig().Port != 9001 || s2.GetConfig().SSH.Port != 2200 {
		t.Fatalf("reloaded config mismatch: %+v", s2.GetConfig())
	}
	p, ok := s2.GetProxy("site1")
	if !ok || p.Name != "Test Site" {
		t.Fatalf("reloaded proxy mismatch: %+v, ok=%v", p, ok)
	}
}

func TestExpandLongPath(t *testing.T) {
	if _, err := os.Stat(`C:\PROGRA~1`); err == nil {
		got := ExpandLongPath(`C:\PROGRA~1`)
		if strings.Contains(got, "~") || !strings.EqualFold(got, `C:\Program Files`) {
			t.Fatalf("ExpandLongPath(`C:\\PROGRA~1`) = %q, want `C:\\Program Files`", got)
		}
	}

	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	if strings.Contains(s.DataDir(), "~") {
		t.Fatalf("expected expanded DataDir without 8.3 short name, got %q", s.DataDir())
	}
}
