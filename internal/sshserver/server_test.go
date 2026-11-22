package sshserver

import (
	"fmt"
	"io"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"

	"win-server-panel/internal/auth"
	"win-server-panel/internal/config"
)

func getFreePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func TestEmbeddedSSHAndSFTP(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := config.NewStore(tmpDir)
	if err != nil {
		t.Fatal(err)
	}
	limiter := auth.NewRateLimiter(5, 5*time.Minute, 10*time.Minute)
	mgr := NewManager(store, limiter)

	port := getFreePort(t)
	if err := mgr.UpdateConfig(UpdateConfigInput{
		ListenAddr:   "127.0.0.1",
		Port:         port,
		Username:     "testuser",
		Password:     "TestSshPass99",
		DefaultShell: "cmd",
		EnableSFTP:   true,
	}); err != nil {
		t.Fatalf("UpdateConfig: %v", err)
	}

	if err := mgr.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer mgr.Shutdown()

	addr := fmt.Sprintf("127.0.0.1:%d", port)

	// 1. Bad password must fail
	badCfg := &ssh.ClientConfig{
		User:            "testuser",
		Auth:            []ssh.AuthMethod{ssh.Password("WrongPassword")},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         3 * time.Second,
	}
	if c, err := ssh.Dial("tcp", addr, badCfg); err == nil {
		c.Close()
		t.Fatal("expected wrong password to fail")
	}

	// 2. Valid password succeeds
	goodCfg := &ssh.ClientConfig{
		User:            "testuser",
		Auth:            []ssh.AuthMethod{ssh.Password("TestSshPass99")},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}
	client, err := ssh.Dial("tcp", addr, goodCfg)
	if err != nil {
		t.Fatalf("ssh.Dial failed: %v", err)
	}
	defer client.Close()

	// 3. Exec command works
	sess, err := client.NewSession()
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	out, err := sess.CombinedOutput("echo hello-wsp-ssh")
	sess.Close()
	if err != nil {
		t.Fatalf("exec failed: %v (out=%s)", err, string(out))
	}
	if !strings.Contains(string(out), "hello-wsp-ssh") {
		t.Fatalf("unexpected exec output: %q", string(out))
	}

	// 4. SFTP file write & read works
	sc, err := sftp.NewClient(client)
	if err != nil {
		t.Fatalf("sftp.NewClient: %v", err)
	}
	testFile := filepath.Join(tmpDir, "sftp_check.txt")
	f, err := sc.Create(testFile)
	if err != nil {
		t.Fatalf("sftp Create: %v", err)
	}
	_, _ = f.Write([]byte("sftp-ok"))
	_ = f.Close()

	rf, err := sc.Open(testFile)
	if err != nil {
		t.Fatalf("sftp Open: %v", err)
	}
	readBytes, _ := io.ReadAll(rf)
	_ = rf.Close()
	_ = sc.Close()
	if string(readBytes) != "sftp-ok" {
		t.Fatalf("unexpected SFTP read content: %q", string(readBytes))
	}

	// 5. Session tracking & Kick works
	sessions := mgr.ListSessions()
	if len(sessions) == 0 {
		t.Fatal("expected at least 1 active SSH session")
	}
	if err := mgr.KickSession(sessions[0].ID); err != nil {
		t.Fatalf("KickSession: %v", err)
	}
}
