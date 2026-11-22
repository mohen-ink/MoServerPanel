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
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Switch,
  useToast,
} from '../components/UI';

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
        name: `MoServerPanel-SSH-${status.port}`,
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
    <div>
      <PageHeader
        title="内置 SSH / SFTP 服务"
        description="纯密码登录 · 独立账号体系（不改动 Windows 系统密码）· 内置 ConPTY 交互终端、SFTP 传文件与防爆破"
        actions={
          <>
            <Button variant="secondary" icon={ShieldPlus} onClick={handleAllowPort}>
              一键放行 {status?.port || form.port} 端口
            </Button>
            <Button
              variant={status?.running ? 'danger-outline' : 'primary'}
              icon={status?.running ? Square : Play}
              loading={toggling}
              onClick={handleStartStop}
            >
              {status?.running ? '停止 SSH 服务' : '启动 SSH 服务'}
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        {/* Quick Connect Info */}
        <Card bodyClassName="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge active={!!status?.running} />
            <code className="px-3 py-1.5 rounded-md bg-surface-2 border border-line text-xs font-mono text-fg">
              {sshCmd}
            </code>
            <IconButton icon={Copy} title="复制连接命令" size="sm" onClick={copyCmd} />
          </div>
          {status?.hostFingerprint && (
            <div
              className="text-xs text-fg-3 font-mono truncate max-w-md"
              title={status.hostFingerprint}
            >
              指纹: {status.hostFingerprint}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Config Form */}
          <Card title="SSH 服务配置" icon={Terminal}>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="监听地址">
                  <Input
                    mono
                    value={form.listenAddr}
                    onChange={(e) => setForm({ ...form, listenAddr: e.target.value })}
                  />
                </Field>

                <Field label="监听端口" required>
                  <Input
                    mono
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                  />
                </Field>

                <Field label="SSH 用户名" required>
                  <Input
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                </Field>

                <Field label="默认 Shell">
                  <Select
                    value={form.defaultShell}
                    onChange={(e) => setForm({ ...form, defaultShell: e.target.value })}
                  >
                    <option value="powershell">PowerShell (推荐)</option>
                    <option value="cmd">CMD (命令提示符)</option>
                  </Select>
                </Field>

                <Field
                  label={`SSH 登录密码${
                    status?.passwordSet
                      ? '（已设置，留空则保持不变）'
                      : '（首次启动前必填，至少 6 位）'
                  }`}
                  required={!status?.passwordSet}
                  className="sm:col-span-2"
                >
                  <Input
                    type="password"
                    required={!status?.passwordSet}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={
                      status?.passwordSet
                        ? '输入新密码以修改，否则留空'
                        : '请输入至少 6 位 SSH 登录密码'
                    }
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="rounded-lg border border-line p-3">
                  <Switch
                    checked={form.enableSftp}
                    onChange={(v) => setForm({ ...form, enableSftp: v })}
                    label="启用 SFTP 文件传输"
                  />
                </div>
                <div className="rounded-lg border border-line p-3">
                  <Switch
                    checked={form.autoStart}
                    onChange={(v) => setForm({ ...form, autoStart: v })}
                    label="随面板自动启动"
                  />
                </div>
              </div>

              <div className="pt-1">
                <Button type="submit" variant="primary" icon={Save} loading={saving}>
                  {saving ? '保存中...' : '保存 SSH 配置'}
                </Button>
              </div>
            </form>
          </Card>

          {/* Active Sessions & Bans */}
          <div className="space-y-4">
            <Card
              title={`当前活跃连接 (${status?.sessions?.length || 0})`}
              extra={
                <IconButton
                  icon={RefreshCw}
                  title="刷新连接列表"
                  size="sm"
                  onClick={() => load(false)}
                />
              }
            >
              {!status?.sessions || status.sessions.length === 0 ? (
                <p className="text-[13px] text-fg-3">当前没有客户端连接。</p>
              ) : (
                <div className="space-y-2">
                  {status.sessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-2/60 border border-line"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-mono text-fg">
                            {s.username}@{s.remoteIp}
                          </span>
                          <Badge tone="brand">{s.mode}</Badge>
                        </div>
                        <div className="text-xs text-fg-3 mt-0.5">
                          连接于 {formatDate(s.startedAt)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="danger-outline"
                        icon={UserX}
                        onClick={() => handleKick(s.id)}
                      >
                        断开
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title={`SSH 防爆破临时封禁 (${bans.length})`}>
              {bans.length === 0 ? (
                <p className="text-xs text-fg-3">
                  连续 5 次密码错误将自动锁定来源 IP 15 分钟，当前无封禁记录。
                </p>
              ) : (
                <div className="space-y-2">
                  {bans.map((b) => (
                    <div
                      key={b.ip}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-2/60 border border-line text-xs"
                    >
                      <div>
                        <span className="font-mono text-danger-fg font-semibold">{b.ip}</span>
                        <span className="text-fg-3 ml-2">解封: {formatDate(b.bannedUntil)}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Unlock}
                        onClick={async () => {
                          await api.unban('ssh', b.ip);
                          showToast('success', `已解封 ${b.ip}`);
                          load(false);
                        }}
                      >
                        解封
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
