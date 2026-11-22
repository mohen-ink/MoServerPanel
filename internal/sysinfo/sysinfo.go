package sysinfo

import (
	"runtime"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"golang.org/x/sys/windows"
)

type DiskInfo struct {
	Mountpoint  string  `json:"mountpoint"`
	Fstype      string  `json:"fstype"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	UsedPercent float64 `json:"usedPercent"`
}

type Overview struct {
	Hostname      string     `json:"hostname"`
	OS            string     `json:"os"`
	Platform      string     `json:"platform"`
	Arch          string     `json:"arch"`
	Uptime        uint64     `json:"uptime"`
	IsAdmin       bool       `json:"isAdmin"`
	CPUCores      int        `json:"cpuCores"`
	CPUPercent    float64    `json:"cpuPercent"`
	MemTotal      uint64     `json:"memTotal"`
	MemUsed       uint64     `json:"memUsed"`
	MemPercent    float64    `json:"memPercent"`
	NetBytesSent  uint64     `json:"netBytesSent"`
	NetBytesRecv  uint64     `json:"netBytesRecv"`
	NetSentRate   float64    `json:"netSentRate"`
	NetRecvRate   float64    `json:"netRecvRate"`
	Disks         []DiskInfo `json:"disks"`
	CollectedAt   time.Time  `json:"collectedAt"`
}

type Collector struct {
	mu           sync.Mutex
	lastNetTime  time.Time
	lastSent     uint64
	lastRecv     uint64
}

func NewCollector() *Collector {
	return &Collector{}
}

func IsElevated() bool {
	var token windows.Token
	err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY, &token)
	if err != nil {
		return false
	}
	defer token.Close()
	return token.IsElevated()
}

func (c *Collector) Collect() Overview {
	ov := Overview{
		Arch:        runtime.GOARCH,
		IsAdmin:     IsElevated(),
		CPUCores:    runtime.NumCPU(),
		Disks:       []DiskInfo{},
		CollectedAt: time.Now(),
	}

	if h, err := host.Info(); err == nil {
		ov.Hostname = h.Hostname
		ov.OS = h.OS
		ov.Platform = h.Platform + " " + h.PlatformVersion
		ov.Uptime = h.Uptime
	}

	if pcts, err := cpu.Percent(150*time.Millisecond, false); err == nil && len(pcts) > 0 {
		ov.CPUPercent = pcts[0]
	}

	if vm, err := mem.VirtualMemory(); err == nil {
		ov.MemTotal = vm.Total
		ov.MemUsed = vm.Used
		ov.MemPercent = vm.UsedPercent
	}

	if parts, err := disk.Partitions(false); err == nil {
		for _, p := range parts {
			u, err := disk.Usage(p.Mountpoint)
			if err != nil || u.Total == 0 {
				continue
			}
			ov.Disks = append(ov.Disks, DiskInfo{
				Mountpoint:  p.Mountpoint,
				Fstype:      p.Fstype,
				Total:       u.Total,
				Used:        u.Used,
				UsedPercent: u.UsedPercent,
			})
		}
	}

	if counters, err := gnet.IOCounters(false); err == nil && len(counters) > 0 {
		sent := counters[0].BytesSent
		recv := counters[0].BytesRecv
		ov.NetBytesSent = sent
		ov.NetBytesRecv = recv

		c.mu.Lock()
		now := time.Now()
		if !c.lastNetTime.IsZero() {
			dt := now.Sub(c.lastNetTime).Seconds()
			if dt > 0.2 {
				if sent >= c.lastSent {
					ov.NetSentRate = float64(sent-c.lastSent) / dt
				}
				if recv >= c.lastRecv {
					ov.NetRecvRate = float64(recv-c.lastRecv) / dt
				}
			}
		}
		c.lastNetTime = now
		c.lastSent = sent
		c.lastRecv = recv
		c.mu.Unlock()
	}

	return ov
}
