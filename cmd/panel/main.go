package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"win-server-panel/internal/acme"
	"win-server-panel/internal/api"
	"win-server-panel/internal/auth"
	"win-server-panel/internal/config"
	"win-server-panel/internal/firewall"
	"win-server-panel/internal/netproxy"
	"win-server-panel/internal/nginx"
	"win-server-panel/internal/service"
	"win-server-panel/internal/sshserver"
	"win-server-panel/internal/sysinfo"
	"win-server-panel/internal/updater"
)

var Version = "0.1.0-dev"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version", "-v", "--version":
			fmt.Printf("MoServerPanel v%s\n", Version)
			return
		case "service":
			handleServiceCmd(os.Args[2:])
			return
		case "reset-password":
			handleResetPasswordCmd(os.Args[2:])
			return
		case "update":
			handleUpdateCmd(os.Args[2:])
			return
		case "help", "-h", "--help":
			printUsage()
			return
		}
	}

	fs := flag.NewFlagSet("run", flag.ExitOnError)
	portFlag := fs.Int("port", 0, "Override panel listen port")
	addrFlag := fs.String("addr", "", "Override panel listen address")
	dataDirFlag := fs.String("data-dir", "", `Data directory path (default: %ProgramData%\MoServerPanel)`)
	_ = fs.Parse(os.Args[1:])

	dataDir := resolveDataDir(*dataDirFlag)

	runFn := func(ctx context.Context) error {
		return runPanel(ctx, dataDir, *addrFlag, *portFlag)
	}

	if service.IsWindowsService() {
		if err := service.RunAsService(runFn); err != nil {
			log.Fatalf("service run failed: %v", err)
		}
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := runFn(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("panel exited with error: %v", err)
	}
}

func runPanel(ctx context.Context, dataDir, addrOverride string, portOverride int) error {
	updater.CleanupOldBinary()

	runCtx, cancelRun := context.WithCancel(ctx)
	defer cancelRun()

	store, err := config.NewStore(dataDir)
	if err != nil {
		return fmt.Errorf("init store: %w", err)
	}

	limiter := auth.NewRateLimiter(5, 5*time.Minute, 15*time.Minute)
	authMgr := auth.NewManager(store, limiter)
	sysCollector := sysinfo.NewCollector()
	fwMgr := firewall.NewManager(store)
	nginxMgr := nginx.NewManager(store)
	acmeMgr := acme.NewManager(store, nginxMgr)
	sshMgr := sshserver.NewManager(store, limiter)
	updaterMgr := updater.NewManager(Version, cancelRun)
	updaterMgr.SetProxyProvider(func() config.ProxyConfig {
		return store.GetConfig().Proxy
	})

	// Extract embedded Nginx right away so status & version are immediately ready
	if err := nginxMgr.EnsureReady(); err != nil {
		log.Printf("[nginx] warning: failed to prepare embedded nginx: %v", err)
	}

	cfg := store.GetConfig()

	// Auto-start managed services if configured
	if cfg.Nginx.AutoStart && len(store.ListProxies()) > 0 {
		if err := nginxMgr.Start(); err != nil {
			log.Printf("[nginx] auto-start failed: %v", err)
		} else {
			log.Printf("[nginx] auto-started successfully")
		}
	}

	if cfg.SSH.AutoStart && cfg.SSH.PasswordHash != "" {
		if err := sshMgr.Start(); err != nil {
			log.Printf("[ssh] auto-start failed: %v", err)
		} else {
			log.Printf("[ssh] auto-started on %s:%d", cfg.SSH.ListenAddr, cfg.SSH.Port)
		}
	}

	acmeMgr.StartRenewalLoop(runCtx)

	listenAddr := cfg.ListenAddr
	if addrOverride != "" {
		listenAddr = addrOverride
	}
	port := cfg.Port
	if portOverride > 0 {
		port = portOverride
	}

	srv := api.NewServer(Version, store, authMgr, sysCollector, fwMgr, nginxMgr, acmeMgr, sshMgr, updaterMgr)
	httpSrv := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", listenAddr, port),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("[panel] MoServerPanel v%s listening on http://%s (dataDir=%s, admin=%v)",
			Version, httpSrv.Addr, dataDir, sysinfo.IsElevated())
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-runCtx.Done():
		log.Printf("[panel] shutting down gracefully...")
		sshMgr.Shutdown()
		_ = nginxMgr.Stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
		return context.Canceled
	}
}

func handleServiceCmd(args []string) {
	if len(args) == 0 {
		fmt.Println("Usage: mo-server-panel.exe service <install|uninstall|start|stop|status> [--port 8900] [--data-dir path]")
		os.Exit(1)
	}
	action := args[0]
	fs := flag.NewFlagSet("service", flag.ExitOnError)
	port := fs.Int("port", 0, "Panel listen port")
	dataDir := fs.String("data-dir", "", "Data directory path")
	_ = fs.Parse(args[1:])

	var err error
	switch action {
	case "install":
		err = service.Install(*port, resolveDataDir(*dataDir))
		if err == nil {
			fmt.Println("MoServerPanel Windows 服务安装并启动成功！")
		}
	case "uninstall":
		err = service.Uninstall()
		if err == nil {
			fmt.Println("MoServerPanel Windows 服务已卸载。")
		}
	case "start":
		err = service.Start()
		if err == nil {
			fmt.Println("MoServerPanel 服务已启动。")
		}
	case "stop":
		err = service.Stop()
		if err == nil {
			fmt.Println("MoServerPanel 服务已停止。")
		}
	case "status":
		st, stErr := service.Status()
		if stErr != nil {
			err = stErr
		} else {
			fmt.Printf("MoServerPanel 服务状态: %s\n", st)
		}
	default:
		fmt.Printf("未知 service 子命令: %s\n", action)
		os.Exit(1)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "错误: %v\n", err)
		os.Exit(1)
	}
}

func handleResetPasswordCmd(args []string) {
	fs := flag.NewFlagSet("reset-password", flag.ExitOnError)
	username := fs.String("username", "", "Optional new username (keeps current if empty)")
	password := fs.String("password", "", "New admin password (min 8 chars)")
	dataDir := fs.String("data-dir", "", "Data directory path")
	_ = fs.Parse(args)

	if *password == "" {
		fmt.Fprintln(os.Stderr, "错误: 请通过 --password 指定新密码（至少 8 位）")
		os.Exit(1)
	}
	store, err := config.NewStore(resolveDataDir(*dataDir))
	if err != nil {
		fmt.Fprintf(os.Stderr, "错误: %v\n", err)
		os.Exit(1)
	}
	authMgr := auth.NewManager(store, auth.NewRateLimiter(5, 5*time.Minute, 15*time.Minute))
	if err := authMgr.ResetPassword(*username, *password); err != nil {
		fmt.Fprintf(os.Stderr, "错误: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("管理员密码已重置成功！")
}

func handleUpdateCmd(args []string) {
	fs := flag.NewFlagSet("update", flag.ExitOnError)
	checkOnly := fs.Bool("check", false, "Only check for updates without downloading")
	proxyFlag := fs.String("proxy", "", "Optional proxy URL (e.g. http://127.0.0.1:7897 or socks5://127.0.0.1:7897)")
	dataDirFlag := fs.String("data-dir", "", "Data directory path")
	_ = fs.Parse(args)

	mgr := updater.NewManager(Version, nil)
	if *proxyFlag != "" {
		validated, err := netproxy.Validate(config.ProxyConfig{Mode: "custom", URL: *proxyFlag})
		if err != nil {
			fmt.Fprintf(os.Stderr, "代理参数错误: %v\n", err)
			os.Exit(1)
		}
		mgr.SetProxyProvider(func() config.ProxyConfig { return validated })
	} else if st, err := config.NewStore(resolveDataDir(*dataDirFlag)); err == nil {
		proxyCfg := st.GetConfig().Proxy
		mgr.SetProxyProvider(func() config.ProxyConfig { return proxyCfg })
	}
	ctx := context.Background()

	fmt.Printf("当前版本: v%s，正在检查 GitHub 最新版本...\n", Version)
	rel, err := mgr.Check(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "检查更新失败: %v\n", err)
		os.Exit(1)
	}

	if !rel.HasUpdate {
		fmt.Printf("当前已是最新版本 (v%s)。\n", rel.CurrentVersion)
		return
	}

	fmt.Printf("发现新版本: v%s -> v%s\n发布页面: %s\n", rel.CurrentVersion, rel.LatestVersion, rel.ReleaseURL)
	if *checkOnly {
		return
	}

	lastPct := -1
	err = mgr.ApplyCLI(ctx, rel, func(downloaded, total int64) {
		if total > 0 {
			pct := int((downloaded * 100) / total)
			if pct >= lastPct+10 || pct == 100 {
				lastPct = pct
				fmt.Printf("\r正在下载 %s ... %d%% (%.2f / %.2f MB)",
					rel.AssetName, pct, float64(downloaded)/(1024*1024), float64(total)/(1024*1024))
			}
		}
	})
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "更新失败: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("已成功更新至 v%s（SHA256 校验通过）！\n", rel.LatestVersion)
	if st, stErr := service.Status(); stErr == nil && st == "running" {
		fmt.Println("检测到 MoServerPanel Windows 服务正在运行，正在重启服务...")
		_ = service.Stop()
		if err := service.Start(); err != nil {
			fmt.Fprintf(os.Stderr, "重启服务失败，请手动执行 mo-server-panel.exe service start: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("MoServerPanel 服务已重启并运行新版本！")
	} else {
		fmt.Println("重新运行 mo-server-panel.exe 即可生效。")
	}
}

func resolveDataDir(flagVal string) string {
	if flagVal != "" {
		return flagVal
	}
	if env := os.Getenv("MSP_DATA_DIR"); env != "" {
		return env
	}
	if programData := os.Getenv("ProgramData"); programData != "" {
		return filepath.Join(programData, "MoServerPanel")
	}
	return `C:\ProgramData\MoServerPanel`
}

func printUsage() {
	fmt.Printf(`MoServerPanel v%s - 轻量级 Windows 服务器管理面板

用法:
  mo-server-panel.exe [--port 8900] [--addr 0.0.0.0] [--data-dir C:\ProgramData\MoServerPanel]
  mo-server-panel.exe service <install|uninstall|start|stop|status> [--port 8900] [--data-dir C:\ProgramData\MoServerPanel]
  mo-server-panel.exe reset-password --password <newpass> [--username admin] [--data-dir C:\ProgramData\MoServerPanel]
  mo-server-panel.exe update [--check]
  mo-server-panel.exe version
`, Version)
}
