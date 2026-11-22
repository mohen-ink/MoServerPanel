import React, { useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  Globe,
  HardDrive,
  KeyRound,
  MemoryStick,
  RefreshCw,
  Shield,
  Terminal,
} from 'lucide-react';
import { api, DashboardData, formatBytes, formatUptime } from '../api/client';
import { AdminBanner, StatusBadge, useToast } from '../components/UI';

export const DashboardPage: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.dashboard();
      setData(res);
    } catch (err: any) {
      if (!silent) showToast('error', err.message || '加载概览失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 5000);
    return () => clearInterval(timer);
  }, []);

  if (loading && !data) {
    return <div className="text-slate-400 text-sm py-12 text-center">正在采集系统状态...</div>;
  }

  if (!data) return null;

  const { system, nginx, ssh, firewall, certs } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">系统概览</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {system.hostname} · {system.platform} ({system.arch}) · 已运行 {formatUptime(system.uptime)}
          </p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          刷新
        </button>
      </div>

      <AdminBanner isAdmin={system.isAdmin} />

      {/* Core Service Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigate('firewall')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 transition cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400">
              <Shield className="w-5 h-5" />
            </div>
            <StatusBadge active={firewall.isAdmin} activeText="权限正常" inactiveText="需管理员" />
          </div>
          <div className="text-sm text-slate-400">端口通行规则</div>
          <div className="text-2xl font-bold text-white mt-1">
            {firewall.enabled} <span className="text-sm font-normal text-slate-500">/ {firewall.total} 条已启用</span>
          </div>
        </div>

        <div
          onClick={() => onNavigate('nginx')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 transition cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400">
              <Globe className="w-5 h-5" />
            </div>
            <StatusBadge active={nginx.running} />
          </div>
          <div className="text-sm text-slate-400">Nginx 反向代理</div>
          <div className="text-2xl font-bold text-white mt-1">
            {nginx.activeSite} <span className="text-sm font-normal text-slate-500">/ {nginx.siteCount} 个站点</span>
          </div>
          <div className="text-xs text-slate-500 mt-1 truncate">{nginx.version || '内嵌 Nginx 就绪'}</div>
        </div>

        <div
          onClick={() => onNavigate('certs')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 transition cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-xl bg-violet-500/15 text-violet-400">
              <KeyRound className="w-5 h-5" />
            </div>
            {certs.expiringSoon > 0 ? (
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30">
                {certs.expiringSoon} 张即将到期
              </span>
            ) : (
              <StatusBadge active={certs.total > 0} activeText="状态正常" inactiveText="暂无证书" />
            )}
          </div>
          <div className="text-sm text-slate-400">SSL 证书</div>
          <div className="text-2xl font-bold text-white mt-1">
            {certs.total} <span className="text-sm font-normal text-slate-500">张证书</span>
          </div>
        </div>

        <div
          onClick={() => onNavigate('ssh')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 transition cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400">
              <Terminal className="w-5 h-5" />
            </div>
            <StatusBadge active={ssh.running} />
          </div>
          <div className="text-sm text-slate-400">内置 SSH / SFTP</div>
          <div className="text-2xl font-bold text-white mt-1">
            :{ssh.port}{' '}
            <span className="text-sm font-normal text-slate-500">{ssh.activeSessions} 个活跃连接</span>
          </div>
        </div>
      </div>

      {/* Hardware Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Cpu className="w-4 h-4 text-indigo-400" /> CPU 使用率
            </span>
            <span className="text-lg font-bold text-white">{system.cpuPercent.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, system.cpuPercent)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">{system.cpuCores} 逻辑核心</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <MemoryStick className="w-4 h-4 text-emerald-400" /> 内存使用率
            </span>
            <span className="text-lg font-bold text-white">{system.memPercent.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, system.memPercent)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {formatBytes(system.memUsed)} / {formatBytes(system.memTotal)}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Activity className="w-4 h-4 text-sky-400" /> 网络实时流量
            </span>
            <span className="text-xs text-slate-400">Windows 服务: {data.serviceStatus}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-xs text-slate-500">上传速率</div>
              <div className="text-sm font-semibold text-sky-300 mt-0.5">
                {formatBytes(system.netSentRate)}/s
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-xs text-slate-500">下载速率</div>
              <div className="text-sm font-semibold text-emerald-300 mt-0.5">
                {formatBytes(system.netRecvRate)}/s
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Disks */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white mb-4">
          <HardDrive className="w-4 h-4 text-slate-400" /> 磁盘空间
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {system.disks.map((d) => (
            <div key={d.mountpoint} className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-semibold text-slate-200">
                  {d.mountpoint} <span className="text-xs font-normal text-slate-500">({d.fstype})</span>
                </span>
                <span className="text-slate-300">{d.usedPercent.toFixed(1)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    d.usedPercent > 85 ? 'bg-rose-500' : d.usedPercent > 70 ? 'bg-amber-500' : 'bg-sky-500'
                  }`}
                  style={{ width: `${Math.min(100, d.usedPercent)}%` }}
                />
              </div>
              <div className="text-xs text-slate-500 mt-2">
                已用 {formatBytes(d.used)} / 共 {formatBytes(d.total)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
