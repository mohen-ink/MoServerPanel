import React, { useEffect, useState } from 'react';
import {
  Edit2,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { api, FirewallRule, ListeningPort, SystemFirewallRule } from '../api/client';
import { AdminBanner, Modal, StatusBadge, useToast } from '../components/UI';

const emptyForm = {
  name: '',
  protocol: 'TCP',
  port: '',
  action: 'Allow',
  remoteAddress: 'Any',
  enabled: true,
  remark: '',
};

export const FirewallPage: React.FC = () => {
  const { showToast } = useToast();
  const [subTab, setSubTab] = useState<'managed' | 'ports' | 'system'>('managed');
  const [isAdmin, setIsAdmin] = useState(true);
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const [sysRules, setSysRules] = useState<SystemFirewallRule[]>([]);
  const [sysSearch, setSysSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [submitting, setSubmitting] = useState(false);

  const loadManaged = async () => {
    setLoading(true);
    try {
      const res = await api.listFirewallRules();
      setRules(res.items || []);
      setIsAdmin(res.isAdmin);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPorts = async () => {
    setLoading(true);
    try {
      const res = await api.listListeningPorts();
      setPorts(res.items || []);
      setIsAdmin(res.isAdmin);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSystem = async () => {
    setLoading(true);
    try {
      const res = await api.listSystemFirewallRules();
      setSysRules(res.items || []);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === 'managed') loadManaged();
    else if (subTab === 'ports') loadPorts();
    else loadSystem();
  }, [subTab]);

  const openCreate = (prefill?: Partial<typeof emptyForm>) => {
    setEditingId(null);
    setForm({ ...emptyForm, ...(prefill || {}) });
    setModalOpen(true);
  };

  const openEdit = (r: FirewallRule) => {
    setEditingId(r.id);
    setForm({
      name: r.name,
      protocol: r.protocol,
      port: r.port,
      action: r.action,
      remoteAddress: r.remoteAddress || 'Any',
      enabled: r.enabled,
      remark: r.remark || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingId) {
        await api.updateFirewallRule(editingId, form);
        showToast('success', '防火墙规则已更新');
      } else {
        await api.createFirewallRule(form);
        showToast('success', '防火墙规则已创建并生效');
      }
      setModalOpen(false);
      loadManaged();
      if (subTab === 'ports') loadPorts();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (r: FirewallRule) => {
    try {
      await api.toggleFirewallRule(r.id, !r.enabled);
      showToast('success', !r.enabled ? '规则已启用' : '规则已禁用');
      loadManaged();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDelete = async (r: FirewallRule) => {
    if (!confirm(`确认删除防火墙规则「${r.name}」(端口 ${r.port})？`)) return;
    try {
      await api.deleteFirewallRule(r.id);
      showToast('success', '规则已删除');
      loadManaged();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const filteredSys = sysRules.filter((r) => {
    if (!sysSearch.trim()) return true;
    const q = sysSearch.toLowerCase();
    return (
      r.displayName.toLowerCase().includes(q) ||
      r.localPort.toLowerCase().includes(q) ||
      r.protocol.toLowerCase().includes(q) ||
      r.group.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">端口通行（Windows 防火墙）</h2>
          <p className="text-xs text-slate-400 mt-0.5">可视化管理入站放行/拦截规则、查看本机监听端口与系统规则</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => (subTab === 'managed' ? loadManaged() : subTab === 'ports' ? loadPorts() : loadSystem())}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
          <button
            onClick={() => openCreate()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition cursor-pointer"
          >
            <Plus className="w-4 h-4" /> 添加端口规则
          </button>
        </div>
      </div>

      <AdminBanner isAdmin={isAdmin} />

      {/* Sub-tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        {[
          { key: 'managed', label: `面板管理规则 (${rules.length})`, icon: Shield },
          { key: 'ports', label: '本机监听端口与进程', icon: Radio },
          { key: 'system', label: '系统全部入站规则', icon: ShieldCheck },
        ].map((t) => {
          const Icon = t.icon;
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key as any)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm transition cursor-pointer ${
                active
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Managed Rules */}
      {subTab === 'managed' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {rules.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              暂无面板管理的端口规则，点击右上角「添加端口规则」开始放行端口。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-950/60 text-xs text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">规则名称</th>
                    <th className="py-3 px-4">协议</th>
                    <th className="py-3 px-4">端口</th>
                    <th className="py-3 px-4">策略</th>
                    <th className="py-3 px-4">来源 IP</th>
                    <th className="py-3 px-4">状态</th>
                    <th className="py-3 px-4">备注</th>
                    <th className="py-3 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {rules.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-medium text-white">{r.name}</td>
                      <td className="py-3 px-4 font-mono text-xs text-sky-300">{r.protocol}</td>
                      <td className="py-3 px-4 font-mono text-amber-300 font-semibold">{r.port}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                            r.action === 'Allow'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {r.action === 'Allow' ? '允许放行' : '拒绝拦截'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-300">{r.remoteAddress || 'Any'}</td>
                      <td className="py-3 px-4">
                        <button onClick={() => handleToggle(r)} className="cursor-pointer">
                          <StatusBadge active={r.enabled} activeText="已启用" inactiveText="已禁用" />
                        </button>
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-xs max-w-[200px] truncate">{r.remark || '-'}</td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          onClick={() => openEdit(r)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                          title="编辑"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(r)}
                          className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 cursor-pointer"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Listening Ports */}
      {subTab === 'ports' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-950/60 text-xs text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">协议</th>
                  <th className="py-3 px-4">监听地址</th>
                  <th className="py-3 px-4">端口</th>
                  <th className="py-3 px-4">进程</th>
                  <th className="py-3 px-4">PID</th>
                  <th className="py-3 px-4">面板放行状态</th>
                  <th className="py-3 px-4 text-right">快捷操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {ports.map((p, idx) => (
                  <tr key={`${p.protocol}-${p.localAddr}-${p.port}-${idx}`} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono text-xs text-sky-300">{p.protocol}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-300">{p.localAddr}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-amber-300">{p.port}</td>
                    <td className="py-2.5 px-4">
                      <div className="text-slate-200 font-medium">{p.processName}</div>
                      {p.processPath && (
                        <div className="text-xs text-slate-500 truncate max-w-xs" title={p.processPath}>
                          {p.processPath}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-400">{p.pid}</td>
                    <td className="py-2.5 px-4">
                      {p.managedAllow ? (
                        <StatusBadge active={true} activeText="已放行" />
                      ) : (
                        <span className="text-xs text-slate-500">未在面板放行</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {!p.managedAllow && (
                        <button
                          onClick={() =>
                            openCreate({
                              name: `${p.processName.replace('.exe', '')}-${p.port}`,
                              protocol: p.protocol,
                              port: String(p.port),
                              action: 'Allow',
                              remark: `快速放行进程 ${p.processName} (PID ${p.pid})`,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" /> 一键放行
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: System Inbound Rules */}
      {subTab === 'system' && (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
            <input
              value={sysSearch}
              onChange={(e) => setSysSearch(e.target.value)}
              placeholder="搜索规则名、端口、协议或分组..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="py-12 text-center text-slate-400 text-sm">正在读取 Windows 防火墙系统规则...</div>
            ) : (
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-950/80 text-xs text-slate-400 border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-3 px-4">显示名称</th>
                      <th className="py-3 px-4">协议</th>
                      <th className="py-3 px-4">本地端口</th>
                      <th className="py-3 px-4">策略</th>
                      <th className="py-3 px-4">状态</th>
                      <th className="py-3 px-4">配置集</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredSys.slice(0, 300).map((r) => (
                      <tr key={r.name} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 text-slate-200">
                          <div className="flex items-center gap-2">
                            <span>{r.displayName || r.name}</span>
                            {r.managed && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px]">
                                面板管理
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-xs text-sky-300">{r.protocol}</td>
                        <td className="py-2.5 px-4 font-mono text-xs text-amber-300">{r.localPort}</td>
                        <td className="py-2.5 px-4 text-xs">
                          <span className={r.action === 'Allow' ? 'text-emerald-300' : 'text-rose-300'}>
                            {r.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          {r.enabled ? (
                            <span className="text-xs text-emerald-400">启用</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                              <ShieldOff className="w-3 h-3" /> 禁用
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-400">{r.profile}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        title={editingId ? '编辑端口规则' : '添加端口通行规则'}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">规则名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：放行 Web HTTPS"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">协议</label>
              <select
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              >
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
                <option value="Any">TCP + UDP</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">动作策略</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              >
                <option value="Allow">允许放行 (Allow)</option>
                <option value="Block">拒绝拦截 (Block)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">端口 / 端口段 *</label>
              <input
                required
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                placeholder="示例：80、443、8000-8010 或 80,443"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">允许的来源 IP / CIDR（留空或 Any 表示全部）</label>
              <input
                value={form.remoteAddress}
                onChange={(e) => setForm({ ...form, remoteAddress: e.target.value })}
                placeholder="Any 或 192.168.1.0/24, 1.2.3.4"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">备注</label>
              <input
                value={form.remark}
                onChange={(e) => setForm({ ...form, remark: e.target.value })}
                placeholder="可选备注说明"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded border-slate-600"
            />
            创建后立即启用此规则
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-sm cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium cursor-pointer"
            >
              {submitting ? '正在应用...' : '保存并应用'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
