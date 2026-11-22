package api

import (
	"net/http"

	"win-server-panel/internal/auth"
)

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	initialized := s.authMgr.IsInitialized()
	authenticated := false
	username := ""
	if initialized {
		if claims, err := s.authMgr.VerifyRequest(r); err == nil {
			authenticated = true
			username = claims.Username
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"initialized":   initialized,
		"authenticated": authenticated,
		"username":      username,
		"version":       s.version,
	})
}

func (s *Server) handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	if err := s.authMgr.Setup(req.Username, req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	token, expires, err := s.authMgr.Login(req.Username, req.Password, clientIP(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	auth.SetAuthCookie(w, token, expires)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"username": req.Username,
	})
}

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	token, expires, err := s.authMgr.Login(req.Username, req.Password, clientIP(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	auth.SetAuthCookie(w, token, expires)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"username": req.Username,
	})
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	auth.ClearAuthCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	if err := s.authMgr.ChangePassword(req.OldPassword, req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleListBans(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	writeJSON(w, http.StatusOK, map[string]any{
		"items": s.authMgr.Limiter().ListBanned(ns),
	})
}

func (s *Server) handleUnban(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Namespace string `json:"namespace"`
		IP        string `json:"ip"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	s.authMgr.Limiter().Unban(req.Namespace, req.IP)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
