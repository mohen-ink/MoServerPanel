package acme

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"win-server-panel/internal/config"
	"win-server-panel/internal/nginx"
)

func generateTestCertPEM(t *testing.T, domains []string) (string, string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: domains[0]},
		DNSNames:     domains,
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(90 * 24 * time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return string(certPEM), string(keyPEM)
}

func TestManualCertUploadAndValidation(t *testing.T) {
	store, err := config.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mgr := NewManager(store, nginx.NewManager(store))

	certPEM, keyPEM := generateTestCertPEM(t, []string{"test.local", "www.test.local"})
	_, wrongKeyPEM := generateTestCertPEM(t, []string{"other.local"})

	if _, err := mgr.UploadManual("bad", certPEM, wrongKeyPEM); err == nil {
		t.Fatal("expected mismatched key pair to fail")
	}

	cert, err := mgr.UploadManual("My Test Cert", certPEM, keyPEM)
	if err != nil {
		t.Fatalf("UploadManual failed: %v", err)
	}
	if len(cert.Domains) != 2 || cert.Domains[0] != "test.local" {
		t.Fatalf("unexpected domains: %+v", cert.Domains)
	}

	if err := mgr.DeleteCert(cert.ID); err != nil {
		t.Fatalf("DeleteCert failed: %v", err)
	}
}

func TestDNSAccountCRUDAndCertBinding(t *testing.T) {
	store, err := config.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mgr := NewManager(store, nginx.NewManager(store))

	// Validation: empty token should fail
	if _, err := mgr.CreateDNSAccount(DNSAccountInput{
		Name:     "Bad CF",
		Provider: "cloudflare",
		Config:   map[string]string{},
	}); err == nil {
		t.Fatal("expected missing apiToken to fail")
	}

	// Create Cloudflare account
	cfAcc, err := mgr.CreateDNSAccount(DNSAccountInput{
		Name:     "CF 主账号",
		Provider: "cloudflare",
		Config:   map[string]string{"apiToken": "cf_live_token_1234567890abcdef"},
		Remark:   "生产域名",
	})
	if err != nil {
		t.Fatalf("CreateDNSAccount failed: %v", err)
	}
	if cfAcc.Config["apiToken"] == "cf_live_token_1234567890abcdef" {
		t.Fatalf("expected apiToken to be masked in response, got raw token")
	}

	// Update name without re-entering token -> existing token must be preserved
	updatedAcc, err := mgr.UpdateDNSAccount(cfAcc.ID, DNSAccountInput{
		Name:     "CF 生产账号",
		Provider: "cloudflare",
		Config:   map[string]string{"apiToken": ""},
		Remark:   "更新备注",
	})
	if err != nil {
		t.Fatalf("UpdateDNSAccount failed: %v", err)
	}
	if updatedAcc.Name != "CF 生产账号" {
		t.Fatalf("unexpected account name: %s", updatedAcc.Name)
	}
	rawAcc, ok := store.GetDNSAccount(cfAcc.ID)
	if !ok || rawAcc.Config["apiToken"] != "cf_live_token_1234567890abcdef" {
		t.Fatalf("expected stored apiToken to remain intact, got %+v", rawAcc.Config)
	}

	// Seed an ACME certificate using legacy inline credentials
	now := time.Now()
	seedCert := config.Certificate{
		ID:                 "cert1",
		Name:               "example.com",
		Source:             "acme",
		Domains:            []string{"example.com", "*.example.com"},
		NotBefore:          now,
		NotAfter:           now.Add(90 * 24 * time.Hour),
		ACMEEmail:          "admin@example.com",
		ACMEChallenge:      "cloudflare",
		ACMEProviderConfig: map[string]string{"apiToken": "old_inline_token_999999"},
		AutoRenew:          false,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := store.SaveCerts(func(list []config.Certificate) ([]config.Certificate, error) {
		return append(list, seedCert), nil
	}); err != nil {
		t.Fatal(err)
	}

	// Bind certificate to saved DNS account & enable AutoRenew
	autoRenewTrue := true
	bindID := cfAcc.ID
	updatedCert, err := mgr.UpdateCert(seedCert.ID, UpdateCertInput{
		AutoRenew:    &autoRenewTrue,
		DNSAccountID: &bindID,
	})
	if err != nil {
		t.Fatalf("UpdateCert failed: %v", err)
	}
	if !updatedCert.AutoRenew || updatedCert.DNSAccountID != cfAcc.ID || updatedCert.DNSAccountName != "CF 生产账号" {
		t.Fatalf("unexpected updated cert: %+v", updatedCert)
	}

	// Verify resolveCertChallenge uses live credentials from DNSAccount, including after token rotation
	if _, err := mgr.UpdateDNSAccount(cfAcc.ID, DNSAccountInput{
		Name:     "CF 生产账号（已轮换）",
		Provider: "cloudflare",
		Config:   map[string]string{"apiToken": "cf_rotated_token_9876543210zyxw"},
	}); err != nil {
		t.Fatalf("token rotation update failed: %v", err)
	}

	storedCert, _ := store.GetCert(seedCert.ID)
	ch, cfg, err := mgr.resolveCertChallenge(storedCert)
	if err != nil {
		t.Fatalf("resolveCertChallenge failed: %v", err)
	}
	if ch != "cloudflare" || cfg["apiToken"] != "cf_rotated_token_9876543210zyxw" {
		t.Fatalf("expected rotated token from DNSAccount, got challenge=%s cfg=%+v", ch, cfg)
	}

	// Dynamic DNSAccountName reflects latest rename
	sanitized := mgr.ListCertsSanitized()
	if len(sanitized) != 1 || sanitized[0].DNSAccountName != "CF 生产账号（已轮换）" {
		t.Fatalf("expected updated DNSAccountName in list, got %+v", sanitized)
	}

	// Changing provider or deleting DNS account while in use must fail
	if _, err := mgr.UpdateDNSAccount(cfAcc.ID, DNSAccountInput{
		Name:     "Switch to Alidns",
		Provider: "alidns",
		Config:   map[string]string{"accessKeyId": "ak", "accessKeySecret": "sk"},
	}); err == nil {
		t.Fatal("expected provider switch while bound to cert to fail")
	}
	if err := mgr.DeleteDNSAccount(cfAcc.ID); err == nil {
		t.Fatal("expected deleting DNS account in use to fail")
	}

	// Switch cert to HTTP-01, then deleting DNS account should succeed
	httpCh := "http01"
	if _, err := mgr.UpdateCert(seedCert.ID, UpdateCertInput{Challenge: &httpCh}); err != nil {
		t.Fatalf("switch to http01 failed: %v", err)
	}
	if err := mgr.DeleteDNSAccount(cfAcc.ID); err != nil {
		t.Fatalf("DeleteDNSAccount after unbind failed: %v", err)
	}
}
