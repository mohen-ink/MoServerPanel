import React, { useEffect, useState } from 'react';
import { Key, Save, ServerCog, ShieldAlert, Unlock } from 'lucide-react';
import { api, BanEntry, formatDate, SettingsData } from '../api/client';
import { useToast } from '../components/UI';

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
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-white">面板设置</h2>
        <p className="text-xs text-slate-400 mt-0.5">管理面板监听参数、管理员密码与安全封禁列表</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel Network Settings */}
        <form onSubmit={handleSaveSettings} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ServerCog className="w-4 h-4 text-indigo-400" /> 面板监听与运行信息
          </h3>
          <div>
            <label className="block text-xs text-slate-400 mb-1">监听地址</label>
            <input
              value={listenAddr}
              onChange={(e) => setListenAddr(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">监听端口</label>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
            />
          </div>
          {settings && (
            <div className="text-xs text-slate-400 space-y-1 pt-2 border-t border-slate-800">
              <div>版本：v{settings.version}</div>
              <div>数据目录：{settings.dataDir}</div>
              <div>管理员权限：{settings.isAdmin ? '是 (Elevated)' : '否 (普通权限)'}</div>
              <div>Windows 服务状态：{settings.serviceStatus}</div>
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition cursor-pointer"
          >
            <Save className="w-4 h-4" /> 保存监听设置
          </button>
        </form>

        {/* Change Admin Password */}
        <form onSubmit={handleChangePwd} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Key className="w-4 h-4 text-emerald-400" /> 修改管理员密码
          </h3>
          <div>
            <label className="block text-xs text-slate-400 mb-1">当前密码</label>
            <input
              type="password"
              required
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">新密码（至少 8 位）</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition cursor-pointer"
          >
            更新密码
          </button>
          <p className="text-xs text-slate-500">
            如忘记密码，可在服务器本地运行：
            <code className="block mt-1 px-2 py-1 rounded bg-slate-950 text-slate-300">
              win-server-panel.exe reset-password --password 新密码
            </code>
          </p>
        </form>
      </div>

      {/* Banned IPs */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white mb-4">
          <ShieldAlert className="w-4 h-4 text-rose-400" /> 防爆破临时封禁 IP 列表
        </h3>
        {bans.length === 0 ? (
          <p className="text-sm text-slate-500">当前没有被封禁的 IP。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2 pr-4">模块</th>
                  <th className="py-2 pr-4">IP 地址</th>
                  <th className="py-2 pr-4">失败次数</th>
                  <th className="py-2 pr-4">解封时间</th>
                  <th className="py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {bans.map((b) => (
                  <tr key={`${b.namespace}-${b.ip}`}>
                    <td className="py-2.5 pr-4 uppercase text-xs font-mono text-indigo-300">{b.namespace}</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-200">{b.ip}</td>
                    <td className="py-2.5 pr-4 text-rose-300">{b.failCount}</td>
                    <td className="py-2.5 pr-4 text-slate-400">{formatDate(b.bannedUntil)}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => handleUnban(b.namespace, b.ip)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
                      >
                        <Unlock className="w-3.5 h-3.5" /> 解封
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
