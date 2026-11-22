package nginx

import (
	"strings"
	"testing"

	"win-server-panel/internal/config"
)

func TestRenderSiteConfig(t *testing.T) {
	site := config.ProxySite{
		ID:                "abc123",
		Name:              "My App",
		Enabled:           true,
		Domains:           []string{"app.example.com", "www.example.com"},
		ListenPort:        443,
		Upstream:          "http://127.0.0.1:3000",
		SSL:               true,
		CertID:            "cert1",
		ForceHTTPS:        true,
		WebSocket:         true,
		RealIPHeaders:     true,
		ClientMaxBodySize: "100m",
		CustomConfig:      "add_header X-Test 1;",
	}
	cert := &config.Certificate{
		ID:       "cert1",
		CertPath: `C:\panel\data\certs\cert1\fullchain.pem`,
		KeyPath:  `C:\panel\data\certs\cert1\privkey.pem`,
	}

	out, err := RenderSiteConfig(site, cert, `C:\panel\data\acme-webroot`)
	if err != nil {
		t.Fatalf("RenderSiteConfig failed: %v", err)
	}

	expects := []string{
		"listen 80;",
		"return 301 https://$host$request_uri;",
		"listen 443 ssl;",
		"server_name app.example.com www.example.com;",
		`ssl_certificate     "C:/panel/data/certs/cert1/fullchain.pem";`,
		`ssl_certificate_key "C:/panel/data/certs/cert1/privkey.pem";`,
		`root "C:/panel/data/acme-webroot";`,
		"proxy_pass http://127.0.0.1:3000;",
		"proxy_set_header Upgrade $http_upgrade;",
		"client_max_body_size 100m;",
		"add_header X-Test 1;",
	}
	for _, exp := range expects {
		if !strings.Contains(out, exp) {
			t.Errorf("rendered config missing %q\n---CONFIG---\n%s", exp, out)
		}
	}
}
