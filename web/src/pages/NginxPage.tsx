import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Edit2,
  FileText,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  ShieldPlus,
  Square,
  Trash2,
} from 'lucide-react';
import { api, Certificate, NginxStatus, ProxySite } from '../api/client';
import { Modal, StatusBadge, useToast } from '../components/UI';

const defaultSiteForm = {
  name: '',
  enabled: true,
  domainsText: '',
  listenPort: 80,
  upstream: 'http://127.0.0.1:3000',
  ssl: false,
  certId: '',
  forceHttps: false,
  webSocket: true,
  realIpHeaders: true,
  clientMaxBodySize: '50m',
  customConfig: '',
};

export const NginxPage: React.FC = () => {
  const { showToast } = useToast();
  const [status, setStatus] = useState<NginxStatus | null>(null);
  const [sites, setSites] = useState<ProxySite[]>([]);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [busyAction, setBusyAction] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...defaultSiteForm });
  const [saving, setSaving] = useState(false);

  const [previewConf, setPreviewConf] = useState<string | null>(null);
  const [logsModal, setLogsModal] = useState(false);
  const [logType, setLogType] = useState<'access' | 'error'>('error');
  const [logContent, setLogContent] = useState('');

  const load = async () => {
    try {
      const [sRes, cRes] = await Promise.all([api.listNginxSites(), api.listCerts()]);
      setSites(sRes.items || []);
      setStatus(sRes.status);
      setCerts(cRes.items || []);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runAction = async (label: string, fn: () => Promise<any>) => {
    setBusyAction(true);
    try {
      const res = await fn();
      if (label === '校验配置') {
        showToast('success', res.output || 'Nginx 配置语法校验通过');
      } else {
        showToast('success', `Nginx ${label}成功`);
        setStatus(res);
      }
      load();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setBusyAction(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...defaultSiteForm });
    setModalOpen(true);
  };

  const openEdit = (s: ProxySite) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      enabled: s.enabled,
      domainsText: (s.domains || []).join(', '),
      listenPort: s.listenPort || (s.ssl ? 443 : 80),
      upstream: s.upstream,
      ssl: s.ssl,
      certId: s.certId || '',
      forceHttps: s.forceHttps,
      webSocket: s.webSocket,
      realIpHeaders: s.realIpHeaders,
      clientMaxBodySize: s.clientMaxBodySize || '50m',
      customConfig: s.customConfig || '',
    });
    setModalOpen(true);
  };

  const handleSaveSite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      enabled: form.enabled,
      domains: form.domainsText
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
      listenPort: Number(form.listenPort),
      upstream: form.upstream.trim(),
      ssl: form.ssl,
      certId: form.ssl ? form.certId : '',
      forceHttps: form.ssl ? form.forceHttps : false,
      webSocket: form.webSocket,
      realIpHeaders: form.realIpHeaders,
      clientMaxBodySize: form.clientMaxBodySize.trim() || '50m',
      customConfig: form.customConfig,
    };
    try {
      if (editingId) {
        await api.updateNginxSite(editingId, payload);
        showToast('success', '反代站点已更新并完成 Nginx 校验');
      } else {
        await api.createNginxSite(payload);
        showToast('success', '反代站点已创建并完成 Nginx 校验');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSite = async (s: ProxySite) => {
    if (!confirm(`确认删除反代站点「${s.name}」？`)) return;
    try {
      await api.deleteNginxSite(s.id);
      showToast('success', '站点已删除');
      load();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handlePreview = async (s: ProxySite) => {
    try {
      const res = await api.previewNginxSite(s.id);
      setPreviewConf(res.config);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleQuickAllowPort = async (s: ProxySite) => {
    try {
      await api.createFirewallRule({
        name: `Nginx-${s.name}-${s.listenPort}`,
        protocol: 'TCP',
        port: String(s.listenPort),
        action: 'Allow',
        remoteAddress: 'Any',
        enabled: true,
        remark: `为 Nginx 站点「${s.name}」放行端口`,
      });
      showToast('success', `已放行防火墙 TCP ${s.listenPort} 端口`);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const openLogs = async (type: 'access' | 'error') => {
    setLogType(type);
    setLogsModal(true);
    try {
      const res = await api.nginxLogs(type, 250);
      setLogContent(res.content || '(暂无日志内容)');
    } catch (err: any) {
      setLogContent(`读取日志失败: ${err.message}`);
    }
  };

  const toggleAutoStart = async () => {
    if (!status) return;
    try {
      const res = await api.nginxSettings(!status.autoStart, '');
      setStatus(res);
      showToast('success', res.autoStart ? '已开启随面板自动启动 Nginx' : '已关闭自动启动 Nginx');
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Nginx 反向代理</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            内嵌托管 {status?.version || 'Nginx'} · 配置修改自动校验并在失败时回滚
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition cursor-pointer"
        >
          <Plus className="w-4 h-4" /> 新建反代站点
        </button>
      </div>

      {/* Nginx Service Control Bar */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <StatusBadge active={!!status?.running} />
          <div className="text-xs text-slate-400">
            PID: <span className="font-mono text-slate-200">{status?.running ? status.pid : '-'}</span>
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!!status?.autoStart}
              onChange={toggleAutoStart}
              className="rounded border-slate-600"
            />
            随面板自启
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!status?.running ? (
            <button
              disabled={busyAction}
              onClick={() => runAction('启动', api.nginxStart)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" /> 启动
            </button>
          ) : (
            <>
              <button
                disabled={busyAction}
                onClick={() => runAction('重载配置', api.nginxReload)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 热重载
              </button>
              <button
                disabled={busyAction}
                onClick={() => runAction('重启', api.nginxRestart)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5" /> 重启
              </button>
              <button
                disabled={busyAction}
                onClick={() => runAction('停止', api.nginxStop)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" /> 停止
              </button>
            </>
          )}
          <button
            disabled={busyAction}
            onClick={() => runAction('校验配置', api.nginxTest)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> nginx -t
          </button>
          <button
            onClick={() => openLogs('error')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" /> 日志
          </button>
        </div>
      </div>

      {/* Sites Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {sites.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            暂无反向代理站点，点击右上角「新建反代站点」开始配置。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-950/60 text-xs text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">站点名称</th>
                  <th className="py-3 px-4">域名 / 监听端口</th>
                  <th className="py-3 px-4">目标上游 (Upstream)</th>
                  <th className="py-3 px-4">特性</th>
                  <th className="py-3 px-4">状态</th>
                  <th className="py-3 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {sites.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 font-medium text-white">{s.name}</td>
                    <td className="py-3 px-4">
                      <div className="font-mono text-xs text-slate-200">
                        {s.domains && s.domains.length > 0 ? s.domains.join(', ') : '* (任意域名)'}
                      </div>
                      <div className="text-xs text-amber-300 font-mono mt-0.5">:{s.listenPort}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-sky-300">{s.upstream}</td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {s.ssl && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[11px]">
                            <Lock className="w-3 h-3" /> HTTPS
                          </span>
                        )}
                        {s.webSocket && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[11px]">
                            WS
                          </span>
                        )}
                        {s.forceHttps && (
                          <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[11px]">
                            301→HTTPS
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge active={s.enabled} activeText="已启用" inactiveText="已停用" />
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => handleQuickAllowPort(s)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 cursor-pointer"
                        title={`放行防火墙 ${s.listenPort} 端口`}
                      >
                        <ShieldPlus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handlePreview(s)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                        title="查看生成配置"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openEdit(s)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                        title="编辑"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteSite(s)}
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

      {/* Create/Edit Site Modal */}
      <Modal
        open={modalOpen}
        wide
        title={editingId ? '编辑反代站点' : '新建反代站点'}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSaveSite} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">站点名称 *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：我的 API 服务"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">监听端口 *</label>
              <input
                type="number"
                required
                min={1}
                max={65535}
                value={form.listenPort}
                onChange={(e) => setForm({ ...form, listenPort: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">
                绑定域名（多个用逗号或空格分隔，留空表示按端口匹配任意域名）
              </label>
              <input
                value={form.domainsText}
                onChange={(e) => setForm({ ...form, domainsText: e.target.value })}
                placeholder="app.example.com, www.example.com"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">反向代理目标地址 (Upstream) *</label>
              <input
                required
                value={form.upstream}
                onChange={(e) => setForm({ ...form, upstream: e.target.value })}
                placeholder="http://127.0.0.1:3000"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
          </div>

          {/* HTTPS Section */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-white cursor-pointer">
              <input
                type="checkbox"
                checked={form.ssl}
                onChange={(e) =>
                  setForm({
                    ...form,
                    ssl: e.target.checked,
                    listenPort: e.target.checked && form.listenPort === 80 ? 443 : !e.target.checked && form.listenPort === 443 ? 80 : form.listenPort,
                  })
                }
              />
              启用 HTTPS (SSL/TLS)
            </label>
            {form.ssl && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="md:col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">选择 SSL 证书 *</label>
                  <select
                    required
                    value={form.certId}
                    onChange={(e) => setForm({ ...form, certId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white"
                  >
                    <option value="">-- 请先在「SSL 证书」页添加证书 --</option>
                    {certs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.domains.join(', ')})
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.forceHttps}
                    onChange={(e) => setForm({ ...form, forceHttps: e.target.checked })}
                  />
                  同时监听 80 端口并强制 301 跳转 HTTPS
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.webSocket}
                onChange={(e) => setForm({ ...form, webSocket: e.target.checked })}
              />
              支持 WebSocket 升级
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.realIpHeaders}
                onChange={(e) => setForm({ ...form, realIpHeaders: e.target.checked })}
              />
              透传 Host / 真实 IP 请求头
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              启用该站点
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">最大请求体大小 (client_max_body_size)</label>
              <input
                value={form.clientMaxBodySize}
                onChange={(e) => setForm({ ...form, clientMaxBodySize: e.target.value })}
                placeholder="50m"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">高级：附加 Nginx server 块指令（可选）</label>
            <textarea
              rows={3}
              value={form.customConfig}
              onChange={(e) => setForm({ ...form, customConfig: e.target.value })}
              placeholder="# 例如：add_header X-Frame-Options SAMEORIGIN;"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 font-mono"
            />
          </div>

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
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium cursor-pointer"
            >
              {saving ? '校验并保存...' : '保存并重载 Nginx'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Preview Config Modal */}
      <Modal open={previewConf !== null} wide title="生成的 Nginx 站点配置" onClose={() => setPreviewConf(null)}>
        <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-emerald-300 font-mono overflow-x-auto whitespace-pre">
          {previewConf}
        </pre>
      </Modal>

      {/* Logs Modal */}
      <Modal open={logsModal} wide title="Nginx 运行日志" onClose={() => setLogsModal(false)}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => openLogs('error')}
              className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer ${
                logType === 'error' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              error.log
            </button>
            <button
              onClick={() => openLogs('access')}
              className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer ${
                logType === 'access' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              access.log
            </button>
          </div>
          <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 font-mono max-h-[55vh] overflow-auto whitespace-pre-wrap">
            {logContent}
          </pre>
        </div>
      </Modal>
    </div>
  );
};
