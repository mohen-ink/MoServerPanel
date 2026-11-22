package api

import (
	"net/http"
	"strings"
	"time"

	"win-server-panel/internal/config"
	"win-server-panel/internal/netproxy"
	"win-server-panel/internal/service"
	"win-server-panel/internal/sysinfo"
)

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	ov := s.sys.Collect()
	ngx := s.nginxMgr.Status()
	sshSt := s.sshMgr.Status()
	fwRules := s.fwMgr.ListManagedRules()
	certs := s.store.ListCerts()

	enabledFw := 0
	for _, r := range fwRules {
		if r.Enabled {
			enabledFw++
		}
	}

	expiringSoon := 0
	for _, c := range certs {
		if time.Until(c.NotAfter) < 30*24*time.Hour {
			expiringSoon++
		}
	}

	svcStatus, _ := service.Status()

	writeJSON(w, http.StatusOK, map[string]any{
		"system": ov,
		"nginx":  ngx,
		"ssh":    sshSt,
		"firewall": map[string]any{
			"total":   len(fwRules),
			"enabled": enabledFw,
			"isAdmin": ov.IsAdmin,
		},
		"certs": map[string]any{
			"total":        len(certs),
			"expiringSoon": expiringSoon,
		},
		"serviceStatus": svcStatus,
		"version":       s.version,
	})
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	cfg := s.store.GetConfig()
	svcStatus, _ := service.Status()
	detectedProxy, detectedSource := netproxy.DetectSystemProxy()
	writeJSON(w, http.StatusOK, map[string]any{
		"listenAddr":                cfg.ListenAddr,
		"port":                      cfg.Port,
		"username":                  cfg.Auth.Username,
		"dataDir":                   s.store.DataDir(),
		"version":                   s.version,
		"isAdmin":                   sysinfo.IsElevated(),
		"serviceStatus":             svcStatus,
		"proxy":                     cfg.Proxy,
		"detectedSystemProxy":       detectedProxy,
		"detectedSystemProxySource": detectedSource,
	})
}

func (s *Server) handleUpdateProxySettings(w http.ResponseWriter, r *http.Request) {
	var req config.ProxyConfig
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	validated, err := netproxy.Validate(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateConfig(func(c *config.PanelConfig) error {
		c.Proxy = validated
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if s.updater != nil {
		s.updater.ResetConnections()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"proxy":   validated,
		"message": "代理设置已保存并立即生效",
	})
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ListenAddr string `json:"listenAddr"`
		Port       int    `json:"port"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	if req.Port < 1 || req.Port > 65535 {
		writeError(w, http.StatusBadRequest, "面板端口必须在 1-65535 之间")
		return
	}
	addr := strings.TrimSpace(req.ListenAddr)
	if addr == "" {
		addr = "0.0.0.0"
	}

	if err := s.store.UpdateConfig(func(c *config.PanelConfig) error {
		c.ListenAddr = addr
		c.Port = req.Port
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "设置已保存，修改监听地址或端口需重启面板服务后生效",
	})
}
