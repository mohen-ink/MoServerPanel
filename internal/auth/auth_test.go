package auth

import (
	"testing"
	"time"

	"win-server-panel/internal/config"
)

func TestAuthAndRateLimiter(t *testing.T) {
	store, err := config.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	limiter := NewRateLimiter(3, 5*time.Minute, 10*time.Minute)
	mgr := NewManager(store, limiter)

	if mgr.IsInitialized() {
		t.Fatal("expected uninitialized")
	}
	if err := mgr.Setup("admin", "short"); err == nil {
		t.Fatal("expected weak password error")
	}
	if err := mgr.Setup("admin", "StrongPass123!"); err != nil {
		t.Fatalf("Setup failed: %v", err)
	}
	if !mgr.IsInitialized() {
		t.Fatal("expected initialized")
	}

	// Trigger brute-force lockout after 3 failures
	for i := 0; i < 3; i++ {
		if _, _, err := mgr.Login("admin", "wrongpass", "10.0.0.5"); err == nil {
			t.Fatal("expected login failure")
		}
	}
	if banned, _ := limiter.IsBanned("panel", "10.0.0.5"); !banned {
		t.Fatal("expected IP 10.0.0.5 to be banned")
	}
	if _, _, err := mgr.Login("admin", "StrongPass123!", "10.0.0.5"); err == nil {
		t.Fatal("expected banned IP to be rejected even with right password")
	}

	// Unban and login cleanly
	limiter.Unban("panel", "10.0.0.5")
	tok, _, err := mgr.Login("admin", "StrongPass123!", "10.0.0.5")
	if err != nil {
		t.Fatalf("Login after unban failed: %v", err)
	}
	claims, err := mgr.VerifyToken(tok)
	if err != nil || claims.Username != "admin" {
		t.Fatalf("VerifyToken failed: claims=%+v err=%v", claims, err)
	}
}
