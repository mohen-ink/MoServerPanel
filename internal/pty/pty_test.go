package pty

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveWorkDir(t *testing.T) {
	t.Run("creates and returns custom directory", func(t *testing.T) {
		target := filepath.Join(t.TempDir(), "nested", "ssh-tmp")
		got := ResolveWorkDir(target)
		if got != target {
			t.Fatalf("ResolveWorkDir(%q) = %q, want %q", target, got, target)
		}
		fi, err := os.Stat(target)
		if err != nil || !fi.IsDir() {
			t.Fatalf("expected directory %q to be created, err=%v", target, err)
		}
	})

	t.Run("falls back when configured path is a file", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), "not-a-dir.txt")
		if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		got := ResolveWorkDir(f)
		if got == f {
			t.Fatalf("expected fallback when configured path is a regular file, got %q", got)
		}
		fi, err := os.Stat(got)
		if err != nil || !fi.IsDir() {
			t.Fatalf("fallback dir %q is not a valid directory: err=%v", got, err)
		}
	})
}
