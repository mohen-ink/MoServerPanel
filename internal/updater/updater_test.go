package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"win-server-panel/internal/config"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.1.0", "0.1.0", 0},
		{"v0.1.0", "0.1.0", 0},
		{"0.1.0-dev", "0.1.0", -1},
		{"0.1.0", "0.1.0-dev", 1},
		{"0.1.0", "0.1.1", -1},
		{"0.1.9", "0.1.10", -1},
		{"0.2.0-beta.1", "0.2.0", -1},
		{"0.2.0", "0.1.99", 1},
		{"1.0.0", "0.9.9", 1},
		{"0.2.0-alpha.1", "0.2.0-beta.1", -1},
	}

	for _, tc := range cases {
		if got := CompareVersions(tc.a, tc.b); got != tc.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestParseChecksum(t *testing.T) {
	validHash := strings.Repeat("a1", 32)
	content := validHash + "  mo-server-panel.exe\n" + strings.Repeat("b2", 32) + " *other.zip\n"

	got, err := ParseChecksum(content, "mo-server-panel.exe")
	if err != nil {
		t.Fatalf("ParseChecksum failed: %v", err)
	}
	if got != validHash {
		t.Fatalf("got %q, want %q", got, validHash)
	}

	if _, err := ParseChecksum(content, "missing.exe"); err == nil {
		t.Fatal("expected error for missing asset")
	}
	if _, err := ParseChecksum("not-a-valid-hash  mo-server-panel.exe", "mo-server-panel.exe"); err == nil {
		t.Fatal("expected error for malformed hash")
	}
}

func TestCheckWithMockGitHubAPI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/mohen-ink/MoServerPanel/releases/latest" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(githubRelease{
			TagName:     "v0.2.0",
			Name:        "MoServerPanel v0.2.0",
			Body:        "### Added\n- GitHub self-update",
			HTMLURL:     "https://github.com/mohen-ink/MoServerPanel/releases/tag/v0.2.0",
			PublishedAt: "2026-11-22T12:00:00Z",
			Assets: []githubAsset{
				{
					Name:               "mo-server-panel.exe",
					Size:               18110976,
					BrowserDownloadURL: "https://example.com/mo-server-panel.exe",
				},
				{
					Name:               "SHA256SUMS.txt",
					Size:               87,
					BrowserDownloadURL: "https://example.com/SHA256SUMS.txt",
				},
			},
		})
	}))
	defer srv.Close()

	mgr := NewManager("0.1.0", nil)
	mgr.apiBase = srv.URL

	res, err := mgr.Check(context.Background())
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}
	if !res.HasUpdate {
		t.Fatalf("expected HasUpdate=true, got %+v", res)
	}
	if res.LatestVersion != "0.2.0" || res.AssetName != "mo-server-panel.exe" || !res.HasChecksum {
		t.Fatalf("unexpected CheckResult: %+v", res)
	}

	// Same version should report HasUpdate=false
	mgrSame := NewManager("0.2.0", nil)
	mgrSame.apiBase = srv.URL
	resSame, err := mgrSame.Check(context.Background())
	if err != nil {
		t.Fatalf("Check same version failed: %v", err)
	}
	if resSame.HasUpdate {
		t.Fatalf("expected HasUpdate=false for same version, got %+v", resSame)
	}
}

func TestCheckUsesCustomProxy(t *testing.T) {
	proxyHit := false
	proxySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyHit = true
		_ = json.NewEncoder(w).Encode(githubRelease{
			TagName: "v0.9.0",
			Name:    "Proxied Release",
		})
	}))
	defer proxySrv.Close()

	mgr := NewManager("0.1.0", nil)
	mgr.apiBase = "http://api.github.invalid"
	mgr.SetProxyProvider(func() config.ProxyConfig {
		return config.ProxyConfig{Mode: "custom", URL: proxySrv.URL}
	})

	res, err := mgr.Check(context.Background())
	if err != nil {
		t.Fatalf("Check via custom proxy failed: %v", err)
	}
	if !proxyHit || !res.HasUpdate || res.LatestVersion != "0.9.0" {
		t.Fatalf("expected request to route through custom proxy, hit=%v res=%+v", proxyHit, res)
	}
}

func TestSpawnDetachedPowerShell(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "detached-ok.txt")
	quoted := "'" + strings.ReplaceAll(marker, "'", "''") + "'"
	script := fmt.Sprintf("Set-Content -Path %s -Value 'ok' -NoNewline", quoted)

	if err := spawnDetachedPowerShell(script); err != nil {
		t.Fatalf("spawnDetachedPowerShell failed: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if raw, err := os.ReadFile(marker); err == nil && strings.TrimSpace(string(raw)) == "ok" {
			return
		}
		time.Sleep(150 * time.Millisecond)
	}
	t.Fatalf("detached PowerShell script did not create marker file %s within timeout", marker)
}
