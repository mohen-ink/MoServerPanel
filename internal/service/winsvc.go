package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	ServiceName = "MoServerPanel"
	DisplayName = "MoServerPanel Lightweight Management Panel"
	Description = "Lightweight Windows server management panel (Firewall, Nginx Reverse Proxy, Built-in SSH/SFTP)."
)

func IsWindowsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

type RunnerFunc func(ctx context.Context) error

type winService struct {
	run RunnerFunc
}

func (ws *winService) Execute(args []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown
	status <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- ws.run(ctx)
	}()

	status <- svc.Status{State: svc.Running, Accepts: accepted}

	for {
		select {
		case err := <-errCh:
			status <- svc.Status{State: svc.StopPending}
			if err != nil && !errors.Is(err, context.Canceled) {
				return false, 1
			}
			return false, 0
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				select {
				case <-errCh:
				case <-time.After(15 * time.Second):
				}
				return false, 0
			}
		}
	}
}

func RunAsService(run RunnerFunc) error {
	return svc.Run(ServiceName, &winService{run: run})
}

func Install(port int, dataDir string) error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return err
	}

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("连接服务管理器失败（请使用管理员权限运行）: %w", err)
	}
	defer m.Disconnect()

	if s, err := m.OpenService(ServiceName); err == nil {
		s.Close()
		return fmt.Errorf("服务 %s 已存在，如需重装请先执行 service uninstall", ServiceName)
	}

	var args []string
	if port > 0 {
		args = append(args, "--port", fmt.Sprintf("%d", port))
	}
	if dataDir != "" {
		absData, err := filepath.Abs(dataDir)
		if err == nil {
			args = append(args, "--data-dir", absData)
		}
	}

	s, err := m.CreateService(ServiceName, exePath, mgr.Config{
		DisplayName: DisplayName,
		Description: Description,
		StartType:   mgr.StartAutomatic,
	}, args...)
	if err != nil {
		return fmt.Errorf("创建服务失败: %w", err)
	}
	defer s.Close()

	// Configure automatic recovery on failure
	_ = s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 15 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
	}, 86400)

	if err := s.Start(); err != nil {
		return fmt.Errorf("服务已安装但启动失败: %w", err)
	}
	return nil
}

func Uninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("连接服务管理器失败（请使用管理员权限运行）: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return fmt.Errorf("服务 %s 未安装: %w", ServiceName, err)
	}
	defer s.Close()

	_, _ = s.Control(svc.Stop)
	waitStopped(s, 10*time.Second)

	if err := s.Delete(); err != nil {
		return fmt.Errorf("删除服务失败: %w", err)
	}
	return nil
}

func Start() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("连接服务管理器失败（请使用管理员权限运行）: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return fmt.Errorf("服务 %s 未安装: %w", ServiceName, err)
	}
	defer s.Close()

	return s.Start()
}

func Stop() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("连接服务管理器失败（请使用管理员权限运行）: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return fmt.Errorf("服务 %s 未安装: %w", ServiceName, err)
	}
	defer s.Close()

	if _, err := s.Control(svc.Stop); err != nil {
		return err
	}
	waitStopped(s, 10*time.Second)
	return nil
}

func Status() (string, error) {
	m, err := mgr.Connect()
	if err != nil {
		return "unknown", err
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return "not_installed", nil
	}
	defer s.Close()

	st, err := s.Query()
	if err != nil {
		return "unknown", err
	}
	switch st.State {
	case svc.Running:
		return "running", nil
	case svc.Stopped:
		return "stopped", nil
	case svc.StartPending:
		return "starting", nil
	case svc.StopPending:
		return "stopping", nil
	default:
		return "unknown", nil
	}
}

func waitStopped(s *mgr.Service, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		st, err := s.Query()
		if err != nil || st.State == svc.Stopped {
			return
		}
		time.Sleep(300 * time.Millisecond)
	}
}
