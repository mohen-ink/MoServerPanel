import React, { useEffect, useState } from 'react';
import { Key, Save, ServerCog, ShieldAlert, Unlock } from 'lucide-react';
import { api, BanEntry, formatDate, SettingsData } from '../api/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '../components/UI';

export const SettingsPage: React.FC = () => {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [listenAddr, setListenAddr] = useState('0.0.0.0');
  const [port, setPort] = useState(8900);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [s, b] = await Promise.all([api.getSettings(), api.listBans()]);
      setSettings(s);
      setListenAddr(s.listenAddr);
      setPort(s.port);
      setBans(b.items || []);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
                  win-server-panel.exe reset-password --password 新密码
                </code>
              </div>
            </form>
          </Card>
        </div>

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
