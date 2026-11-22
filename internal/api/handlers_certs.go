package api

import (
	"net/http"

	"win-server-panel/internal/acme"
)

func (s *Server) handleListCerts(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"items": s.acmeMgr.ListCertsSanitized(),
	})
}

func (s *Server) handleUploadManualCert(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string `json:"name"`
		CertPEM string `json:"certPem"`
		KeyPEM  string `json:"keyPem"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	cert, err := s.acmeMgr.UploadManual(req.Name, req.CertPEM, req.KeyPEM)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, cert)
}

func (s *Server) handleIssueACMECert(w http.ResponseWriter, r *http.Request) {
	var req acme.IssueRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数格式错误")
		return
	}
	cert, err := s.acmeMgr.IssueACME(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, cert)
}

func (s *Server) handleRenewCert(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cert, err := s.acmeMgr.RenewCert(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cert)
}

func (s *Server) handleDeleteCert(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.acmeMgr.DeleteCert(id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
