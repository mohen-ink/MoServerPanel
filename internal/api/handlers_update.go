package api

import "net/http"

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	res, err := s.updater.Check(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.updater.Status())
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	st, err := s.updater.StartAsyncUpdate()
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}
