package nginx

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"win-server-panel/internal/config"
)

func getFreePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func TestEmbeddedNginxReverseProxyAndRollback(t *testing.T) {
	// Start a local target backend HTTP server
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Backend", "ok")
		_, _ = fmt.Fprintf(w, "proxied:%s", r.URL.Path)
	}))
	defer backend.Close()

	store, err := config.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mgr := NewManager(store)

	if err := mgr.EnsureReady(); err != nil {
		t.Fatalf("EnsureReady (extract embedded nginx) failed: %v", err)
	}

	proxyPort := getFreePort(t)
	site, err := mgr.CreateSite(SiteInput{
		Name:          "Test Proxy",
		Enabled:       true,
		Domains:       []string{"localhost", "127.0.0.1"},
		ListenPort:    proxyPort,
		Upstream:      backend.URL,
		WebSocket:     true,
		RealIPHeaders: true,
	})
	if err != nil {
		t.Fatalf("CreateSite failed: %v", err)
	}

	if err := mgr.Start(); err != nil {
		t.Fatalf("Nginx Start failed: %v", err)
	}
	defer func() {
		_ = mgr.Stop()
	}()

	st := mgr.Status()
	if !st.Running || st.PID <= 0 {
		t.Fatalf("expected Nginx running, got status: %+v", st)
	}

	// Verify live HTTP reverse proxy forwarding (retry briefly while Nginx worker binds the socket under CI load)
	client := &http.Client{Timeout: 5 * time.Second}
	var resp *http.Response
	deadline := time.Now().Add(8 * time.Second)
	for {
		resp, err = client.Get(fmt.Sprintf("http://127.0.0.1:%d/hello-wsp", proxyPort))
		if err == nil || time.Now().After(deadline) {
			break
		}
		time.Sleep(150 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("proxy GET failed: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(body) != "proxied:/hello-wsp" {
		t.Fatalf("unexpected proxied response: status=%d body=%q", resp.StatusCode, string(body))
	}

	// Submit invalid Nginx custom config -> must fail validation & rollback without breaking proxy!
	_, err = mgr.UpdateSite(site.ID, SiteInput{
		Name:         "Test Proxy",
		Enabled:      true,
		Domains:      []string{"localhost", "127.0.0.1"},
		ListenPort:   proxyPort,
		Upstream:     backend.URL,
		CustomConfig: "invalid_nginx_directive_xyz 123;",
	})
	if err == nil || !strings.Contains(err.Error(), "回滚") {
		t.Fatalf("expected rollback error on invalid directive, got: %v", err)
	}

	// Confirm original reverse proxy still works after rollback!
	resp2, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/after-rollback", proxyPort))
	if err != nil {
		t.Fatalf("proxy GET after rollback failed: %v", err)
	}
	body2, _ := io.ReadAll(resp2.Body)
	resp2.Body.Close()
	if resp2.StatusCode != 200 || string(body2) != "proxied:/after-rollback" {
		t.Fatalf("unexpected response after rollback: status=%d body=%q", resp2.StatusCode, string(body2))
	}

	if err := mgr.Stop(); err != nil {
		t.Fatalf("Nginx Stop failed: %v", err)
	}
	if mgr.Status().Running {
		t.Fatal("expected Nginx to be stopped")
	}
}
