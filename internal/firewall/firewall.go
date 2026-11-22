package firewall

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"win-server-panel/internal/config"
	"win-server-panel/internal/sysinfo"
)

const (
	RuleGroup  = "MoServerPanel"
	RulePrefix = "MSP-"
)

var (
	ErrElevationRequired = errors.New("修改 Windows 防火墙需要管理员权限，请以管理员身份运行面板或安装为 Windows 服务")
	portPartRegex        = regexp.MustCompile(`^\d+(-\d+)?$`)
)

type SystemRule struct {
	Name          string `json:"name"`
	DisplayName   string `json:"displayName"`
	Enabled       bool   `json:"enabled"`
	Action        string `json:"action"`
	Profile       string `json:"profile"`
	Group         string `json:"group"`
	Protocol      string `json:"protocol"`
	LocalPort     string `json:"localPort"`
	RemoteAddress string `json:"remoteAddress"`
	Managed       bool   `json:"managed"`
}

type RuleInput struct {
	Name          string `json:"name"`
	Protocol      string `json:"protocol"`
	Port          string `json:"port"`
	Action        string `json:"action"`
	RemoteAddress string `json:"remoteAddress"`
	Enabled       bool   `json:"enabled"`
	Remark        string `json:"remark"`
}

type Manager struct {
	store *config.Store
}

func NewManager(store *config.Store) *Manager {
	return &Manager{store: store}
}

func ValidatePortSpec(port string) (string, error) {
	port = strings.TrimSpace(port)
	if port == "" {
		return "", errors.New("端口不能为空")
	}
	parts := strings.Split(port, ",")
	cleaned := make([]string, 0, len(parts))
	for _, raw := range parts {
		p := strings.TrimSpace(raw)
		if !portPartRegex.MatchString(p) {
			return "", fmt.Errorf("无效的端口格式: %s（示例: 80、443、8000-8010 或 80,443）", p)
		}
		if strings.Contains(p, "-") {
			bounds := strings.SplitN(p, "-", 2)
			a, err1 := strconv.Atoi(bounds[0])
			b, err2 := strconv.Atoi(bounds[1])
			if err1 != nil || err2 != nil || a < 1 || a > 65535 || b < 1 || b > 65535 || a > b {
				return "", fmt.Errorf("无效的端口范围: %s（范围须在 1-65535 且起始不大于结束）", p)
			}
			cleaned = append(cleaned, fmt.Sprintf("%d-%d", a, b))
		} else {
			n, err := strconv.Atoi(p)
			if err != nil || n < 1 || n > 65535 {
				return "", fmt.Errorf("端口号超出范围: %s（须在 1-65535）", p)
			}
			cleaned = append(cleaned, strconv.Itoa(n))
		}
	}
	return strings.Join(cleaned, ","), nil
}

func ValidateProtocol(proto string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(proto)) {
	case "TCP":
		return "TCP", nil
	case "UDP":
		return "UDP", nil
	case "ANY", "BOTH", "TCP/UDP":
		return "Any", nil
	default:
		return "", fmt.Errorf("不支持的协议: %s（仅支持 TCP、UDP 或 Any）", proto)
	}
}

func ValidateAction(action string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "allow", "":
		return "Allow", nil
	case "block":
		return "Block", nil
	default:
		return "", fmt.Errorf("不支持的动作: %s（仅支持 Allow 或 Block）", action)
	}
}

func ValidateRemoteAddress(addr string) (string, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" || strings.EqualFold(addr, "any") || addr == "*" {
		return "Any", nil
	}
	parts := strings.Split(addr, ",")
	cleaned := make([]string, 0, len(parts))
	for _, raw := range parts {
		p := strings.TrimSpace(raw)
		if p == "" {
			continue
		}
		if strings.Contains(p, "/") {
			prefix, err := netip.ParsePrefix(p)
			if err != nil {
				return "", fmt.Errorf("无效的网段 CIDR: %s", p)
			}
			cleaned = append(cleaned, prefix.String())
		} else {
			ip, err := netip.ParseAddr(p)
			if err != nil {
				return "", fmt.Errorf("无效的 IP 地址: %s", p)
			}
			cleaned = append(cleaned, ip.String())
		}
	}
	if len(cleaned) == 0 {
		return "Any", nil
	}
	return strings.Join(cleaned, ","), nil
}

func sanitizeText(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	runes := []rune(s)
	if len(runes) > maxLen {
		return string(runes[:maxLen])
	}
	return s
}

func psQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func (m *Manager) validateInput(in RuleInput) (RuleInput, error) {
	port, err := ValidatePortSpec(in.Port)
	if err != nil {
		return in, err
	}
	proto, err := ValidateProtocol(in.Protocol)
	if err != nil {
		return in, err
	}
	action, err := ValidateAction(in.Action)
	if err != nil {
		return in, err
	}
	remote, err := ValidateRemoteAddress(in.RemoteAddress)
	if err != nil {
		return in, err
	}
	name := sanitizeText(in.Name, 64)
	if name == "" {
		name = fmt.Sprintf("%s %s (%s)", action, port, proto)
	}
	remark := sanitizeText(in.Remark, 200)
	return RuleInput{
		Name:          name,
		Protocol:      proto,
		Port:          port,
		Action:        action,
		RemoteAddress: remote,
		Enabled:       in.Enabled,
		Remark:        remark,
	}, nil
}

func (m *Manager) ListManagedRules() []config.FirewallRule {
	return m.store.ListFirewallRules()
}

func (m *Manager) CreateRule(ctx context.Context, raw RuleInput) (config.FirewallRule, error) {
	if !sysinfo.IsElevated() {
		return config.FirewallRule{}, ErrElevationRequired
	}
	in, err := m.validateInput(raw)
	if err != nil {
		return config.FirewallRule{}, err
	}

	id := config.GenerateID()
	now := time.Now()
	rule := config.FirewallRule{
		ID:            id,
		WinRuleName:   RulePrefix + id,
		Name:          in.Name,
		Protocol:      in.Protocol,
		Port:          in.Port,
		Action:        in.Action,
		RemoteAddress: in.RemoteAddress,
		Enabled:       in.Enabled,
		Remark:        in.Remark,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := m.applyWinRule(ctx, rule); err != nil {
		return config.FirewallRule{}, err
	}

	if err := m.store.SaveFirewallRules(func(rules []config.FirewallRule) ([]config.FirewallRule, error) {
		return append(rules, rule), nil
	}); err != nil {
		_ = m.removeWinRule(ctx, rule.WinRuleName)
		return config.FirewallRule{}, err
	}
	return rule, nil
}

func (m *Manager) UpdateRule(ctx context.Context, id string, raw RuleInput) (config.FirewallRule, error) {
	if !sysinfo.IsElevated() {
		return config.FirewallRule{}, ErrElevationRequired
	}
	existing, ok := m.store.GetFirewallRule(id)
	if !ok {
		return config.FirewallRule{}, errors.New("规则不存在")
	}
	in, err := m.validateInput(raw)
	if err != nil {
		return config.FirewallRule{}, err
	}

	updated := existing
	updated.Name = in.Name
	updated.Protocol = in.Protocol
	updated.Port = in.Port
	updated.Action = in.Action
	updated.RemoteAddress = in.RemoteAddress
	updated.Enabled = in.Enabled
	updated.Remark = in.Remark
	updated.UpdatedAt = time.Now()

	// Remove old Windows rule(s) and recreate cleanly so protocol/port changes always succeed
	if err := m.removeWinRule(ctx, existing.WinRuleName); err != nil {
		return config.FirewallRule{}, err
	}
	if err := m.applyWinRule(ctx, updated); err != nil {
		// Best effort rollback
		_ = m.applyWinRule(ctx, existing)
		return config.FirewallRule{}, err
	}

	if err := m.store.SaveFirewallRules(func(rules []config.FirewallRule) ([]config.FirewallRule, error) {
		for i := range rules {
			if rules[i].ID == id {
				rules[i] = updated
				return rules, nil
			}
		}
		return rules, errors.New("规则不存在")
	}); err != nil {
		return config.FirewallRule{}, err
	}

	return updated, nil
}

func (m *Manager) ToggleRule(ctx context.Context, id string, enabled bool) (config.FirewallRule, error) {
	existing, ok := m.store.GetFirewallRule(id)
	if !ok {
		return config.FirewallRule{}, errors.New("规则不存在")
	}
	return m.UpdateRule(ctx, id, RuleInput{
		Name:          existing.Name,
		Protocol:      existing.Protocol,
		Port:          existing.Port,
		Action:        existing.Action,
		RemoteAddress: existing.RemoteAddress,
		Enabled:       enabled,
		Remark:        existing.Remark,
	})
}

func (m *Manager) DeleteRule(ctx context.Context, id string) error {
	if !sysinfo.IsElevated() {
		return ErrElevationRequired
	}
	existing, ok := m.store.GetFirewallRule(id)
	if !ok {
		return errors.New("规则不存在")
	}
	if err := m.removeWinRule(ctx, existing.WinRuleName); err != nil {
		return err
	}
	return m.store.SaveFirewallRules(func(rules []config.FirewallRule) ([]config.FirewallRule, error) {
		out := make([]config.FirewallRule, 0, len(rules))
		for _, r := range rules {
			if r.ID != id {
				out = append(out, r)
			}
		}
		return out, nil
	})
}

func (m *Manager) applyWinRule(ctx context.Context, rule config.FirewallRule) error {
	protos := []string{rule.Protocol}
	if rule.Protocol == "Any" {
		// Windows Firewall forbids -LocalPort when -Protocol is Any, so split into TCP + UDP cleanly.
		protos = []string{"TCP", "UDP"}
	}

	enabledStr := "False"
	if rule.Enabled {
		enabledStr = "True"
	}

	portTokens := strings.Split(rule.Port, ",")
	psPorts := make([]string, 0, len(portTokens))
	for _, p := range portTokens {
		psPorts = append(psPorts, psQuote(strings.TrimSpace(p)))
	}
	portArrayExpr := "@(" + strings.Join(psPorts, ",") + ")"

	remoteExpr := "'Any'"
	if rule.RemoteAddress != "" && !strings.EqualFold(rule.RemoteAddress, "Any") {
		addrs := strings.Split(rule.RemoteAddress, ",")
		psAddrs := make([]string, 0, len(addrs))
		for _, a := range addrs {
			psAddrs = append(psAddrs, psQuote(strings.TrimSpace(a)))
		}
		remoteExpr = "@(" + strings.Join(psAddrs, ",") + ")"
	}

	var script strings.Builder
	script.WriteString("$ErrorActionPreference = 'Stop'\n")
	for _, p := range protos {
		winName := rule.WinRuleName
		displayName := fmt.Sprintf("[MSP] %s", rule.Name)
		if len(protos) > 1 {
			winName = rule.WinRuleName + "-" + p
			displayName = fmt.Sprintf("[MSP] %s (%s)", rule.Name, p)
		}
		script.WriteString(fmt.Sprintf(
			"New-NetFirewallRule -Name %s -DisplayName %s -Group %s -Direction Inbound -Action %s -Protocol %s -LocalPort %s -RemoteAddress %s -Enabled %s -Profile Any -Description %s | Out-Null\n",
			psQuote(winName),
			psQuote(displayName),
			psQuote(RuleGroup),
			rule.Action,
			p,
			portArrayExpr,
			remoteExpr,
			enabledStr,
			psQuote(rule.Remark),
		))
	}

	_, err := runPowerShell(ctx, script.String())
	if err != nil {
		return fmt.Errorf("应用 Windows 防火墙规则失败: %w", err)
	}
	return nil
}

func (m *Manager) removeWinRule(ctx context.Context, winRuleName string) error {
	script := fmt.Sprintf(
		"$ErrorActionPreference = 'SilentlyContinue'\n"+
			"Remove-NetFirewallRule -Name %s\n"+
			"Remove-NetFirewallRule -Name %s\n"+
			"Remove-NetFirewallRule -Name %s\n",
		psQuote(winRuleName),
		psQuote(winRuleName+"-TCP"),
		psQuote(winRuleName+"-UDP"),
	)
	_, err := runPowerShell(ctx, script)
	if err != nil {
		return fmt.Errorf("删除 Windows 防火墙规则失败: %w", err)
	}
	return nil
}

func (m *Manager) ListSystemInboundRules(ctx context.Context) ([]SystemRule, error) {
	script := `
$ErrorActionPreference = 'SilentlyContinue'
$portMap = @{}
Get-NetFirewallPortFilter | ForEach-Object { $portMap[$_.InstanceID] = $_ }
$addrMap = @{}
Get-NetFirewallAddressFilter | ForEach-Object { $addrMap[$_.InstanceID] = $_ }

$rules = Get-NetFirewallRule -Direction Inbound | ForEach-Object {
    $pf = $portMap[$_.InstanceID]
    $af = $addrMap[$_.InstanceID]
    $lp = if ($pf -and $pf.LocalPort) { ($pf.LocalPort -join ',') } else { 'Any' }
    $pr = if ($pf -and $pf.Protocol) { [string]$pf.Protocol } else { 'Any' }
    $ra = if ($af -and $af.RemoteAddress) { ($af.RemoteAddress -join ',') } else { 'Any' }
    [PSCustomObject]@{
        name = [string]$_.Name
        displayName = [string]$_.DisplayName
        enabled = ($_.Enabled -eq 'True' -or $_.Enabled -eq 1)
        action = [string]$_.Action
        profile = [string]$_.Profile
        group = [string]$_.Group
        protocol = $pr
        localPort = $lp
        remoteAddress = $ra
        managed = ($_.Group -eq 'MoServerPanel' -or $_.Name -like 'MSP-*')
    }
}
$rules | ConvertTo-Json -Compress
`
	out, err := runPowerShell(ctx, script)
	if err != nil {
		return nil, fmt.Errorf("读取系统防火墙规则失败: %w", err)
	}
	trimmed := strings.TrimSpace(out)
	if trimmed == "" || trimmed == "null" {
		return []SystemRule{}, nil
	}

	var list []SystemRule
	if strings.HasPrefix(trimmed, "[") {
		if err := json.Unmarshal([]byte(trimmed), &list); err != nil {
			return nil, fmt.Errorf("解析系统防火墙规则失败: %w", err)
		}
	} else {
		var single SystemRule
		if err := json.Unmarshal([]byte(trimmed), &single); err != nil {
			return nil, fmt.Errorf("解析系统防火墙规则失败: %w", err)
		}
		list = []SystemRule{single}
	}
	return list, nil
}

func runPowerShell(ctx context.Context, script string) (string, error) {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 25*time.Second)
		defer cancel()
	}

	fullScript := "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n" + script
	cmd := exec.CommandContext(ctx, "powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-Command", fullScript,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = strings.TrimSpace(stdout.String())
		}
		if errMsg != "" {
			return "", fmt.Errorf("%s", errMsg)
		}
		return "", err
	}
	return stdout.String(), nil
}
