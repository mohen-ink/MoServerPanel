package api

import (
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"path"
	"strings"

	"win-server-panel/internal/acme"
	"win-server-panel/internal/auth"
	"win-server-panel/internal/config"
	"win-server-panel/internal/firewall"
	"win-server-panel/internal/nginx"
	"win-server-panel/internal/sshserver"
	"win-server-panel/internal/sysinfo"
	"win-server-panel/internal/updater"
	"win-server-panel/web"
)

type Server struct {
	version   string
	store     *config.Store
	authMgr   *auth.Manager
	sys       *sysinfo.Collector
	fwMgr     *firewall.Manager
	nginxMgr  *nginx.Manager
	acmeMgr   *acme.Manager
	sshMgr    *sshserver.Manager
	updater   *updater.Manager
	mux       *http.ServeMux
}

func NewServer(
	version string,
	store *config.Store,
	authMgr *auth.Manager,
	sys *sysinfo.Collector,
	fwMgr *firewall.Manager,
	nginxMgr *nginx.Manager,
	acmeMgr *acme.Manager,
	sshMgr *sshserver.Manager,
	updaterMgr *updater.Manager,
) *Server {
	s := &Server{
		version:  version,
		store:    store,
		authMgr:  authMgr,
		sys:      sys,
		fwMgr:    fwMgr,
		nginxMgr: nginxMgr,
		acmeMgr:  acmeMgr,
		sshMgr:   sshMgr,
		updater:  updaterMgr,
		mux:      http.NewServeMux(),
	}
	s.registerRoutes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.recoverMiddleware(s.mux)
}

func (s *Server) registerRoutes() {
	// Auth (public)
	s.mux.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	s.mux.HandleFunc("POST /api/auth/setup", s.handleAuthSetup)
	s.mux.HandleFunc("POST /api/auth/login", s.handleAuthLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.handleAuthLogout)

	// Auth & Security (protected)
	s.mux.Handle("POST /api/auth/change-password", s.requireAuth(http.HandlerFunc(s.handleChangePassword)))
	s.mux.Handle("GET /api/security/bans", s.requireAuth(http.HandlerFunc(s.handleListBans)))
	s.mux.Handle("DELETE /api/security/bans", s.requireAuth(http.HandlerFunc(s.handleUnban)))

	// Dashboard & Settings
	s.mux.Handle("GET /api/dashboard", s.requireAuth(http.HandlerFunc(s.handleDashboard)))
	s.mux.Handle("GET /api/settings", s.requireAuth(http.HandlerFunc(s.handleGetSettings)))
	s.mux.Handle("PUT /api/settings", s.requireAuth(http.HandlerFunc(s.handleUpdateSettings)))

	// Self-update (GitHub Releases)
	s.mux.Handle("GET /api/update/check", s.requireAuth(http.HandlerFunc(s.handleUpdateCheck)))
	s.mux.Handle("GET /api/update/status", s.requireAuth(http.HandlerFunc(s.handleUpdateStatus)))
	s.mux.Handle("POST /api/update/apply", s.requireAuth(http.HandlerFunc(s.handleUpdateApply)))

	// Firewall
	s.mux.Handle("GET /api/firewall/rules", s.requireAuth(http.HandlerFunc(s.handleListFirewallRules)))
	s.mux.Handle("POST /api/firewall/rules", s.requireAuth(http.HandlerFunc(s.handleCreateFirewallRule)))
	s.mux.Handle("PUT /api/firewall/rules/{id}", s.requireAuth(http.HandlerFunc(s.handleUpdateFirewallRule)))
	s.mux.Handle("POST /api/firewall/rules/{id}/toggle", s.requireAuth(http.HandlerFunc(s.handleToggleFirewallRule)))
	s.mux.Handle("DELETE /api/firewall/rules/{id}", s.requireAuth(http.HandlerFunc(s.handleDeleteFirewallRule)))
	s.mux.Handle("GET /api/firewall/ports", s.requireAuth(http.HandlerFunc(s.handleListListeningPorts)))
	s.mux.Handle("GET /api/firewall/system-rules", s.requireAuth(http.HandlerFunc(s.handleListSystemFirewallRules)))

	// Nginx
	s.mux.Handle("GET /api/nginx/status", s.requireAuth(http.HandlerFunc(s.handleNginxStatus)))
	s.mux.Handle("POST /api/nginx/start", s.requireAuth(http.HandlerFunc(s.handleNginxStart)))
	s.mux.Handle("POST /api/nginx/stop", s.requireAuth(http.HandlerFunc(s.handleNginxStop)))
	s.mux.Handle("POST /api/nginx/restart", s.requireAuth(http.HandlerFunc(s.handleNginxRestart)))
	s.mux.Handle("POST /api/nginx/reload", s.requireAuth(http.HandlerFunc(s.handleNginxReload)))
	s.mux.Handle("POST /api/nginx/test", s.requireAuth(http.HandlerFunc(s.handleNginxTest)))
	s.mux.Handle("PUT /api/nginx/settings", s.requireAuth(http.HandlerFunc(s.handleNginxSettings)))
	s.mux.Handle("GET /api/nginx/logs", s.requireAuth(http.HandlerFunc(s.handleNginxLogs)))
	s.mux.Handle("GET /api/nginx/sites", s.requireAuth(http.HandlerFunc(s.handleListNginxSites)))
	s.mux.Handle("POST /api/nginx/sites", s.requireAuth(http.HandlerFunc(s.handleCreateNginxSite)))
	s.mux.Handle("PUT /api/nginx/sites/{id}", s.requireAuth(http.HandlerFunc(s.handleUpdateNginxSite)))
	s.mux.Handle("DELETE /api/nginx/sites/{id}", s.requireAuth(http.HandlerFunc(s.handleDeleteNginxSite)))
	s.mux.Handle("GET /api/nginx/sites/{id}/preview", s.requireAuth(http.HandlerFunc(s.handlePreviewNginxSite)))

	// Certificates & ACME
	s.mux.Handle("GET /api/certs", s.requireAuth(http.HandlerFunc(s.handleListCerts)))
	s.mux.Handle("POST /api/certs/manual", s.requireAuth(http.HandlerFunc(s.handleUploadManualCert)))
	s.mux.Handle("POST /api/certs/acme", s.requireAuth(http.HandlerFunc(s.handleIssueACMECert)))
	s.mux.Handle("POST /api/certs/{id}/renew", s.requireAuth(http.HandlerFunc(s.handleRenewCert)))
	s.mux.Handle("DELETE /api/certs/{id}", s.requireAuth(http.HandlerFunc(s.handleDeleteCert)))

	// SSH
	s.mux.Handle("GET /api/ssh/status", s.requireAuth(http.HandlerFunc(s.handleSSHStatus)))
	s.mux.Handle("PUT /api/ssh/config", s.requireAuth(http.HandlerFunc(s.handleSSHUpdateConfig)))
	s.mux.Handle("POST /api/ssh/start", s.requireAuth(http.HandlerFunc(s.handleSSHStart)))
	s.mux.Handle("POST /api/ssh/stop", s.requireAuth(http.HandlerFunc(s.handleSSHStop)))
	s.mux.Handle("POST /api/ssh/sessions/{id}/kick", s.requireAuth(http.HandlerFunc(s.handleSSHKickSession)))

	// Web Terminal
	s.mux.Handle("GET /api/terminal/ws", s.requireAuth(http.HandlerFunc(s.handleTerminalWS)))

	// Embedded SPA static files
	s.mux.Handle("/", s.spaHandler())
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authMgr.IsInitialized() {
			writeError(w, http.StatusForbidden, "面板尚未初始化")
			return
		}
		if _, err := s.authMgr.VerifyRequest(r); err != nil {
			writeError(w, http.StatusUnauthorized, "未登录或登录已过期")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[http] panic on %s %s: %v", r.Method, r.URL.Path, rec)
				writeError(w, http.StatusInternalServerError, "服务器内部错误")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) spaHandler() http.Handler {
	dist, err := web.DistFS()
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Frontend assets not embedded", http.StatusNotFound)
		})
	}
	fileServer := http.FileServer(http.FS(dist))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "API 路径不存在")
			return
		}
		cleanPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if cleanPath == "" || cleanPath == "." {
			cleanPath = "index.html"
		}
		if f, err := dist.Open(cleanPath); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback to index.html
		indexBytes, err := fs.ReadFile(dist, "index.html")
		if err != nil {
			http.Error(w, "Frontend not built yet. Run scripts/build.ps1.", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexBytes)
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20)) // 4MB max JSON body
	if err != nil {
		return err
	}
	return json.Unmarshal(body, dst)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
