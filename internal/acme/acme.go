package acme

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-acme/lego/v4/certcrypto"
	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/providers/dns/alidns"
	"github.com/go-acme/lego/v4/providers/dns/cloudflare"
	"github.com/go-acme/lego/v4/providers/http/webroot"
	"github.com/go-acme/lego/v4/registration"

	"win-server-panel/internal/config"
	"win-server-panel/internal/nginx"
)

type IssueRequest struct {
	Name           string            `json:"name"`
	Domains        []string          `json:"domains"`
	Email          string            `json:"email"`
	Challenge      string            `json:"challenge"` // "http01", "cloudflare", "alidns"
	ProviderConfig map[string]string `json:"providerConfig"`
	AutoRenew      bool              `json:"autoRenew"`
	Staging        bool              `json:"staging"`
}

type Manager struct {
	mu       sync.Mutex
	store    *config.Store
	nginxMgr *nginx.Manager
}

func NewManager(store *config.Store, nginxMgr *nginx.Manager) *Manager {
	return &Manager{
		store:    store,
		nginxMgr: nginxMgr,
	}
}

type acmeUser struct {
	Email        string                 `json:"email"`
	Registration *registration.Resource `json:"registration"`
	KeyPEM       string                 `json:"keyPem"`
	key          crypto.PrivateKey
}

func (u *acmeUser) GetEmail() string                        { return u.Email }
func (u *acmeUser) GetRegistration() *registration.Resource { return u.Registration }
func (u *acmeUser) GetPrivateKey() crypto.PrivateKey        { return u.key }

var safeFileRe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func (m *Manager) loadOrCreateUser(email string, staging bool) (*acmeUser, string, error) {
	suffix := "prod"
	if staging {
		suffix = "staging"
	}
	fileName := safeFileRe.ReplaceAllString(strings.ToLower(email), "_") + "_" + suffix + ".json"
	accPath := filepath.Join(m.store.ACMEAccountsDir(), fileName)

	if raw, err := os.ReadFile(accPath); err == nil {
		var u acmeUser
		if err := json.Unmarshal(raw, &u); err == nil && u.KeyPEM != "" {
			block, _ := pem.Decode([]byte(u.KeyPEM))
			if block != nil {
				if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
					u.key = key
					return &u, accPath, nil
				}
			}
		}
	}

	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, "", err
	}
	der, err := x509.MarshalECPrivateKey(privKey)
	if err != nil {
		return nil, "", err
	}
	keyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}))

	return &acmeUser{
		Email:  email,
		KeyPEM: keyPEM,
		key:    privKey,
	}, accPath, nil
}

func saveACMEUser(path string, u *acmeUser) error {
	raw, err := json.MarshalIndent(u, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func (m *Manager) IssueACME(req IssueRequest) (config.Certificate, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	domains := cleanDomains(req.Domains)
	if len(domains) == 0 {
		return config.Certificate{}, errors.New("请至少填写一个有效域名")
	}
	email := strings.TrimSpace(req.Email)
	if email == "" || !strings.Contains(email, "@") {
		return config.Certificate{}, errors.New("请填写有效的邮箱地址（用于 Let's Encrypt 账户注册）")
	}
	challenge := strings.ToLower(strings.TrimSpace(req.Challenge))
	if challenge == "" {
		challenge = "http01"
	}

	res, err := m.obtainCertResource(domains, email, challenge, req.ProviderConfig, req.Staging)
	if err != nil {
		return config.Certificate{}, err
	}

	info, err := ParseAndValidatePEM(res.Certificate, res.PrivateKey)
	if err != nil {
		return config.Certificate{}, err
	}

	id := config.GenerateID()
	certDir := filepath.Join(m.store.CertsDir(), id)
	if err := os.MkdirAll(certDir, 0o700); err != nil {
		return config.Certificate{}, err
	}
	certPath := filepath.Join(certDir, "fullchain.pem")
	keyPath := filepath.Join(certDir, "privkey.pem")

	if err := os.WriteFile(certPath, res.Certificate, 0o644); err != nil {
		return config.Certificate{}, err
	}
	if err := os.WriteFile(keyPath, res.PrivateKey, 0o600); err != nil {
		_ = os.RemoveAll(certDir)
		return config.Certificate{}, err
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = domains[0]
	}

	now := time.Now()
	cert := config.Certificate{
		ID:                 id,
		Name:               name,
		Source:             "acme",
		Domains:            info.Domains,
		Issuer:             info.Issuer,
		NotBefore:          info.NotBefore,
		NotAfter:           info.NotAfter,
		CertPath:           certPath,
		KeyPath:            keyPath,
		ACMEEmail:          email,
		ACMEChallenge:      challenge,
		ACMEProviderConfig: req.ProviderConfig,
		AutoRenew:          req.AutoRenew,
		LastRenewAt:        &now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	if err := m.store.SaveCerts(func(list []config.Certificate) ([]config.Certificate, error) {
		return append(list, cert), nil
	}); err != nil {
		_ = os.RemoveAll(certDir)
		return config.Certificate{}, err
	}

	return cert, nil
}

func (m *Manager) RenewCert(id string) (config.Certificate, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.store.GetCert(id)
	if !ok {
		return config.Certificate{}, errors.New("证书不存在")
	}
	if existing.Source != "acme" {
		return config.Certificate{}, errors.New("仅 Let's Encrypt ACME 证书支持自动续期")
	}

	res, err := m.obtainCertResource(existing.Domains, existing.ACMEEmail, existing.ACMEChallenge, existing.ACMEProviderConfig, false)
	if err != nil {
		_ = m.store.SaveCerts(func(list []config.Certificate) ([]config.Certificate, error) {
			for i := range list {
				if list[i].ID == id {
					list[i].LastError = err.Error()
					list[i].UpdatedAt = time.Now()
				}
			}
			return list, nil
		})
		return config.Certificate{}, err
	}

	info, err := ParseAndValidatePEM(res.Certificate, res.PrivateKey)
	if err != nil {
		return config.Certificate{}, err
	}

	if err := os.WriteFile(existing.CertPath, res.Certificate, 0o644); err != nil {
		return config.Certificate{}, err
	}
	if err := os.WriteFile(existing.KeyPath, res.PrivateKey, 0o600); err != nil {
		return config.Certificate{}, err
	}

	now := time.Now()
	updated := existing
	updated.Domains = info.Domains
	updated.Issuer = info.Issuer
	updated.NotBefore = info.NotBefore
	updated.NotAfter = info.NotAfter
	updated.LastRenewAt = &now
	updated.LastError = ""
	updated.UpdatedAt = now

	if err := m.store.SaveCerts(func(list []config.Certificate) ([]config.Certificate, error) {
		for i := range list {
			if list[i].ID == id {
				list[i] = updated
			}
		}
		return list, nil
	}); err != nil {
		return config.Certificate{}, err
	}

	// Reload Nginx so updated certificate takes effect immediately
	_ = m.nginxMgr.Reload()
	return updated, nil
}

func (m *Manager) obtainCertResource(domains []string, email, challenge string, providerCfg map[string]string, staging bool) (*certificate.Resource, error) {
	user, accPath, err := m.loadOrCreateUser(email, staging)
	if err != nil {
		return nil, fmt.Errorf("准备 ACME 账户失败: %w", err)
	}

	legoCfg := lego.NewConfig(user)
	if staging {
		legoCfg.CADirURL = lego.LEDirectoryStaging
	} else {
		legoCfg.CADirURL = lego.LEDirectoryProduction
	}
	legoCfg.Certificate.KeyType = certcrypto.RSA2048

	client, err := lego.NewClient(legoCfg)
	if err != nil {
		return nil, fmt.Errorf("初始化 ACME 客户端失败: %w", err)
	}

	if user.Registration == nil {
		reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
		if err != nil {
			return nil, fmt.Errorf("注册 Let's Encrypt 账户失败: %w", err)
		}
		user.Registration = reg
		_ = saveACMEUser(accPath, user)
	}

	var res *certificate.Resource
	obtainFn := func() error {
		var obtainErr error
		res, obtainErr = client.Certificate.Obtain(certificate.ObtainRequest{
			Domains: domains,
			Bundle:  true,
		})
		return obtainErr
	}

	switch challenge {
	case "http01":
		provider, err := webroot.NewHTTPProvider(m.store.ACMEWebrootDir())
		if err != nil {
			return nil, fmt.Errorf("初始化 HTTP-01 Webroot 失败: %w", err)
		}
		if err := client.Challenge.SetHTTP01Provider(provider); err != nil {
			return nil, err
		}
		if err := m.nginxMgr.WithACMEHTTP01Server(domains, obtainFn); err != nil {
			return nil, fmt.Errorf("申请证书失败 (HTTP-01): %w", err)
		}
	case "cloudflare":
		token := strings.TrimSpace(providerCfg["apiToken"])
		if token == "" {
			return nil, errors.New("Cloudflare DNS 验证需要填写 API Token")
		}
		cfCfg := cloudflare.NewDefaultConfig()
		cfCfg.AuthToken = token
		provider, err := cloudflare.NewDNSProviderConfig(cfCfg)
		if err != nil {
			return nil, fmt.Errorf("初始化 Cloudflare DNS 验证失败: %w", err)
		}
		if err := client.Challenge.SetDNS01Provider(provider); err != nil {
			return nil, err
		}
		if err := obtainFn(); err != nil {
			return nil, fmt.Errorf("申请证书失败 (Cloudflare DNS-01): %w", err)
		}
	case "alidns":
		ak := strings.TrimSpace(providerCfg["accessKeyId"])
		sk := strings.TrimSpace(providerCfg["accessKeySecret"])
		if ak == "" || sk == "" {
			return nil, errors.New("阿里云 DNS 验证需要填写 AccessKey ID 和 AccessKey Secret")
		}
		aliCfg := alidns.NewDefaultConfig()
		aliCfg.APIKey = ak
		aliCfg.SecretKey = sk
		provider, err := alidns.NewDNSProviderConfig(aliCfg)
		if err != nil {
			return nil, fmt.Errorf("初始化阿里云 DNS 验证失败: %w", err)
		}
		if err := client.Challenge.SetDNS01Provider(provider); err != nil {
			return nil, err
		}
		if err := obtainFn(); err != nil {
			return nil, fmt.Errorf("申请证书失败 (Alidns DNS-01): %w", err)
		}
	default:
		return nil, fmt.Errorf("不支持的验证方式: %s", challenge)
	}

	return res, nil
}

func (m *Manager) StartRenewalLoop(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(12 * time.Hour)
		defer ticker.Stop()

		// Initial check after a short startup delay
		select {
		case <-time.After(1 * time.Minute):
			m.checkAndRenewAll()
		case <-ctx.Done():
			return
		}

		for {
			select {
			case <-ticker.C:
				m.checkAndRenewAll()
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (m *Manager) checkAndRenewAll() {
	certs := m.store.ListCerts()
	for _, c := range certs {
		if c.Source != "acme" || !c.AutoRenew {
			continue
		}
		if time.Until(c.NotAfter) < 30*24*time.Hour {
			log.Printf("[acme] auto-renewing certificate %s (%v)...", c.Name, c.Domains)
			if _, err := m.RenewCert(c.ID); err != nil {
				log.Printf("[acme] auto-renew failed for %s: %v", c.Name, err)
			} else {
				log.Printf("[acme] auto-renew succeeded for %s", c.Name)
			}
		}
	}
}

func cleanDomains(raw []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(raw))
	for _, d := range raw {
		d = strings.ToLower(strings.TrimSpace(d))
		if d != "" && !seen[d] {
			seen[d] = true
			out = append(out, d)
		}
	}
	return out
}
