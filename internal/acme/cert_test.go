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
