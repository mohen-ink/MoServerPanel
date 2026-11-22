package main

import (
	"path/filepath"
	"testing"
)

func TestResolveDataDir(t *testing.T) {
	t.Run("flag takes highest priority", func(t *testing.T) {
		t.Setenv("MSP_DATA_DIR", `D:\EnvData`)
		t.Setenv("ProgramData", `C:\ProgramData`)

		got := resolveDataDir(`E:\FlagData`)
		if got != `E:\FlagData` {
			t.Fatalf("resolveDataDir(flag) = %q, want %q", got, `E:\FlagData`)
		}
	})

	t.Run("env overrides default ProgramData", func(t *testing.T) {
		t.Setenv("MSP_DATA_DIR", `D:\EnvData`)
		t.Setenv("ProgramData", `C:\ProgramData`)

		got := resolveDataDir("")
		if got != `D:\EnvData` {
			t.Fatalf("resolveDataDir(env) = %q, want %q", got, `D:\EnvData`)
		}
	})

	t.Run("defaults to ProgramData/MoServerPanel", func(t *testing.T) {
		t.Setenv("MSP_DATA_DIR", "")
		t.Setenv("ProgramData", `C:\ProgramData`)

		got := resolveDataDir("")
		want := filepath.Join(`C:\ProgramData`, "MoServerPanel")
		if got != want {
			t.Fatalf("resolveDataDir(default) = %q, want %q", got, want)
		}
	})

	t.Run("fallback when ProgramData is empty", func(t *testing.T) {
		t.Setenv("MSP_DATA_DIR", "")
		t.Setenv("ProgramData", "")

		got := resolveDataDir("")
		if got != `C:\ProgramData\MoServerPanel` {
			t.Fatalf("resolveDataDir(fallback) = %q, want %q", got, `C:\ProgramData\MoServerPanel`)
		}
	})
}
