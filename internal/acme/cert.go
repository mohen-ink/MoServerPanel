package acme

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"win-server-panel/internal/config"
)

type ParsedCertInfo struct {
	Domains   []string
	Issuer    string
	NotBefore time.Time
	NotAfter  time.Time
}

func ParseAndValidatePEM(certPEM, keyPEM []byte) (ParsedCertInfo, error) {
	certPEM = []byte(strings.TrimSpace(string(certPEM)))
	keyPEM = []byte(strings.TrimSpace(string(keyPEM)))
	if len(certPEM) == 0 || len(keyPEM) == 0 {
		return ParsedCertInfo{}, errors.New("证书内容和私钥内容均不能为空")
	}

	if _, err := tls.X509KeyPair(certPEM, keyPEM); err != nil {
		return ParsedCertInfo{}, fmt.Errorf("证书与私钥不匹配或格式无效: %w", err)
	}

	block, _ := pem.Decode(certPEM)
	if block == nil {
		return ParsedCertInfo{}, errors.New("无法解析证书 PEM 块")
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return ParsedCertInfo{}, fmt.Errorf("解析 X.509 证书失败: %w", err)
	}

	domainSet := make(map[string]bool)
	domains := make([]string, 0, len(leaf.DNSNames)+1)
	for _, d := range leaf.DNSNames {
		if d != "" && !domainSet[d] {
			domainSet[d] = true
			domains = append(domains, d)
		}
	}
	if leaf.Subject.CommonName != "" && !domainSet[leaf.Subject.CommonName] {
		domains = append(domains, leaf.Subject.CommonName)
	}

	issuer := leaf.Issuer.CommonName
	if issuer == "" && len(leaf.Issuer.Organization) > 0 {
		issuer = leaf.Issuer.Organization[0]
	}

	return ParsedCertInfo{
		Domains:   domains,
		Issuer:    issuer,
		NotBefore: leaf.NotBefore,
		NotAfter:  leaf.NotAfter,
	}, nil
}

func (m *Manager) ListCertsSanitized() []config.Certificate {
	certs := m.store.ListCerts()
	for i := range certs {
		if len(certs[i].ACMEProviderConfig) > 0 {
			masked := make(map[string]string, len(certs[i].ACMEProviderConfig))
			for k, v := range certs[i].ACMEProviderConfig {
				if v != "" {
					masked[k] = "******"
				}
			}
			certs[i].ACMEProviderConfig = masked
		}
	}
	return certs
}

func (m *Manager) UploadManual(name, certPEM, keyPEM string) (config.Certificate, error) {
	info, err := ParseAndValidatePEM([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		return config.Certificate{}, err
	}

	name = strings.TrimSpace(name)
	if name == "" {
		if len(info.Domains) > 0 {
			name = info.Domains[0]
		} else {
			name = "自定义证书"
		}
	}

	id := config.GenerateID()
	certDir := filepath.Join(m.store.CertsDir(), id)
	if err := os.MkdirAll(certDir, 0o700); err != nil {
		return config.Certificate{}, err
	}
	certPath := filepath.Join(certDir, "fullchain.pem")
	keyPath := filepath.Join(certDir, "privkey.pem")

	if err := os.WriteFile(certPath, []byte(strings.TrimSpace(certPEM)+"\n"), 0o644); err != nil {
		return config.Certificate{}, err
	}
	if err := os.WriteFile(keyPath, []byte(strings.TrimSpace(keyPEM)+"\n"), 0o600); err != nil {
		_ = os.RemoveAll(certDir)
		return config.Certificate{}, err
	}

	now := time.Now()
	cert := config.Certificate{
		ID:        id,
		Name:      name,
		Source:    "manual",
		Domains:   info.Domains,
		Issuer:    info.Issuer,
		NotBefore: info.NotBefore,
		NotAfter:  info.NotAfter,
		CertPath:  certPath,
		KeyPath:   keyPath,
		AutoRenew: false,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := m.store.SaveCerts(func(list []config.Certificate) ([]config.Certificate, error) {
		return append(list, cert), nil
	}); err != nil {
		_ = os.RemoveAll(certDir)
		return config.Certificate{}, err
	}
	return cert, nil
}

func (m *Manager) DeleteCert(id string) error {
	cert, ok := m.store.GetCert(id)
	if !ok {
		return errors.New("证书不存在")
	}

	for _, site := range m.store.ListProxies() {
		if site.SSL && site.CertID == id {
			return fmt.Errorf("证书正被站点「%s」使用，请先解除绑定后再删除", site.Name)
		}
	}

	if err := m.store.SaveCerts(func(list []config.Certificate) ([]config.Certificate, error) {
		out := make([]config.Certificate, 0, len(list))
		for _, c := range list {
			if c.ID != id {
				out = append(out, c)
			}
		}
		return out, nil
	}); err != nil {
		return err
	}

	if cert.CertPath != "" {
		_ = os.RemoveAll(filepath.Dir(cert.CertPath))
	}
	return nil
}
