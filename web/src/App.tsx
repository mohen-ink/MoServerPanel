import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  Globe,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Server,
  Settings,
  Shield,
  Sun,
  Terminal,
  TerminalSquare,
  X,
} from 'lucide-react';
import { api, AuthStatus } from './api/client';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { FirewallPage } from './pages/FirewallPage';
import { NginxPage } from './pages/NginxPage';
import { CertsPage } from './pages/CertsPage';
import { SshPage } from './pages/SshPage';
import { TerminalPage } from './pages/TerminalPage';
import { SettingsPage } from './pages/SettingsPage';
import { cn, IconButton } from './components/UI';
import { ThemeMode, useTheme } from './components/theme';

const navGroups = [
  {
    title: '概览',
    items: [{ key: 'dashboard', label: '系统概览', icon: LayoutDashboard }],
  },
  {
    title: '网络与安全',
    items: [
      { key: 'firewall', label: '端口通行', icon: Shield },
      { key: 'nginx', label: 'Nginx 反代', icon: Globe },
      { key: 'certs', label: 'SSL 证书', icon: KeyRound },
    ],
  },
  {
    title: '远程运维',
    items: [
      { key: 'ssh', label: 'SSH 服务', icon: Terminal },
      { key: 'terminal', label: '网页终端', icon: TerminalSquare },
    ],
  },
  {
    title: '系统',
    items: [{ key: 'settings', label: '面板设置', icon: Settings }],
  },
];

const allNavItems = navGroups.flatMap((g) => g.items);

const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_META: Record<ThemeMode, { icon: typeof Sun; title: string }> = {
  light: { icon: Sun, title: '浅色模式' },
  dark: { icon: Moon, title: '深色模式' },
  system: { icon: Monitor, title: '跟随系统' },
};

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [tab, setTab] = useState('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { mode, setMode } = useTheme();

  const checkAuth = async () => {
    try {
      const st = await api.authStatus();
      setAuth(st);
    } catch {
      setAuth({ initialized: true, authenticated: false, username: '', version: '' });
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  if (!auth) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-canvas text-fg">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-brand to-[#6366f1] text-white grid place-items-center shadow-sm">
          <Server className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-2 text-[13px] text-fg-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>正在连接 WinServerPanel...</span>
        </div>
      </div>
    );
  }

  if (!auth.initialized) {
    return (
      <SetupPage
        onDone={(username) =>
          setAuth({ ...auth, initialized: true, authenticated: true, username })
        }
      />
    );
  }

  if (!auth.authenticated) {
    return (
      <LoginPage
        onSuccess={(username) => setAuth({ ...auth, authenticated: true, username })}
      />
    );
  }

  const handleLogout = async () => {
    await api.logout();
    setAuth({ ...auth, authenticated: false });
  };

  const currentItem = allNavItems.find((i) => i.key === tab) || allNavItems[0];
  const themeMeta = THEME_META[mode];
  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(mode);
    setMode(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  const selectTab = (key: string) => {
    setTab(key);
    setMobileNavOpen(false);
  };

  const renderSidebarContent = (isMobile = false) => (
    <>
      <div className="h-14 px-4 flex items-center justify-between gap-2 border-b border-line shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand to-[#6366f1] text-white grid place-items-center shadow-sm shrink-0">
            <Server className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-fg truncate">
              WinServerPanel
            </div>
            <div className="text-[11px] text-fg-3 leading-none mt-0.5">
              v{auth.version || '0.1.0'}
            </div>
          </div>
        </div>
        {isMobile && (
          <IconButton
            icon={X}
            title="关闭导航菜单"
            size="sm"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {navGroups.map((group, groupIdx) => (
          <div key={group.title}>
            <div
              className={cn(
                'px-3 pb-1.5 text-[11px] font-medium text-fg-3',
                groupIdx === 0 ? 'pt-1' : 'pt-4'
              )}
            >
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectTab(item.key)}
                    className={cn(
                      'w-full h-9 px-3 rounded-md flex items-center gap-2.5 text-[13px] transition-colors cursor-pointer',
                      active
                        ? 'bg-brand-soft text-brand-fg font-medium'
                        : 'text-fg-2 hover:bg-surface-2 hover:text-fg'
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-line shrink-0">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-surface-2/60 border border-line">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-full bg-brand-soft text-brand-fg text-xs font-semibold grid place-items-center shrink-0">
              {(auth.username || 'A').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-fg truncate">{auth.username}</div>
              <div className="text-[11px] text-fg-3 leading-none mt-0.5">管理员</div>
            </div>
          </div>
          <IconButton icon={LogOut} tone="danger" title="退出登录" onClick={handleLogout} />
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-fg">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-[232px] shrink-0 bg-surface border-r border-line flex-col">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 bg-black/45 dark:bg-black/60 backdrop-blur-[2px] animate-overlay"
          />
          <aside className="relative z-10 w-[232px] h-full bg-surface border-r border-line flex flex-col shadow-2xl">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 flex items-center justify-between px-4 lg:px-8 border-b border-line bg-surface/80 backdrop-blur">
          <div className="flex items-center gap-2 text-[13px] min-w-0">
            <IconButton
              icon={Menu}
              title="打开导航菜单"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden mr-1"
            />
            <span className="text-fg-3 hidden sm:inline">WinServerPanel</span>
            <ChevronRight className="w-3.5 h-3.5 text-fg-3 hidden sm:inline shrink-0" />
            <span className="text-fg font-medium truncate">{currentItem.label}</span>
          </div>

          <div className="flex items-center gap-1">
            <IconButton
              icon={themeMeta.icon}
              title={themeMeta.title}
              onClick={cycleTheme}
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div key={tab} className="animate-page mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8">
            {tab === 'dashboard' && <DashboardPage onNavigate={setTab} />}
            {tab === 'firewall' && <FirewallPage />}
            {tab === 'nginx' && <NginxPage />}
            {tab === 'certs' && <CertsPage />}
            {tab === 'ssh' && <SshPage />}
            {tab === 'terminal' && <TerminalPage />}
            {tab === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
    </div>
  );
}
