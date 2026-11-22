import React, { useEffect, useState } from 'react';
import {
  Copy,
  Play,
  RefreshCw,
  Save,
  ShieldPlus,
  Square,
  Terminal,
  Unlock,
  UserX,
} from 'lucide-react';
import { api, BanEntry, formatDate, SSHStatus } from '../api/client';
import { StatusBadge, useToast } from '../components/UI';

export const SshPage: React.FC = () => {
  const { showToast } = useToast();
  const [status, setStatus] = useState<SSHStatus | null>(null);
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const [form, setForm] = useState({
    autoStart: false,
    listenAddr: '0.0.0.0',
    port: 2222,
    username: 'admin',
    password: '',
    defaultShell: 'powershell',
    enableSftp: true,
  });

  const load = async (syncForm = false) => {
    try {
      const [st, banRes] = await Promise.all([api.sshStatus(), api.listBans('ssh')]);
      setStatus(st);
      setBans(banRes.items || []);
      if (syncForm) {
        setForm({
          autoStart: st.autoStart,
          listenAddr: st.listenAddr || '0.0.0.0',
          port: st.port || 2222,
          username: st.username || 'admin',
          password: '',
          defaultShell: st.defaultShell || 'powershell',
          enableSftp: st.enableSftp,
        });
      }
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), 5000);
    return () => clearInterval(timer);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.sshUpdateConfig({
        ...form,
        port: Number(form.port),
      });
      setStatus(res);
      setForm((prev) => ({ ...prev, password: '' }));
      showToast('success', 'SSH 配置已保存');
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStartStop = async () => {
    if (!status) return;
    setToggling(true);
    try {
      const res = status.running ? await api.sshStop() : await api.sshStart();
      setStatus(res);
      showToast('success', res.running ? `SSH 服务已在端口 ${res.port} 启动` : 'SSH 服务已停止');
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setToggling(false);
    }
  };

  const handleKick = async (id: string) => {
    try {
      await api.sshKickSession(id);
      showToast('success', '已断开该 SSH 会话');
      load(false);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleAllowPort = async () => {
    if (!status) return;
    try {
      await api.createFirewallRule({
        name: `WinServerPanel-SSH-${status.port}`,
        protocol: 'TCP',
        port: String(status.port),
        action: 'Allow',
        remoteAddress: 'Any',
        enabled: true,
        remark: '放行面板内置 SSH/SFTP 服务端口',
      });
      showToast('success', `已放行防火墙 TCP ${status.port} 端口`);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const sshCmd = `ssh ${status?.username || form.username}@${window.location.hostname} -p ${status?.port || form.port}`;

  const copyCmd = () => {
    navigator.clipboard.writeText(sshCmd);
    showToast('info', '已复制 SSH 连接命令');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">内置 SSH / SFTP 服务</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            纯密码登录 · 独立账号体系（不改动 Windows 系统密码）· 内置 ConPTY 交互终端、SFTP 传文件与防爆破
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAllowPort}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs transition cursor-pointer"
          >
            <ShieldPlus className="w-4 h-4" /> 一键放行 {status?.port || form.port} 端口
          </button>
          <button
            disabled={toggling}
            onClick={handleStartStop}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition cursor-pointer ${
              status?.running
                ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {status?.running ? (
              <>
                <Square className="w-4 h-4" /> 停止 SSH 服务
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> 启动 SSH 服务
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quick Connect Info */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <StatusBadge active={!!status?.running} />
          <code className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-emerald-300 font-mono">
            {sshCmd}
          </code>
          <button
            onClick={copyCmd}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
            title="复制连接命令"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        {status?.hostFingerprint && (
          <div className="text-xs text-slate-500 font-mono truncate max-w-md" title={status.hostFingerprint}>
            指纹: {status.hostFingerprint}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config Form */}
        <form onSubmit={handleSave} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Terminal className="w-4 h-4 text-amber-400" /> SSH 服务配置
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">监听地址</label>
              <input
                value={form.listenAddr}
                onChange={(e) => setForm({ ...form, listenAddr: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">监听端口 *</label>
              <input
                type="number"
                required
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">SSH 用户名 *</label>
              <input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">默认 Shell</label>
              <select
                value={form.defaultShell}
                onChange={(e) => setForm({ ...form, defaultShell: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              >
                <option value="powershell">PowerShell (推荐)</option>
                <option value="cmd">CMD (命令提示符)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">
                SSH 登录密码 {status?.passwordSet ? '（已设置，留空则保持不变）' : '（首次启动前必填，至少 6 位）*'}
              </label>
              <input
                type="password"
                required={!status?.passwordSet}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={status?.passwordSet ? '输入新密码以修改，否则留空' : '请输入至少 6 位 SSH 登录密码'}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-5 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enableSftp}
                onChange={(e) => setForm({ ...form, enableSftp: e.target.checked })}
              />
              启用 SFTP 文件传输
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoStart}
                onChange={(e) => setForm({ ...form, autoStart: e.target.checked })}
              />
              随面板自动启动
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition cursor-pointer"
          >
            <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存 SSH 配置'}
          </button>
        </form>

        {/* Active Sessions & Bans */}
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                当前活跃连接 ({status?.sessions?.length || 0})
              </h3>
              <button
                onClick={() => load(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            {!status?.sessions || status.sessions.length === 0 ? (
              <p className="text-sm text-slate-500">当前没有客户端连接。</p>
            ) : (
              <div className="space-y-2">
                {status.sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800"
                  >
                    <div>
                      <div className="text-sm font-mono text-white">
                        {s.username}@{s.remoteIp}{' '}
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[11px]">
                          {s.mode}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">连接于 {formatDate(s.startedAt)}</div>
                    </div>
                    <button
                      onClick={() => handleKick(s.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs cursor-pointer"
                    >
                      <UserX className="w-3.5 h-3.5" /> 断开
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
            <h3 className="text-sm font-semibold text-white mb-3">SSH 防爆破临时封禁 ({bans.length})</h3>
            {bans.length === 0 ? (
              <p className="text-xs text-slate-500">连续 5 次密码错误将自动锁定来源 IP 15 分钟，当前无封禁记录。</p>
            ) : (
              <div className="space-y-2">
                {bans.map((b) => (
                  <div
                    key={b.ip}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
                  >
                    <div>
                      <span className="font-mono text-rose-300 font-semibold">{b.ip}</span>
                      <span className="text-slate-500 ml-2">解封: {formatDate(b.bannedUntil)}</span>
                    </div>
                    <button
                      onClick={async () => {
                        await api.unban('ssh', b.ip);
                        showToast('success', `已解封 ${b.ip}`);
                        load(false);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      <Unlock className="w-3 h-3" /> 解封
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
