package api

import (
	"net/http"

	"win-server-panel/internal/sshserver"
)

func (s *Server) handleSSHStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.sshMgr.Status())
}

func (s *Server) handleSSHUpdateConfig(w http.ResponseWriter, r *http.Request) {
	var req sshserver.UpdateConfigInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	if err := s.sshMgr.UpdateConfig(req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.sshMgr.Status())
}

func (s *Server) handleSSHStart(w http.ResponseWriter, r *http.Request) {
	if err := s.sshMgr.Start(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.sshMgr.Status())
}

func (s *Server) handleSSHStop(w http.ResponseWriter, r *http.Request) {
	if err := s.sshMgr.Stop(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.sshMgr.Status())
}

func (s *Server) handleSSHKickSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.sshMgr.KickSession(id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
