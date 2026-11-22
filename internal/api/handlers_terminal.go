package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/gorilla/websocket"

	"win-server-panel/internal/pty"
)

var termUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		if err != nil {
			return false
		}
		return strings.EqualFold(u.Host, r.Host)
	},
}

type wsTermMsg struct {
	Type string `json:"type"` // "input" or "resize"
	Data string `json:"data"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (s *Server) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	shell := r.URL.Query().Get("shell")
	if shell == "" {
		shell = s.store.GetConfig().SSH.DefaultShell
	}
	cols, _ := strconv.Atoi(r.URL.Query().Get("cols"))
	rows, _ := strconv.Atoi(r.URL.Query().Get("rows"))
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 32
	}

	ws, err := termUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	workDir := pty.ResolveWorkDir(s.store.GetConfig().SSH.WorkDir)
	term, err := pty.Start(shell, cols, rows, workDir)
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("Failed to start terminal: "+err.Error()+"\r\n"))
		return
	}
	defer term.Close()

	var writeMu sync.Mutex
	done := make(chan struct{})

	// PTY -> WebSocket
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := term.Read(buf)
			if n > 0 {
				writeMu.Lock()
				wErr := ws.WriteMessage(websocket.BinaryMessage, buf[:n])
				writeMu.Unlock()
				if wErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// WebSocket -> PTY
	go func() {
		for {
			msgType, data, err := ws.ReadMessage()
			if err != nil {
				_ = term.Close()
				return
			}
			if msgType == websocket.TextMessage {
				var ctrl wsTermMsg
				if json.Unmarshal(data, &ctrl) == nil && ctrl.Type != "" {
					switch ctrl.Type {
					case "resize":
						_ = term.Resize(ctrl.Cols, ctrl.Rows)
					case "input":
						if ctrl.Data != "" {
							_, _ = term.Write([]byte(ctrl.Data))
						}
					}
					continue
				}
			}
			_, _ = term.Write(data)
		}
	}()

	<-done
}
