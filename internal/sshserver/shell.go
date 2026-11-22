package sshserver

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"io"
	"os/exec"
	"strings"
	"syscall"
	"unicode/utf16"

	"golang.org/x/crypto/ssh"

	"win-server-panel/internal/pty"
)

type execPayload struct {
	Command string
}

type subsystemPayload struct {
	Name string
}

func (m *Manager) handleSessionChannel(sessID string, channel ssh.Channel, requests <-chan *ssh.Request) {
	defer channel.Close()

	cols := 120
	rows := 32
	var term pty.Terminal

	for req := range requests {
		switch req.Type {
		case "pty-req":
			w, h := parsePtyReq(req.Payload)
			if w > 0 && h > 0 {
				cols, rows = w, h
			}
			_ = req.Reply(true, nil)

		case "window-change":
			w, h := parseWindowChange(req.Payload)
			if w > 0 && h > 0 {
				cols, rows = w, h
				if term != nil {
					_ = term.Resize(cols, rows)
				}
			}
			_ = req.Reply(true, nil)

		case "env":
			_ = req.Reply(true, nil)

		case "shell":
			_ = req.Reply(true, nil)
			m.updateSessionMode(sessID, "shell")

			shellName := m.store.GetConfig().SSH.DefaultShell
			t, err := pty.Start(shellName, cols, rows, pty.DefaultWorkDir())
			if err != nil {
				_, _ = io.WriteString(channel.Stderr(), "Failed to start shell: "+err.Error()+"\r\n")
				sendExitStatus(channel, 1)
				return
			}
			term = t

			go func() {
				_, _ = io.Copy(term, channel)
				_ = term.Close()
			}()

			doneCopy := make(chan struct{})
			go func() {
				_, _ = io.Copy(channel, term)
				close(doneCopy)
			}()

			exitCode, _ := term.Wait(context.Background())
			_ = term.Close()
			<-doneCopy
			sendExitStatus(channel, exitCode)
			return

		case "exec":
			var payload execPayload
			if err := ssh.Unmarshal(req.Payload, &payload); err != nil {
				_ = req.Reply(false, nil)
				return
			}
			_ = req.Reply(true, nil)
			m.updateSessionMode(sessID, "exec")
			exitCode := m.runExecCommand(payload.Command, channel)
			sendExitStatus(channel, exitCode)
			_ = channel.CloseWrite()
			return

		case "subsystem":
			var payload subsystemPayload
			if err := ssh.Unmarshal(req.Payload, &payload); err != nil {
				_ = req.Reply(false, nil)
				return
			}
			if payload.Name == "sftp" && m.store.GetConfig().SSH.EnableSFTP {
				_ = req.Reply(true, nil)
				m.updateSessionMode(sessID, "sftp")
				m.serveSFTP(channel)
				return
			}
			_ = req.Reply(false, nil)

		default:
			if req.WantReply {
				_ = req.Reply(false, nil)
			}
		}
	}
}

func (m *Manager) runExecCommand(command string, channel ssh.Channel) uint32 {
	shell := strings.ToLower(strings.TrimSpace(m.store.GetConfig().SSH.DefaultShell))
	var cmd *exec.Cmd
	if shell == "cmd" {
		cmd = exec.Command("cmd.exe", "/C", command)
	} else {
		script := "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n" + command
		cmd = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShellUTF16LE(script))
	}
	cmd.Dir = pty.DefaultWorkDir()
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	cmd.Stdout = channel
	cmd.Stderr = channel.Stderr()

	// Do NOT assign cmd.Stdin = channel directly: Go's os/exec Wait() blocks until
	// the Stdin copy goroutine sees EOF on channel, which deadlocks SSH clients
	// that keep stdin open until exit-status/channel-close.
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return 1
	}

	if err := cmd.Start(); err != nil {
		_ = stdinPipe.Close()
		_, _ = io.WriteString(channel.Stderr(), "Failed to start command: "+err.Error()+"\n")
		return 1
	}

	go func() {
		defer stdinPipe.Close()
		_, _ = io.Copy(stdinPipe, channel)
	}()

	err = cmd.Wait()
	_ = stdinPipe.Close()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return uint32(exitErr.ExitCode())
		}
		return 1
	}
	return 0
}

func encodePowerShellUTF16LE(script string) string {
	u16 := utf16.Encode([]rune(script))
	b := make([]byte, len(u16)*2)
	for i, v := range u16 {
		binary.LittleEndian.PutUint16(b[i*2:], v)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func sendExitStatus(channel ssh.Channel, code uint32) {
	payload := make([]byte, 4)
	binary.BigEndian.PutUint32(payload, code)
	_, _ = channel.SendRequest("exit-status", false, payload)
}

func parsePtyReq(payload []byte) (int, int) {
	if len(payload) < 4 {
		return 0, 0
	}
	termLen := binary.BigEndian.Uint32(payload[:4])
	offset := 4 + int(termLen)
	if len(payload) < offset+8 {
		return 0, 0
	}
	w := int(binary.BigEndian.Uint32(payload[offset : offset+4]))
	h := int(binary.BigEndian.Uint32(payload[offset+4 : offset+8]))
	return w, h
}

func parseWindowChange(payload []byte) (int, int) {
	if len(payload) < 8 {
		return 0, 0
	}
	w := int(binary.BigEndian.Uint32(payload[0:4]))
	h := int(binary.BigEndian.Uint32(payload[4:8]))
	return w, h
}
