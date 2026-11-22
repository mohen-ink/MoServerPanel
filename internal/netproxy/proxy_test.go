package netproxy

import (
	"net/http"
	"net/url"
	"testing"

	"win-server-panel/internal/config"
)

func TestValidate(t *testing.T) {
	cfg, err := Validate(config.ProxyConfig{Mode: ""})
	if err != nil || cfg.Mode != "auto" {
		t.Fatalf("expected default auto, got %+v err=%v", cfg, err)
	}

	cfg, err = Validate(config.ProxyConfig{Mode: "custom", URL: "127.0.0.1:7897"})
	if err != nil || cfg.URL != "http://127.0.0.1:7897" {
		t.Fatalf("expected auto-prefixed http URL, got %+v err=%v", cfg, err)
	}

	cfg, err = Validate(config.ProxyConfig{Mode: "custom", URL: "socks5://127.0.0.1:7897"})
	if err != nil || cfg.URL != "socks5://127.0.0.1:7897" {
		t.Fatalf("expected socks5 URL, got %+v err=%v", cfg, err)
	}

	if _, err := Validate(config.ProxyConfig{Mode: "custom", URL: ""}); err == nil {
		t.Fatal("expected error for empty custom URL")
	}
	if _, err := Validate(config.ProxyConfig{Mode: "custom", URL: "ftp://127.0.0.1:21"}); err == nil {
		t.Fatal("expected error for unsupported proxy scheme")
	}
	if _, err := Validate(config.ProxyConfig{Mode: "invalid"}); err == nil {
		t.Fatal("expected error for invalid mode")
	}
}

func TestParseWindowsProxyServer(t *testing.T) {
	u, err := ParseWindowsProxyServer("127.0.0.1:7897", "https")
	if err != nil || u == nil || u.String() != "http://127.0.0.1:7897" {
		t.Fatalf("unexpected simple proxy parse: %v, err=%v", u, err)
	}

	u, err = ParseWindowsProxyServer("http=127.0.0.1:7890;https=127.0.0.1:7891;socks=127.0.0.1:7892", "https")
	if err != nil || u == nil || u.String() != "http://127.0.0.1:7891" {
		t.Fatalf("unexpected https entry parse: %v, err=%v", u, err)
	}

	u, err = ParseWindowsProxyServer("socks=127.0.0.1:1080", "https")
	if err != nil || u == nil || u.String() != "socks5://127.0.0.1:1080" {
		t.Fatalf("unexpected socks entry parse: %v, err=%v", u, err)
	}
}

func TestShouldBypassWindowsProxy(t *testing.T) {
	override := "localhost;127.*;10.*;192.168.*;*.internal;<local>"
	if !ShouldBypassWindowsProxy("localhost", override) {
		t.Fatal("expected localhost to bypass")
	}
	if !ShouldBypassWindowsProxy("127.0.0.1", override) {
		t.Fatal("expected 127.0.0.1 to bypass")
	}
	if !ShouldBypassWindowsProxy("intranet", override) {
		t.Fatal("expected single-label host to match <local>")
	}
	if !ShouldBypassWindowsProxy("api.internal", override) {
		t.Fatal("expected *.internal to bypass")
	}
	if ShouldBypassWindowsProxy("api.github.com", override) {
		t.Fatal("expected api.github.com NOT to bypass")
	}
}

func TestProxyFuncModes(t *testing.T) {
	req := &http.Request{URL: &url.URL{Scheme: "https", Host: "api.github.com"}}

	directFn := ProxyFunc(func() config.ProxyConfig {
		return config.ProxyConfig{Mode: "direct", URL: "http://127.0.0.1:7897"}
	})
	if u, err := directFn(req); err != nil || u != nil {
		t.Fatalf("expected direct mode to return nil, got %v err=%v", u, err)
	}

	customFn := ProxyFunc(func() config.ProxyConfig {
		return config.ProxyConfig{Mode: "custom", URL: "http://127.0.0.1:7897"}
	})
	if u, err := customFn(req); err != nil || u == nil || u.String() != "http://127.0.0.1:7897" {
		t.Fatalf("expected custom proxy URL, got %v err=%v", u, err)
	}
}
