import React, { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, Certificate, formatDate } from '../api/client';
import { Modal, useToast } from '../components/UI';

export const CertsPage: React.FC = () => {
  const { showToast } = useToast();
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [acmeOpen, setAcmeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);

  const [manualForm, setManualForm] = useState({ name: '', certPem: '', keyPem: '' });
  const [acmeForm, setAcmeForm] = useState({
    name: '',
    domainsText: '',
    email: '',
    challenge: 'http01',
    cfApiToken: '',
    aliKeyId: '',
    aliKeySecret: '',
    autoRenew: true,
    staging: false,
  });

  const load = async () => {
    try {
      const res = await api.listCerts();
      setCerts(res.items || []);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUploadManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.uploadManualCert(manualForm);
      showToast('success', 'SSL 证书上传并验证成功');
      setManualOpen(false);
      setManualForm({ name: '', certPem: '', keyPem: '' });
      load();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleIssueACME = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const providerConfig: Record<string, string> = {};
    if (acmeForm.challenge === 'cloudflare') {
      providerConfig.apiToken = acmeForm.cfApiToken.trim();
    } else if (acmeForm.challenge === 'alidns') {
      providerConfig.accessKeyId = acmeForm.aliKeyId.trim();
      providerConfig.accessKeySecret = acmeForm.aliKeySecret.trim();
    }

    try {
      await api.issueACMECert({
        name: acmeForm.name.trim(),
        domains: acmeForm.domainsText
          .split(/[\s,]+/)
          .map((d) => d.trim())
          .filter(Boolean),
        email: acmeForm.email.trim(),
        challenge: acmeForm.challenge,
        providerConfig,
        autoRenew: acmeForm.autoRenew,
        staging: acmeForm.staging,
      });
      showToast('success', 'Let’s Encrypt 证书申请成功！');
      setAcmeOpen(false);
      load();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRenew = async (c: Certificate) => {
    setRenewingId(c.id);
    try {
      await api.renewCert(c.id);
      showToast('success', `证书「${c.name}」续期成功并已重载 Nginx`);
      load();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setRenewingId(null);
    }
  };

  const handleDelete = async (c: Certificate) => {
    if (!confirm(`确认删除证书「${c.name}」？`)) return;
    try {
      await api.deleteCert(c.id);
      showToast('success', '证书已删除');
      load();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">SSL 证书管理</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            支持手动导入 PEM 证书或 Let’s Encrypt 自动签发（到期前 30 天自动续期）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setManualOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm transition cursor-pointer"
          >
            <Upload className="w-4 h-4" /> 手动上传证书
          </button>
          <button
            onClick={() => setAcmeOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4" /> 申请免费证书 (ACME)
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {certs.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            暂无 SSL 证书，点击右上角上传已有证书或申请 Let’s Encrypt 免费证书。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-950/60 text-xs text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">证书名称</th>
                  <th className="py-3 px-4">覆盖域名</th>
                  <th className="py-3 px-4">来源</th>
                  <th className="py-3 px-4">颁发机构</th>
                  <th className="py-3 px-4">到期时间</th>
                  <th className="py-3 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {certs.map((c) => {
                  const left = daysLeft(c.notAfter);
                  return (
                    <tr key={c.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <KeyRound className="w-4 h-4 text-violet-400" />
                          <span>{c.name}</span>
                        </div>
                        {c.lastError && (
                          <div className="text-xs text-rose-400 mt-1 max-w-xs truncate" title={c.lastError}>
                            上次续期失败: {c.lastError}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-200">{c.domains.join(', ')}</td>
                      <td className="py-3 px-4">
                        {c.source === 'acme' ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-xs">
                            ACME ({c.acmeChallenge})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs">手动导入</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-400">{c.issuer || '-'}</td>
                      <td className="py-3 px-4 text-xs">
                        <div className="text-slate-200">{formatDate(c.notAfter)}</div>
                        <span
                          className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[11px] ${
                            left <= 7
                              ? 'bg-rose-500/15 text-rose-300'
                              : left <= 30
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          {left > 0 ? `剩余 ${left} 天` : '已过期'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {c.source === 'acme' && (
                          <button
                            disabled={renewingId === c.id}
                            onClick={() => handleRenew(c)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${renewingId === c.id ? 'animate-spin' : ''}`} /> 续期
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(c)}
                          className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 cursor-pointer"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload Manual PEM Modal */}
      <Modal open={manualOpen} wide title="手动导入 PEM 证书" onClose={() => setManualOpen(false)}>
        <form onSubmit={handleUploadManual} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">证书备注名称</label>
            <input
              value={manualForm.name}
              onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
              placeholder="留空则自动使用证书主域名"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">证书内容 (Fullchain PEM) *</label>
            <textarea
              required
              rows={5}
              value={manualForm.certPem}
              onChange={(e) => setManualForm({ ...manualForm, certPem: e.target.value })}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-emerald-300 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">私钥内容 (Private Key PEM) *</label>
            <textarea
              required
              rows={5}
              value={manualForm.keyPem}
              onChange={(e) => setManualForm({ ...manualForm, keyPem: e.target.value })}
              placeholder="-----BEGIN PRIVATE KEY-----"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-amber-300 font-mono"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setManualOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-sm cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium cursor-pointer"
            >
              {submitting ? '正在校验保存...' : '保存证书'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ACME Let's Encrypt Modal */}
      <Modal open={acmeOpen} wide title="申请 Let's Encrypt 免费证书 (ACME)" onClose={() => setAcmeOpen(false)}>
        <form onSubmit={handleIssueACME} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">证书名称</label>
              <input
                value={acmeForm.name}
                onChange={(e) => setAcmeForm({ ...acmeForm, name: e.target.value })}
                placeholder="留空默认使用第一个域名"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">联系邮箱 *</label>
              <input
                type="email"
                required
                value={acmeForm.email}
                onChange={(e) => setAcmeForm({ ...acmeForm, email: e.target.value })}
                placeholder="admin@example.com"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">申请域名（多个用逗号分隔）*</label>
              <input
                required
                value={acmeForm.domainsText}
                onChange={(e) => setAcmeForm({ ...acmeForm, domainsText: e.target.value })}
                placeholder="app.example.com"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">域名验证方式</label>
              <select
                value={acmeForm.challenge}
                onChange={(e) => setAcmeForm({ ...acmeForm, challenge: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
              >
                <option value="http01">HTTP-01 文件验证（需域名已解析到本机且公网 80 端口可达）</option>
                <option value="cloudflare">DNS-01 — Cloudflare API Token（支持泛域名，无需 80 端口）</option>
                <option value="alidns">DNS-01 — 阿里云 DNS（支持泛域名，无需 80 端口）</option>
              </select>
            </div>

            {acmeForm.challenge === 'cloudflare' && (
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Cloudflare API Token *</label>
                <input
                  required
                  type="password"
                  value={acmeForm.cfApiToken}
                  onChange={(e) => setAcmeForm({ ...acmeForm, cfApiToken: e.target.value })}
                  placeholder="具有 Zone:DNS:Edit 权限的 API Token"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
                />
              </div>
            )}

            {acmeForm.challenge === 'alidns' && (
              <>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">阿里云 AccessKey ID *</label>
                  <input
                    required
                    value={acmeForm.aliKeyId}
                    onChange={(e) => setAcmeForm({ ...acmeForm, aliKeyId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">阿里云 AccessKey Secret *</label>
                  <input
                    required
                    type="password"
                    value={acmeForm.aliKeySecret}
                    onChange={(e) => setAcmeForm({ ...acmeForm, aliKeySecret: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-mono"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-5 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={acmeForm.autoRenew}
                onChange={(e) => setAcmeForm({ ...acmeForm, autoRenew: e.target.checked })}
              />
              到期前 30 天自动续期
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={acmeForm.staging}
                onChange={(e) => setAcmeForm({ ...acmeForm, staging: e.target.checked })}
              />
              使用 Let’s Encrypt 测试环境 (Staging)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setAcmeOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-sm cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium cursor-pointer"
            >
              {submitting ? '正在向 Let’s Encrypt 验证签发...' : '立即申请证书'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
