import React, { useEffect, useState } from 'react';
import {
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Server,
  Settings,
  Shield,
  Terminal,
  TerminalSquare,
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

const navItems = [
  { key: 'dashboard', label: '系统概览', icon: LayoutDashboard },
  { key: 'firewall', label: '端口通行', icon: Shield },
  { key: 'nginx', label: 'Nginx 反代', icon: Globe },
  { key: 'certs', label: 'SSL 证书', icon: KeyRound },
  { key: 'ssh', label: 'SSH 服务', icon: Terminal },
  { key: 'terminal', label: '网页终端', icon: TerminalSquare },
  { key: 'settings', label: '面板设置', icon: Settings },
];

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [tab, setTab] = useState('dashboard');

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
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm">
        正在连接 WinServerPanel...
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-slate-900/90 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
            <Server className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-white text-sm truncate">WinServerPanel</div>
            <div className="text-[11px] text-slate-500">v{auth.version || '0.1.0'}</div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm transition cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white font-medium shadow-md shadow-indigo-950/50'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800">
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/70">
            <div className="text-xs text-slate-300 truncate">{auth.username}</div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 p-6 md:p-8 overflow-y-auto">
        {tab === 'dashboard' && <DashboardPage onNavigate={setTab} />}
        {tab === 'firewall' && <FirewallPage />}
        {tab === 'nginx' && <NginxPage />}
        {tab === 'certs' && <CertsPage />}
        {tab === 'ssh' && <SshPage />}
        {tab === 'terminal' && <TerminalPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
