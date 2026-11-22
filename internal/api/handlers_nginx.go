package api

import (
	"net/http"
	"strconv"

	"win-server-panel/internal/nginx"
)

func (s *Server) handleNginxStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.nginxMgr.Status())
}

func (s *Server) handleNginxStart(w http.ResponseWriter, r *http.Request) {
	if err := s.nginxMgr.Start(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.nginxMgr.Status())
}

func (s *Server) handleNginxStop(w http.ResponseWriter, r *http.Request) {
	if err := s.nginxMgr.Stop(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.nginxMgr.Status())
}

func (s *Server) handleNginxRestart(w http.ResponseWriter, r *http.Request) {
	if err := s.nginxMgr.Restart(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.nginxMgr.Status())
}

func (s *Server) handleNginxReload(w http.ResponseWriter, r *http.Request) {
	if err := s.nginxMgr.Reload(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.nginxMgr.Status())
}

func (s *Server) handleNginxTest(w http.ResponseWriter, r *http.Request) {
	out, err := s.nginxMgr.TestConfig()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok":     false,
			"output": out,
			"error":  out,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"output": out,
	})
}

func (s *Server) handleNginxSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AutoStart  bool    `json:"autoStart"`
		CustomPath *string `json:"customPath"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	if err := s.nginxMgr.UpdateSettings(req.AutoStart, req.CustomPath); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.nginxMgr.Status())
}

func (s *Server) handleNginxLogs(w http.ResponseWriter, r *http.Request) {
	logType := r.URL.Query().Get("type")
	lines, _ := strconv.Atoi(r.URL.Query().Get("lines"))
	content, err := s.nginxMgr.ReadLogs(logType, lines)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"type":    logType,
		"content": content,
	})
}

func (s *Server) handleListNginxSites(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  s.nginxMgr.ListSites(),
		"status": s.nginxMgr.Status(),
	})
}

func (s *Server) handleCreateNginxSite(w http.ResponseWriter, r *http.Request) {
	var req nginx.SiteInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	site, err := s.nginxMgr.CreateSite(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, site)
}

func (s *Server) handleUpdateNginxSite(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req nginx.SiteInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	site, err := s.nginxMgr.UpdateSite(id, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, site)
}

func (s *Server) handleDeleteNginxSite(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.nginxMgr.DeleteSite(id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handlePreviewNginxSite(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	conf, err := s.nginxMgr.PreviewSiteConfig(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"config": conf,
	})
}
