package config

import "time"

type PanelConfig struct {
	ListenAddr string        `json:"listenAddr"`
	Port       int           `json:"port"`
	Auth       AuthConfig    `json:"auth"`
	Nginx      NginxSettings `json:"nginx"`
	SSH        SSHConfig     `json:"ssh"`
}

type AuthConfig struct {
	Initialized   bool   `json:"initialized"`
	Username      string `json:"username"`
	PasswordHash  string `json:"passwordHash"`
	JWTSecret     string `json:"jwtSecret"`
	TokenTTLHours int    `json:"tokenTtlHours"`
}

type NginxSettings struct {
	AutoStart  bool   `json:"autoStart"`
	CustomPath string `json:"customPath"` // optional override; empty uses embedded nginx
}

type SSHConfig struct {
	Enabled      bool   `json:"enabled"`
	AutoStart    bool   `json:"autoStart"`
	ListenAddr   string `json:"listenAddr"`
	Port         int    `json:"port"`
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
	DefaultShell string `json:"defaultShell"` // "powershell" or "cmd"
	WorkDir      string `json:"workDir"`      // default working directory for SSH/SFTP/Web Terminal
	EnableSFTP   bool   `json:"enableSftp"`
}

type ProxySite struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Enabled           bool      `json:"enabled"`
	Domains           []string  `json:"domains"`
	ListenPort        int       `json:"listenPort"`
	Upstream          string    `json:"upstream"`
	SSL               bool      `json:"ssl"`
	CertID            string    `json:"certId"`
	ForceHTTPS        bool      `json:"forceHttps"`
	WebSocket         bool      `json:"webSocket"`
	RealIPHeaders     bool      `json:"realIpHeaders"`
	ClientMaxBodySize string    `json:"clientMaxBodySize"`
	CustomConfig      string    `json:"customConfig"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type Certificate struct {
	ID                 string            `json:"id"`
	Name               string            `json:"name"`
	Source             string            `json:"source"` // "manual" or "acme"
	Domains            []string          `json:"domains"`
	Issuer             string            `json:"issuer"`
	NotBefore          time.Time         `json:"notBefore"`
	NotAfter           time.Time         `json:"notAfter"`
	CertPath           string            `json:"certPath"`
	KeyPath            string            `json:"keyPath"`
	ACMEEmail          string            `json:"acmeEmail,omitempty"`
	ACMEChallenge      string            `json:"acmeChallenge,omitempty"` // "http01", "cloudflare", "alidns"
	ACMEProviderConfig map[string]string `json:"acmeProviderConfig,omitempty"`
	AutoRenew          bool              `json:"autoRenew"`
	LastRenewAt        *time.Time        `json:"lastRenewAt,omitempty"`
	LastError          string            `json:"lastError,omitempty"`
	CreatedAt          time.Time         `json:"createdAt"`
	UpdatedAt          time.Time         `json:"updatedAt"`
}

type FirewallRule struct {
	ID            string    `json:"id"`
	WinRuleName   string    `json:"winRuleName"`
	Name          string    `json:"name"`
	Protocol      string    `json:"protocol"` // "TCP", "UDP", "Any"
	Port          string    `json:"port"`     // e.g. "80", "8000-8010"
	Action        string    `json:"action"`   // "Allow", "Block"
	RemoteAddress string    `json:"remoteAddress"` // "Any" or comma-separated IPs/CIDRs
	Enabled       bool      `json:"enabled"`
	Remark        string    `json:"remark"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

func DefaultPanelConfig(jwtSecret string) PanelConfig {
	return PanelConfig{
		ListenAddr: "0.0.0.0",
		Port:       8900,
		Auth: AuthConfig{
			Initialized:   false,
			JWTSecret:     jwtSecret,
			TokenTTLHours: 24,
		},
		Nginx: NginxSettings{
			AutoStart: true,
		},
		SSH: SSHConfig{
			Enabled:      false,
			AutoStart:    false,
			ListenAddr:   "0.0.0.0",
			Port:         2222,
			Username:     "admin",
			DefaultShell: "powershell",
			WorkDir:      `C:\ssh-tmp`,
			EnableSFTP:   true,
		},
	}
}
