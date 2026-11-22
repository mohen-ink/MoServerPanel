package firewall

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"

	"win-server-panel/internal/config"
)

type ListeningPort struct {
	Protocol     string `json:"protocol"`
	LocalAddr    string `json:"localAddr"`
	Port         uint32 `json:"port"`
	PID          int32  `json:"pid"`
	ProcessName  string `json:"processName"`
	ProcessPath  string `json:"processPath"`
	ManagedAllow bool   `json:"managedAllow"`
}

func (m *Manager) ListListeningPorts() ([]ListeningPort, error) {
	conns, err := gnet.Connections("inet")
	if err != nil {
		return nil, err
	}

	managedRules := m.store.ListFirewallRules()

	type procMeta struct {
		name string
		path string
	}
	procCache := make(map[int32]procMeta)
	getProc := func(pid int32) procMeta {
		if pid <= 0 {
			return procMeta{name: "System"}
		}
		if v, ok := procCache[pid]; ok {
			return v
		}
		meta := procMeta{name: fmt.Sprintf("PID:%d", pid)}
		if p, err := process.NewProcess(pid); err == nil {
			if n, err := p.Name(); err == nil && n != "" {
				meta.name = n
			}
			if exe, err := p.Exe(); err == nil {
				meta.path = exe
			}
		}
		procCache[pid] = meta
		return meta
	}

	seen := make(map[string]bool)
	result := make([]ListeningPort, 0)

	for _, c := range conns {
		if c.Laddr.Port == 0 {
			continue
		}
		var proto string
		switch c.Type {
		case 1: // SOCK_STREAM (TCP)
			if c.Status != "LISTEN" {
				continue
			}
			proto = "TCP"
		case 2: // SOCK_DGRAM (UDP)
			proto = "UDP"
		default:
			continue
		}

		key := fmt.Sprintf("%s|%s|%d|%d", proto, c.Laddr.IP, c.Laddr.Port, c.Pid)
		if seen[key] {
			continue
		}
		seen[key] = true

		pm := getProc(c.Pid)
		result = append(result, ListeningPort{
			Protocol:     proto,
			LocalAddr:    c.Laddr.IP,
			Port:         c.Laddr.Port,
			PID:          c.Pid,
			ProcessName:  pm.name,
			ProcessPath:  pm.path,
			ManagedAllow: isPortAllowedByManagedRules(managedRules, proto, int(c.Laddr.Port)),
		})
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Port != result[j].Port {
			return result[i].Port < result[j].Port
		}
		if result[i].Protocol != result[j].Protocol {
			return result[i].Protocol < result[j].Protocol
		}
		return result[i].LocalAddr < result[j].LocalAddr
	})

	return result, nil
}

func isPortAllowedByManagedRules(rules []config.FirewallRule, proto string, port int) bool {
	for _, r := range rules {
		if !r.Enabled || !strings.EqualFold(r.Action, "Allow") {
			continue
		}
		if !strings.EqualFold(r.Protocol, "Any") && !strings.EqualFold(r.Protocol, proto) {
			continue
		}
		if portMatchesSpec(port, r.Port) {
			return true
		}
	}
	return false
}

func portMatchesSpec(port int, spec string) bool {
	for _, raw := range strings.Split(spec, ",") {
		p := strings.TrimSpace(raw)
		if strings.Contains(p, "-") {
			bounds := strings.SplitN(p, "-", 2)
			a, err1 := strconv.Atoi(bounds[0])
			b, err2 := strconv.Atoi(bounds[1])
			if err1 == nil && err2 == nil && port >= a && port <= b {
				return true
			}
		} else {
			n, err := strconv.Atoi(p)
			if err == nil && port == n {
				return true
			}
		}
	}
	return false
}
