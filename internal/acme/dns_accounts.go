package acme

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"win-server-panel/internal/config"
)

type DNSAccountInput struct {
	Name     string            `json:"name"`
	Provider string            `json:"provider"` // "cloudflare", "alidns"
	Config   map[string]string `json:"config"`
	Remark   string            `json:"remark"`
}

func ValidateDNSProvider(provider string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "cloudflare":
		return "cloudflare", nil
	case "alidns":
		return "alidns", nil
	default:
		return "", fmt.Errorf("不支持的 DNS 服务商: %s（当前支持 Cloudflare、阿里云 DNS）", provider)
	}
}

func maskSecret(val string) string {
	val = strings.TrimSpace(val)
	if val == "" {
		return ""
	}
	runes := []rune(val)
	if len(runes) <= 10 {
		return "******"
	}
	return string(runes[:3]) + "****" + string(runes[len(runes)-4:])
}

func SanitizeDNSAccount(acc config.DNSAccount) config.DNSAccount {
	if len(acc.Config) > 0 {
		masked := make(map[string]string, len(acc.Config))
		for k, v := range acc.Config {
			masked[k] = maskSecret(v)
		}
		acc.Config = masked
	}
	return acc
}

func buildDNSAccountConfig(provider string, incoming, existing map[string]string) (map[string]string, error) {
	getVal := func(key string) string {
		if incoming != nil {
			if v := strings.TrimSpace(incoming[key]); v != "" {
				return v
			}
		}
		if existing != nil {
			return strings.TrimSpace(existing[key])
		}
		return ""
	}

	switch provider {
	case "cloudflare":
		token := getVal("apiToken")
		if token == "" {
			return nil, errors.New("Cloudflare DNS 账号需要填写 API Token")
		}
		return map[string]string{
			"apiToken": token,
		}, nil
	case "alidns":
		ak := getVal("accessKeyId")
		sk := getVal("accessKeySecret")
		if ak == "" || sk == "" {
			return nil, errors.New("阿里云 DNS 账号需要填写 AccessKey ID 和 AccessKey Secret")
		}
		return map[string]string{
			"accessKeyId":     ak,
			"accessKeySecret": sk,
		}, nil
	default:
		return nil, fmt.Errorf("不支持的 DNS 服务商: %s", provider)
	}
}

func (m *Manager) ListDNSAccountsSanitized() []config.DNSAccount {
	list := m.store.ListDNSAccounts()
	out := make([]config.DNSAccount, len(list))
	for i, acc := range list {
		out[i] = SanitizeDNSAccount(acc)
	}
	return out
}

func (m *Manager) CreateDNSAccount(in DNSAccountInput) (config.DNSAccount, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return config.DNSAccount{}, errors.New("请填写 DNS 账号名称")
	}
	provider, err := ValidateDNSProvider(in.Provider)
	if err != nil {
		return config.DNSAccount{}, err
	}
	cfg, err := buildDNSAccountConfig(provider, in.Config, nil)
	if err != nil {
		return config.DNSAccount{}, err
	}

	now := time.Now()
	acc := config.DNSAccount{
		ID:        config.GenerateID(),
		Name:      name,
		Provider:  provider,
		Config:    cfg,
		Remark:    strings.TrimSpace(in.Remark),
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := m.store.SaveDNSAccounts(func(list []config.DNSAccount) ([]config.DNSAccount, error) {
		return append(list, acc), nil
	}); err != nil {
		return config.DNSAccount{}, err
	}
	return SanitizeDNSAccount(acc), nil
}

func (m *Manager) UpdateDNSAccount(id string, in DNSAccountInput) (config.DNSAccount, error) {
	existing, ok := m.store.GetDNSAccount(id)
	if !ok {
		return config.DNSAccount{}, errors.New("DNS 账号不存在")
	}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		return config.DNSAccount{}, errors.New("请填写 DNS 账号名称")
	}

	provider := existing.Provider
	if strings.TrimSpace(in.Provider) != "" {
		var err error
		provider, err = ValidateDNSProvider(in.Provider)
		if err != nil {
			return config.DNSAccount{}, err
		}
	}

	// Prevent switching provider while certificates are bound to this account
	if provider != existing.Provider {
		for _, c := range m.store.ListCerts() {
			if c.DNSAccountID == id {
				return config.DNSAccount{}, fmt.Errorf("该 DNS 账号正被证书「%s」使用，无法更改服务商类型", c.Name)
			}
		}
	}

	var baseCfg map[string]string
	if provider == existing.Provider {
		baseCfg = existing.Config
	}
	cfg, err := buildDNSAccountConfig(provider, in.Config, baseCfg)
	if err != nil {
		return config.DNSAccount{}, err
	}

	updated := existing
	updated.Name = name
	updated.Provider = provider
	updated.Config = cfg
	updated.Remark = strings.TrimSpace(in.Remark)
	updated.UpdatedAt = time.Now()

	if err := m.store.SaveDNSAccounts(func(list []config.DNSAccount) ([]config.DNSAccount, error) {
		for i := range list {
			if list[i].ID == id {
				list[i] = updated
				return list, nil
			}
		}
		return list, errors.New("DNS 账号不存在")
	}); err != nil {
		return config.DNSAccount{}, err
	}
	return SanitizeDNSAccount(updated), nil
}

func (m *Manager) DeleteDNSAccount(id string) error {
	if _, ok := m.store.GetDNSAccount(id); !ok {
		return errors.New("DNS 账号不存在")
	}
	for _, c := range m.store.ListCerts() {
		if c.DNSAccountID == id {
			return fmt.Errorf("DNS 账号正被证书「%s」使用，请先修改或删除相关证书后再删除", c.Name)
		}
	}
	return m.store.SaveDNSAccounts(func(list []config.DNSAccount) ([]config.DNSAccount, error) {
		out := make([]config.DNSAccount, 0, len(list))
		for _, a := range list {
			if a.ID != id {
				out = append(out, a)
			}
		}
		return out, nil
	})
}
