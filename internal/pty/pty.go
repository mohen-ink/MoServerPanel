package pty

import (
	"context"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"

	"github.com/UserExistsError/conpty"
)

type Terminal interface {
	io.ReadWriteCloser
	Resize(cols, rows int) error
	Wait(ctx context.Context) (uint32, error)
}

func ShellCommand(shell string) string {
	switch strings.ToLower(strings.TrimSpace(shell)) {
	case "cmd", "cmd.exe":
		return "cmd.exe"
	default:
		return "powershell.exe -NoLogo"
	}
}

func DefaultWorkDir() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	return `C:\`
}

func Start(shell string, cols, rows int, workDir string) (Terminal, error) {
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 32
	}
	if workDir == "" {
		workDir = DefaultWorkDir()
	}

	cmdLine := ShellCommand(shell)
	if conpty.IsConPtyAvailable() {
		cpty, err := conpty.Start(
			cmdLine,
			conpty.ConPtyDimensions(cols, rows),
			conpty.ConPtyWorkDir(workDir),
		)
		if err == nil {
			return &conptyTerminal{cpty: cpty}, nil
		}
	}

	return startPipeFallback(shell, workDir)
}

type conptyTerminal struct {
	cpty      *conpty.ConPty
	closeOnce sync.Once
}

func (t *conptyTerminal) Read(p []byte) (int, error) {
	return t.cpty.Read(p)
}

func (t *conptyTerminal) Write(p []byte) (int, error) {
	return t.cpty.Write(p)
}

func (t *conptyTerminal) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return t.cpty.Resize(cols, rows)
}

func (t *conptyTerminal) Wait(ctx context.Context) (uint32, error) {
	return t.cpty.Wait(ctx)
}

func (t *conptyTerminal) Close() error {
	var err error
	t.closeOnce.Do(func() {
		err = t.cpty.Close()
	})
	return err
}

// pipeTerminal provides a fallback when ConPTY is unavailable (e.g., Windows Server 2016).
type pipeTerminal struct {
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    io.ReadCloser
	closeOnce sync.Once
}

func startPipeFallback(shell, workDir string) (Terminal, error) {
	var cmd *exec.Cmd
	if strings.EqualFold(strings.TrimSpace(shell), "cmd") || strings.EqualFold(strings.TrimSpace(shell), "cmd.exe") {
		cmd = exec.Command("cmd.exe")
	} else {
		cmd = exec.Command("powershell.exe", "-NoLogo", "-NoExit")
	}
	cmd.Dir = workDir
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = pw.Close()
		_ = pr.Close()
		return nil, err
	}

	go func() {
		_ = cmd.Wait()
		_ = pw.Close()
	}()

	return &pipeTerminal{
		cmd:    cmd,
		stdin:  stdin,
		stdout: pr,
	}, nil
}

func (p *pipeTerminal) Read(b []byte) (int, error) {
	return p.stdout.Read(b)
}

func (p *pipeTerminal) Write(b []byte) (int, error) {
	return p.stdin.Write(b)
}

func (p *pipeTerminal) Resize(cols, rows int) error {
	return nil
}

func (p *pipeTerminal) Wait(ctx context.Context) (uint32, error) {
	done := make(chan struct{})
	go func() {
		if p.cmd.Process != nil {
			_, _ = p.cmd.Process.Wait()
		}
		close(done)
	}()
	select {
	case <-done:
		return 0, nil
	case <-ctx.Done():
		return 1, ctx.Err()
	}
}

func (p *pipeTerminal) Close() error {
	p.closeOnce.Do(func() {
		_ = p.stdin.Close()
		if p.cmd.Process != nil {
			_ = p.cmd.Process.Kill()
		}
		_ = p.stdout.Close()
	})
	return nil
}
