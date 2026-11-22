package nginx

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"
	"text/template"

	"win-server-panel/internal/config"
)

const masterConfTemplate = `# Managed by MoServerPanel - DO NOT EDIT MANUALLY
worker_processes  auto;

error_log  logs/error.log warn;
pid        logs/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    tcp_nopush      on;
    keepalive_timeout  65;
    server_tokens   off;
    server_names_hash_bucket_size 128;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log logs/access.log main;

    gzip on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    include conf.d/*.conf;
}
`

const siteConfTemplate = `# Site: {{ .Site.Name }} (ID: {{ .Site.ID }})
{{- if and .Site.SSL .Site.ForceHTTPS }}
server {
    listen 80;
    server_name {{ .ServerName }};

    location ^~ /.well-known/acme-challenge/ {
        root "{{ .ACMEWebroot }}";
        default_type "text/plain";
    }

    location / {
        return 301 https://$host{{ if ne .ListenPort 443 }}:{{ .ListenPort }}{{ end }}$request_uri;
    }
}
{{- end }}

server {
    listen {{ .ListenPort }}{{ if .Site.SSL }} ssl{{ end }};
    server_name {{ .ServerName }};

{{- if .Site.SSL }}
    ssl_certificate     "{{ .CertPath }}";
    ssl_certificate_key "{{ .KeyPath }}";
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;
{{- end }}

    client_max_body_size {{ .MaxBodySize }};

{{- if eq .ListenPort 80 }}
    location ^~ /.well-known/acme-challenge/ {
        root "{{ .ACMEWebroot }}";
        default_type "text/plain";
    }
{{- end }}

    location / {
        proxy_pass {{ .Site.Upstream }};
        proxy_http_version 1.1;
{{- if .Site.RealIPHeaders }}
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
{{- end }}
{{- if .Site.WebSocket }}
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
{{- end }}
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
{{- if .CustomConfig }}

    # Custom directives
{{ .CustomConfig }}
{{- end }}
}
`

const acmeTempConfTemplate = `# Temporary ACME HTTP-01 challenge server
server {
    listen 80;
    server_name {{ .ServerName }};

    location ^~ /.well-known/acme-challenge/ {
        root "{{ .ACMEWebroot }}";
        default_type "text/plain";
    }

    location / {
        return 404;
    }
}
`

var (
	parsedSiteTmpl = template.Must(template.New("site").Parse(siteConfTemplate))
	parsedAcmeTmpl = template.Must(template.New("acme").Parse(acmeTempConfTemplate))
)

type siteTemplateData struct {
	Site         config.ProxySite
	ServerName   string
	ListenPort   int
	CertPath     string
	KeyPath      string
	MaxBodySize  string
	ACMEWebroot  string
	CustomConfig string
}

func RenderMasterConfig() string {
	return masterConfTemplate
}

func RenderSiteConfig(site config.ProxySite, cert *config.Certificate, acmeWebroot string) (string, error) {
	serverName := "_"
	if len(site.Domains) > 0 {
		cleaned := make([]string, 0, len(site.Domains))
		for _, d := range site.Domains {
			d = strings.TrimSpace(d)
			if d != "" {
				cleaned = append(cleaned, d)
			}
		}
		if len(cleaned) > 0 {
			serverName = strings.Join(cleaned, " ")
		}
	}

	listenPort := site.ListenPort
	if listenPort <= 0 {
		if site.SSL {
			listenPort = 443
		} else {
			listenPort = 80
		}
	}

	maxBody := strings.TrimSpace(site.ClientMaxBodySize)
	if maxBody == "" {
		maxBody = "50m"
	}

	data := siteTemplateData{
		Site:         site,
		ServerName:   serverName,
		ListenPort:   listenPort,
		MaxBodySize:  maxBody,
		ACMEWebroot:  filepath.ToSlash(acmeWebroot),
		CustomConfig: indentLines(strings.TrimSpace(site.CustomConfig), "    "),
	}

	if site.SSL {
		if cert == nil {
			return "", fmt.Errorf("站点启用了 HTTPS，但未找到关联证书 (%s)", site.CertID)
		}
		data.CertPath = filepath.ToSlash(cert.CertPath)
		data.KeyPath = filepath.ToSlash(cert.KeyPath)
	}

	var buf bytes.Buffer
	if err := parsedSiteTmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func RenderACMETempConfig(domains []string, acmeWebroot string) (string, error) {
	var buf bytes.Buffer
	err := parsedAcmeTmpl.Execute(&buf, map[string]string{
		"ServerName":  strings.Join(domains, " "),
		"ACMEWebroot": filepath.ToSlash(acmeWebroot),
	})
	if err != nil {
		return "", err
	}
	return buf.String(), nil
}

func indentLines(s, prefix string) string {
	if s == "" {
		return ""
	}
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
}
