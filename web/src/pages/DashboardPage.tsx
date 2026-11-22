import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Cpu,
  Globe,
  HardDrive,
  KeyRound,
  LucideIcon,
  MemoryStick,
  RefreshCw,
  Shield,
  Terminal,
} from 'lucide-react';
import { api, DashboardData, formatBytes, formatUptime } from '../api/client';
import {
  AdminBanner,
  Badge,
  Button,
  Card,
  cn,
  Loading,
  PageHeader,
  ProgressBar,
  StatusBadge,
  useToast,
} from '../components/UI';

const MetricCard: React.FC<{
  label: string;
  icon: LucideIcon;
  value: string;
  unit?: string;
  children: React.ReactNode;
}> = ({ label, icon: Icon, value, unit, children }) => (
  <div className="bg-surface border border-line rounded-xl shadow-card p-5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-fg-2">{label}</span>
      <div className="h-8 w-8 rounded-lg bg-surface-2 border border-line grid place-items-center text-fg-2 shrink-0">
        <Icon className="w-4 h-4" />
      </div>
    </div>
    <div className="mt-3 text-[28px] leading-none font-semibold tracking-tight tabular-nums text-fg">
      {value}
      {unit && <span className="text-sm font-normal text-fg-3 ml-0.5">{unit}</span>}
    </div>
    <div className="mt-3">{children}</div>
  </div>
);

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
    return <Loading text="正在采集系统状态..." />;
  }

  if (!data) return null;

  const { system, nginx, ssh, firewall, certs } = data;

  return (
    <div>
      <PageHeader
        title="系统概览"
        description={`${system.hostname} · ${system.platform} (${system.arch}) · 已运行 ${formatUptime(system.uptime)}`}
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-3 mr-1">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              每 5 秒自动刷新
            </span>
            <Button variant="secondary" disabled={loading} onClick={() => load()}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
          </>
        }
      />

      {!system.isAdmin && (
        <div className="mb-6">
          <AdminBanner isAdmin={system.isAdmin} />
        </div>
      )}

      {/* Hardware & Network Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="CPU 使用率" icon={Cpu} value={system.cpuPercent.toFixed(1)} unit="%">
          <ProgressBar value={system.cpuPercent} />
          <p className="text-xs text-fg-3 mt-2">{system.cpuCores} 逻辑核心</p>
        </MetricCard>

        <MetricCard
          label="内存使用率"
          icon={MemoryStick}
          value={system.memPercent.toFixed(1)}
          unit="%"
        >
          <ProgressBar value={system.memPercent} />
          <p className="text-xs text-fg-3 mt-2">
            {formatBytes(system.memUsed)} / {formatBytes(system.memTotal)}
          </p>
        </MetricCard>

        <MetricCard
          label="网络上行"
          icon={ArrowUp}
          value={formatBytes(system.netSentRate)}
          unit="/s"
        >
          <div className="flex items-center gap-1.5 text-xs text-fg-3 pt-1">
            <ArrowUp className="w-3.5 h-3.5 text-success shrink-0" />
            <span>上传速率</span>
          </div>
        </MetricCard>

        <MetricCard
          label="网络下行"
          icon={ArrowDown}
          value={formatBytes(system.netRecvRate)}
          unit="/s"
        >
          <div className="flex items-center gap-1.5 text-xs text-fg-3 pt-1">
            <ArrowDown className="w-3.5 h-3.5 text-brand shrink-0" />
            <span>下载速率</span>
          </div>
        </MetricCard>
      </div>

      {/* Services & Host Info */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
        <Card
          title="服务状态"
          className="xl:col-span-2"
          bodyClassName="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <button
            type="button"
            onClick={() => onNavigate('firewall')}
            className="group text-left rounded-lg border border-line p-4 hover:border-brand/40 hover:bg-surface-2/50 transition cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand-fg grid place-items-center shrink-0">
                  <Shield className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium text-fg truncate">端口通行规则</span>
              </div>
              <StatusBadge
                active={firewall.isAdmin}
                activeText="权限正常"
                inactiveText="需管理员"
              />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <div>
                <span className="text-lg font-semibold tabular-nums text-fg">
                  {firewall.enabled}
                </span>
                <span className="text-xs text-fg-3 ml-1.5">/ {firewall.total} 条已启用</span>
              </div>
              <ChevronRight className="w-4 h-4 text-fg-3 opacity-0 group-hover:opacity-100 transition shrink-0" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('nginx')}
            className="group text-left rounded-lg border border-line p-4 hover:border-brand/40 hover:bg-surface-2/50 transition cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand-fg grid place-items-center shrink-0">
                  <Globe className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium text-fg truncate">Nginx 反向代理</span>
              </div>
              <StatusBadge active={nginx.running} />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <div>
                <span className="text-lg font-semibold tabular-nums text-fg">
                  {nginx.activeSite}
                </span>
                <span className="text-xs text-fg-3 ml-1.5">/ {nginx.siteCount} 个站点</span>
              </div>
              <ChevronRight className="w-4 h-4 text-fg-3 opacity-0 group-hover:opacity-100 transition shrink-0" />
            </div>
            <div className="text-xs text-fg-3 mt-1.5 truncate">
              {nginx.version || '内嵌 Nginx 就绪'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('certs')}
            className="group text-left rounded-lg border border-line p-4 hover:border-brand/40 hover:bg-surface-2/50 transition cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand-fg grid place-items-center shrink-0">
                  <KeyRound className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium text-fg truncate">SSL 证书</span>
              </div>
              {certs.expiringSoon > 0 ? (
                <Badge tone="warning">{certs.expiringSoon} 张即将到期</Badge>
              ) : (
                <StatusBadge
                  active={certs.total > 0}
                  activeText="状态正常"
                  inactiveText="暂无证书"
                />
              )}
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <div>
                <span className="text-lg font-semibold tabular-nums text-fg">{certs.total}</span>
                <span className="text-xs text-fg-3 ml-1.5">张证书</span>
              </div>
              <ChevronRight className="w-4 h-4 text-fg-3 opacity-0 group-hover:opacity-100 transition shrink-0" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('ssh')}
            className="group text-left rounded-lg border border-line p-4 hover:border-brand/40 hover:bg-surface-2/50 transition cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand-fg grid place-items-center shrink-0">
                  <Terminal className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium text-fg truncate">内置 SSH / SFTP</span>
              </div>
              <StatusBadge active={ssh.running} />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <div>
                <span className="text-lg font-semibold font-mono tabular-nums text-fg">
                  :{ssh.port}
                </span>
                <span className="text-xs text-fg-3 ml-1.5">{ssh.activeSessions} 个活跃连接</span>
              </div>
              <ChevronRight className="w-4 h-4 text-fg-3 opacity-0 group-hover:opacity-100 transition shrink-0" />
            </div>
          </button>
        </Card>

        <Card title="主机信息">
          <dl className="grid grid-cols-[88px_1fr] gap-y-3 text-[13px]">
            <dt className="text-fg-3">主机名</dt>
            <dd className="text-fg font-medium font-mono truncate" title={system.hostname}>
              {system.hostname}
            </dd>

            <dt className="text-fg-3">操作系统</dt>
            <dd className="text-fg font-medium truncate" title={system.platform}>
              {system.platform}
            </dd>

            <dt className="text-fg-3">系统架构</dt>
            <dd className="text-fg font-medium font-mono truncate">{system.arch}</dd>

            <dt className="text-fg-3">CPU 核心</dt>
            <dd className="text-fg font-medium tabular-nums">{system.cpuCores} 核</dd>

            <dt className="text-fg-3">运行时长</dt>
            <dd className="text-fg font-medium truncate">{formatUptime(system.uptime)}</dd>

            <dt className="text-fg-3">Windows 服务</dt>
            <dd className="text-fg font-medium font-mono truncate">{data.serviceStatus}</dd>

            <dt className="text-fg-3">管理员权限</dt>
            <dd>
              {system.isAdmin ? (
                <Badge tone="success">是</Badge>
              ) : (
                <Badge tone="warning">否</Badge>
              )}
            </dd>
          </dl>
        </Card>
      </div>

      {/* Disks */}
      <Card
        title="磁盘空间"
        icon={HardDrive}
        className="mt-4"
        bodyClassName="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
      >
        {system.disks.map((d) => (
          <div key={d.mountpoint} className="rounded-lg border border-line p-4">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-sm text-fg truncate">{d.mountpoint}</span>
                <Badge tone="neutral">{d.fstype}</Badge>
              </div>
              <span className="text-xs font-medium text-fg-2 tabular-nums">
                {d.usedPercent.toFixed(1)}%
              </span>
            </div>
            <ProgressBar value={d.usedPercent} size="sm" />
            <div className="text-xs text-fg-3 mt-2">
              已用 {formatBytes(d.used)} / 共 {formatBytes(d.total)}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
};
