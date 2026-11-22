import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Key,
  RefreshCw,
  Save,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import {
  api,
  BanEntry,
  formatBytes,
  formatDate,
  SettingsData,
  UpdateCheckResult,
  UpdateStatus,
} from '../api/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  ProgressBar,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useConfirm,
  useToast,
} from '../components/UI';

export const SettingsPage: React.FC = () => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [listenAddr, setListenAddr] = useState('0.0.0.0');
  const [port, setPort] = useState(8900);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const startReconnectWatch = (targetVersion?: string) => {
    stopPolling();
    setReconnecting(true);
    let attempts = 0;
    pollTimerRef.current = window.setInterval(async () => {
      attempts += 1;
      if (attempts > 40) {
        stopPolling();
        setReconnecting(false);
        showToast('info', '等待服务重连超时，请手动刷新页面确认版本');
        return;
      }
      try {
        const res = await api.authStatus();
        if (res) {
          stopPolling();
          setReconnecting(false);
          showToast(
            'success',
            targetVersion ? `面板已重启并更新至 v${targetVersion}` : '面板服务已恢复连接'
          );
          window.setTimeout(() => window.location.reload(), 800);
        }
      } catch {
        // Server is still restarting; keep waiting
      }
    }, 1500);
  };

  const startStatusPolling = () => {
    stopPolling();
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const st = await api.updateStatus();
        setUpdateStatus(st);
        if (st.state === 'restarting') {
          startReconnectWatch(st.targetVersion);
        } else if (st.state === 'done') {
          stopPolling();
          showToast('success', st.message || '已是最新版本');
        } else if (st.state === 'error') {
          stopPolling();
          showToast('error', st.error || '更新失败');
        }
      } catch {
        // Connection dropped right after binary swap / restart
        startReconnectWatch(updateCheck?.latestVersion);
      }
    }, 600);
  };

  const load = async () => {
    try {
      const [s, b, u] = await Promise.all([
        api.getSettings(),
        api.listBans(),
        api.updateStatus().catch(() => null),
      ]);
      setSettings(s);
      setListenAddr(s.listenAddr);
      setPort(s.port);
      setBans(b.items || []);
      if (u && u.state !== 'idle') {
        setUpdateStatus(u);
        if (['downloading', 'verifying', 'replacing'].includes(u.state)) {
          startStatusPolling();
        } else if (u.state === 'restarting') {
          startReconnectWatch(u.targetVersion);
        }
      }
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  useEffect(() => {
    load();
    return () => stopPolling();
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const res = await api.updateCheck();
      setUpdateCheck(res);
      if (res.hasUpdate) {
        showToast('info', `发现新版本 v${res.latestVersion}`);
      } else {
        showToast('success', `当前已是最新版本 v${res.currentVersion}`);
      }
    } catch (err: any) {
      showToast('error', err.message || '检查更新失败');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!updateCheck?.hasUpdate) return;
    const ok = await confirm({
      title: `更新至 v${updateCheck.latestVersion}`,
      description: `将从 GitHub Releases 下载 ${updateCheck.assetName}（${formatBytes(
        updateCheck.assetSize
      )}），自动校验 SHA256、替换可执行文件并重启面板服务。期间页面连接会短暂中断几秒，确认继续？`,
      confirmText: '立即更新并重启',
    });
    if (!ok) return;

    try {
      const st = await api.updateApply();
      setUpdateStatus(st);
      startStatusPolling();
    } catch (err: any) {
      showToast('error', err.message || '启动更新失败');
    }
  };

  const isUpdating =
    reconnecting ||
    (!!updateStatus &&
      ['downloading', 'verifying', 'replacing', 'restarting'].includes(updateStatus.state));

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.updateSettings(listenAddr, Number(port));
      showToast('success', res.message || '保存成功');
      load();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      showToast('error', '新密码长度至少为 8 位');
      return;
    }
    try {
      await api.changePassword(oldPassword, newPassword);
      showToast('success', '管理员密码修改成功');
      setOldPassword('');
      setNewPassword('');
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleUnban = async (ns: string, ip: string) => {
    try {
      await api.unban(ns, ip);
      showToast('success', `已解封 ${ip}`);
      load();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="面板设置"
        description="管理面板监听参数、管理员密码与安全封禁列表"
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Panel Network Settings */}
          <Card title="面板监听与运行信息" icon={ServerCog}>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <Field label="监听地址">
                <Input
                  mono
                  value={listenAddr}
                  onChange={(e) => setListenAddr(e.target.value)}
                />
              </Field>

              <Field label="监听端口">
                <Input
                  mono
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </Field>

              {settings && (
                <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-xs pt-3 border-t border-line">
                  <dt className="text-fg-3">版本</dt>
                  <dd className="text-fg font-mono">v{settings.version}</dd>

                  <dt className="text-fg-3">数据目录</dt>
                  <dd className="text-fg font-mono truncate" title={settings.dataDir}>
                    {settings.dataDir}
                  </dd>

                  <dt className="text-fg-3">管理员权限</dt>
                  <dd className="text-fg">
                    {settings.isAdmin ? '是 (Elevated)' : '否 (普通权限)'}
                  </dd>

                  <dt className="text-fg-3">Windows 服务状态</dt>
                  <dd className="text-fg font-mono">{settings.serviceStatus}</dd>
                </dl>
              )}

              <div className="pt-1">
                <Button type="submit" variant="primary" icon={Save} loading={saving}>
                  保存监听设置
                </Button>
              </div>
            </form>
          </Card>

          {/* Change Admin Password */}
          <Card title="修改管理员密码" icon={Key}>
            <form onSubmit={handleChangePwd} className="space-y-4">
              <Field label="当前密码">
                <Input
                  type="password"
                  required
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                />
              </Field>

              <Field label="新密码（至少 8 位）">
                <Input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>

              <div className="pt-1">
                <Button type="submit" variant="primary" icon={Key}>
                  更新密码
                </Button>
              </div>

              <div className="text-xs text-fg-3 pt-1">
                如忘记密码，可在服务器本地运行：
                <code className="block mt-1.5 px-2.5 py-1.5 rounded-md bg-surface-2 border border-line text-fg font-mono">
                  mo-server-panel.exe reset-password --password 新密码
                </code>
              </div>
            </form>
          </Card>
        </div>

        {/* GitHub Self-Update */}
        <Card
          title="软件更新（GitHub Releases）"
          icon={ArrowUpCircle}
          extra={
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/mohen-ink/MoServerPanel/releases"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg transition-colors px-2 py-1"
              >
                GitHub Releases
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <Button
                size="sm"
                variant="secondary"
                icon={RefreshCw}
                loading={checkingUpdate}
                disabled={isUpdating}
                onClick={handleCheckUpdate}
              >
                检查更新
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <span className="text-fg-3">当前版本</span>
                <Badge tone="neutral" className="font-mono">
                  v{settings?.version || updateCheck?.currentVersion || '0.1.0'}
                </Badge>
                {updateCheck && !updateCheck.hasUpdate && (
                  <Badge tone="success">已是最新版本</Badge>
                )}
                {updateCheck?.hasUpdate && (
                  <Badge tone="brand">发现新版本 v{updateCheck.latestVersion}</Badge>
                )}
                {updateCheck?.publishedAt && (
                  <span className="text-fg-3">发布于 {formatDate(updateCheck.publishedAt)}</span>
                )}
              </div>

              {updateCheck?.hasUpdate && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={Download}
                  loading={isUpdating}
                  onClick={handleApplyUpdate}
                >
                  立即更新至 v{updateCheck.latestVersion}
                </Button>
              )}
            </div>

            {isUpdating && updateStatus && (
              <div className="rounded-lg border border-line bg-surface-2 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg font-medium">
                    {reconnecting
                      ? '服务正在重启，等待面板自动重连...'
                      : updateStatus.message || '正在更新...'}
                  </span>
                  <span className="text-fg-3 font-mono tabular-nums">
                    {updateStatus.state === 'downloading' && updateStatus.totalBytes > 0
                      ? `${formatBytes(updateStatus.downloadedBytes)} / ${formatBytes(
                          updateStatus.totalBytes
                        )} (${updateStatus.percent}%)`
                      : `${updateStatus.percent}%`}
                  </span>
                </div>
                <ProgressBar
                  value={reconnecting ? 100 : updateStatus.percent}
                  tone={reconnecting ? 'success' : 'brand'}
                  size="md"
                />
              </div>
            )}

            {updateStatus?.state === 'error' && updateStatus.error && (
              <Alert tone="danger" title="更新失败">
                {updateStatus.error}
              </Alert>
            )}

            {updateCheck?.hasUpdate && (
              <div className="rounded-lg border border-line bg-surface-2/60 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 font-medium text-fg">
                    <span>{updateCheck.releaseName || `MoServerPanel ${updateCheck.tagName}`}</span>
                    {updateCheck.assetSize > 0 && (
                      <span className="text-fg-3 font-mono">
                        ({formatBytes(updateCheck.assetSize)})
                      </span>
                    )}
                    {updateCheck.hasChecksum && (
                      <span className="inline-flex items-center gap-1 text-success-fg">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        SHA256 校验
                      </span>
                    )}
                  </div>
                  {updateCheck.releaseUrl && (
                    <a
                      href={updateCheck.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand-fg hover:underline"
                    >
                      查看完整发布说明
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {updateCheck.releaseNotes && (
                  <pre className="text-xs text-fg-2 whitespace-pre-wrap font-sans leading-relaxed max-h-56 overflow-y-auto pt-1 border-t border-line">
                    {updateCheck.releaseNotes}
                  </pre>
                )}
              </div>
            )}

            {!updateCheck && !isUpdating && (
              <div className="flex items-center gap-2 text-xs text-fg-3">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>
                  点击「检查更新」从 GitHub 获取最新 Release，支持 SHA256 完整性校验、自动替换单文件并平滑重启服务；也可在命令行执行{' '}
                  <code className="px-1.5 py-0.5 rounded bg-surface-2 border border-line text-fg font-mono">
                    mo-server-panel.exe update
                  </code>
                  。
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* Banned IPs */}
        <Card title="防爆破临时封禁 IP 列表" icon={ShieldAlert} noPadding>
          {bans.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="当前没有被封禁的 IP"
              description="连续登录失败触发防爆破限制的来源 IP 将显示在此处。"
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>模块</Th>
                  <Th>IP 地址</Th>
                  <Th>失败次数</Th>
                  <Th>解封时间</Th>
                  <Th align="right">操作</Th>
                </tr>
              </THead>
              <TBody>
                {bans.map((b) => (
                  <Tr key={`${b.namespace}-${b.ip}`}>
                    <Td>
                      <Badge tone="brand" className="uppercase font-mono">
                        {b.namespace}
                      </Badge>
                    </Td>
                    <Td className="font-mono text-[12.5px] text-fg">{b.ip}</Td>
                    <Td>
                      <Badge tone="danger">{b.failCount}</Badge>
                    </Td>
                    <Td className="text-xs text-fg-2 tabular-nums">
                      {formatDate(b.bannedUntil)}
                    </Td>
                    <Td align="right">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Unlock}
                        onClick={() => handleUnban(b.namespace, b.ip)}
                      >
                        解封
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
};
