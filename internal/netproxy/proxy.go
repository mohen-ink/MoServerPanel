package netproxy

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"

	"golang.org/x/sys/windows/registry"

	"win-server-panel/internal/config"
)

const internetSettingsKey = `Software\Microsoft\Windows\CurrentVersion\Internet Settings`

// Validate normalizes and validates a ProxyConfig.
func Validate(in config.ProxyConfig) (config.ProxyConfig, error) {
	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	if mode == "" {
		mode = "auto"
	}
	rawURL := strings.TrimSpace(in.URL)

	switch mode {
	case "auto", "direct":
		return config.ProxyConfig{
			Mode: mode,
			URL:  rawURL,
		}, nil
	case "custom":
		if rawURL == "" {
			return config.ProxyConfig{}, errors.New("选择手动代理时，代理地址不能为空（示例: http://127.0.0.1:7897）")
		}
		normalized, err := normalizeProxyURL(rawURL)
		if err != nil {
			return config.ProxyConfig{}, err
		}
		return config.ProxyConfig{
			Mode: mode,
			URL:  normalized.String(),
		}, nil
	default:
		return config.ProxyConfig{}, fmt.Errorf("不支持的代理模式: %s（仅支持 auto、custom 或 direct）", in.Mode)
	}
}

func normalizeProxyURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("代理地址不能为空")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("无效的代理地址: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, fmt.Errorf("不支持的代理协议: %s（仅支持 http、https、socks5）", u.Scheme)
	}
	if u.Host == "" {
		return nil, errors.New("代理地址缺少主机和端口（示例: http://127.0.0.1:7897）")
	}
	return u, nil
}

// ProxyFunc returns an http.Transport.Proxy function that resolves the proxy
// dynamically from getCfg on every request.
func ProxyFunc(getCfg func() config.ProxyConfig) func(*http.Request) (*url.URL, error) {
	return func(req *http.Request) (*url.URL, error) {
		cfg := config.ProxyConfig{Mode: "auto"}
		if getCfg != nil {
			cfg = getCfg()
		}
		mode := strings.ToLower(strings.TrimSpace(cfg.Mode))
		if mode == "" {
			mode = "auto"
		}

		switch mode {
		case "direct":
			return nil, nil
		case "custom":
			if strings.TrimSpace(cfg.URL) == "" {
				return nil, nil
			}
			return normalizeProxyURL(cfg.URL)
		default: // "auto": environment variable first, then Windows system proxy
			if envURL, err := http.ProxyFromEnvironment(req); err == nil && envURL != nil {
				return envURL, nil
			}
			return resolveWindowsSystemProxy(req)
		}
	}
}

// DetectSystemProxy returns the currently active environment or Windows system proxy
// for display in Settings UI.
func DetectSystemProxy() (proxyURL string, source string) {
	for _, key := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"} {
		if val := strings.TrimSpace(os.Getenv(key)); val != "" {
			return val, "env"
		}
	}
	enabled, server, _ := readWindowsProxyRegistry()
	if !enabled || server == "" {
		return "", ""
	}
	if u, err := ParseWindowsProxyServer(server, "https"); err == nil && u != nil {
		return u.String(), "windows"
	}
	return server, "windows"
}

func resolveWindowsSystemProxy(req *http.Request) (*url.URL, error) {
	if req != nil && req.URL != nil && isLoopbackHost(req.URL.Hostname()) {
		return nil, nil
	}
	enabled, server, override := readWindowsProxyRegistry()
	if !enabled || server == "" {
		return nil, nil
	}
	if req != nil && req.URL != nil && ShouldBypassWindowsProxy(req.URL.Hostname(), override) {
		return nil, nil
	}
	scheme := "https"
	if req != nil && req.URL != nil && req.URL.Scheme != "" {
		scheme = req.URL.Scheme
	}
	u, err := ParseWindowsProxyServer(server, scheme)
	if err != nil {
		// Ignore malformed registry values instead of breaking direct requests
		return nil, nil
	}
	return u, nil
}

func isLoopbackHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}
	return false
}

func readWindowsProxyRegistry() (enabled bool, server string, override string) {
	k, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsKey, registry.QUERY_VALUE)
	if err != nil {
		return false, "", ""
	}
	defer k.Close()

	enVal, _, err := k.GetIntegerValue("ProxyEnable")
	if err != nil || enVal == 0 {
		return false, "", ""
	}
	srv, _, err := k.GetStringValue("ProxyServer")
	if err != nil {
		return false, "", ""
	}
	ov, _, _ := k.GetStringValue("ProxyOverride")
	return true, strings.TrimSpace(srv), strings.TrimSpace(ov)
}

// ParseWindowsProxyServer parses the Windows Internet Settings ProxyServer value.
// Supports both single-entry ("127.0.0.1:7897", "http://127.0.0.1:7897") and
// per-protocol entries ("http=127.0.0.1:7897;https=127.0.0.1:7897;socks=127.0.0.1:7898").
func ParseWindowsProxyServer(raw, scheme string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	scheme = strings.ToLower(strings.TrimSpace(scheme))
	if scheme == "" {
		scheme = "https"
	}

	if !strings.Contains(raw, "=") {
		return normalizeProxyURL(raw)
	}

	entries := make(map[string]string)
	for _, part := range strings.Split(raw, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		k := strings.ToLower(strings.TrimSpace(kv[0]))
		v := strings.TrimSpace(kv[1])
		if k != "" && v != "" {
			entries[k] = v
		}
	}

	// Preferred order for requested scheme
	candidates := []string{scheme, "http", "https", "socks"}
	if scheme == "http" {
		candidates = []string{"http", "https", "socks"}
	}
	for _, key := range candidates {
		val, ok := entries[key]
		if !ok || val == "" {
			continue
		}
		if key == "socks" && !strings.Contains(val, "://") {
			val = "socks5://" + val
		}
		return normalizeProxyURL(val)
	}
	return nil, nil
}

// ShouldBypassWindowsProxy checks whether host matches any semicolon-separated
// rule in Windows ProxyOverride (e.g. "localhost;127.*;192.168.*;<local>").
func ShouldBypassWindowsProxy(host, override string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" || strings.TrimSpace(override) == "" {
		return false
	}

	for _, rawRule := range strings.Split(override, ";") {
		rule := strings.ToLower(strings.TrimSpace(rawRule))
		if rule == "" {
			continue
		}
		if rule == "<local>" {
			if !strings.Contains(host, ".") {
				return true
			}
			continue
		}
		// Strip optional scheme or port from rule
		if idx := strings.Index(rule, "://"); idx >= 0 {
			rule = rule[idx+3:]
		}
		if idx := strings.IndexByte(rule, ':'); idx >= 0 {
			rule = rule[:idx]
		}
		if rule == host {
			return true
		}
		if strings.ContainsAny(rule, "*?") {
			if matched, err := path.Match(rule, host); err == nil && matched {
				return true
			}
		}
	}
	return false
}
