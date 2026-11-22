package api

import (
	"net/http"

	"win-server-panel/internal/firewall"
	"win-server-panel/internal/sysinfo"
)

func (s *Server) handleListFirewallRules(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"items":   s.fwMgr.ListManagedRules(),
		"isAdmin": sysinfo.IsElevated(),
	})
}

func (s *Server) handleCreateFirewallRule(w http.ResponseWriter, r *http.Request) {
	var req firewall.RuleInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	rule, err := s.fwMgr.CreateRule(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, rule)
}

func (s *Server) handleUpdateFirewallRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req firewall.RuleInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	rule, err := s.fwMgr.UpdateRule(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

func (s *Server) handleToggleFirewallRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	rule, err := s.fwMgr.ToggleRule(r.Context(), id, req.Enabled)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

func (s *Server) handleDeleteFirewallRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.fwMgr.DeleteRule(r.Context(), id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleListListeningPorts(w http.ResponseWriter, r *http.Request) {
	ports, err := s.fwMgr.ListListeningPorts()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":   ports,
		"isAdmin": sysinfo.IsElevated(),
	})
}

func (s *Server) handleListSystemFirewallRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.fwMgr.ListSystemInboundRules(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": rules,
	})
}
