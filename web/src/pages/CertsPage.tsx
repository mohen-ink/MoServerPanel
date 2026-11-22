import React, { useEffect, useMemo, useState } from 'react';
import {
  Cloud,
  Edit2,
  KeyRound,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, Certificate, DNSAccount, formatDate } from '../api/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  ModalFooter,
  PageHeader,
  Select,
  StatusBadge,
  Switch,
  Table,
  Tabs,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  useConfirm,
  useToast,
} from '../components/UI';

const PROVIDER_LABELS: Record<string, string> = {
  cloudflare: 'Cloudflare',
  alidns: '阿里云 DNS',
};

const providerLabel = (provider?: string) =>
  (provider && PROVIDER_LABELS[provider.toLowerCase()]) || provider || '-';

const dnsCredentialSummary = (acc: DNSAccount): string => {
  if (acc.provider === 'cloudflare') {
    return acc.config?.apiToken ? `API Token: ${acc.config.apiToken}` : '未配置';
  }
  if (acc.provider === 'alidns') {
    return acc.config?.accessKeyId ? `AccessKey ID: ${acc.config.accessKeyId}` : '未配置';
  }
  return '-';
};

const emptyDnsForm = {
  name: '',
  provider: 'cloudflare',
  cfApiToken: '',
  aliKeyId: '',
  aliKeySecret: '',
  remark: '',
};

export const CertsPage: React.FC = () => {
  const { showToast } = useToast();
  const confirmDialog = useConfirm();

  const [subTab, setSubTab] = useState<'certs' | 'dns'>('certs');
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [dnsAccounts, setDnsAccounts] = useState<DNSAccount[]>([]);

  const [manualOpen, setManualOpen] = useState(false);
  const [acmeOpen, setAcmeOpen] = useState(false);
  const [editCertOpen, setEditCertOpen] = useState(false);
  const [dnsModalOpen, setDnsModalOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // If user clicks "+ 新建 DNS 账号" from inside ACME or Edit Cert modal, return after saving/closing
  const [returnTarget, setReturnTarget] = useState<'acme' | 'editCert' | null>(null);

  const [manualForm, setManualForm] = useState({ name: '', certPem: '', keyPem: '' });
  const [acmeForm, setAcmeForm] = useState({
    name: '',
    domainsText: '',
    email: '',
    challengeMode: 'dns' as 'dns' | 'http01',
    dnsAccountId: '',
    autoRenew: true,
    staging: false,
  });

  const [editingCert, setEditingCert] = useState<Certificate | null>(null);
  const [editCertForm, setEditCertForm] = useState({
    name: '',
    email: '',
    challengeMode: 'dns' as 'dns' | 'http01' | 'keep',
    dnsAccountId: '',
    autoRenew: true,
  });

  const [editingDnsId, setEditingDnsId] = useState<string | null>(null);
  const [dnsForm, setDnsForm] = useState({ ...emptyDnsForm });

  const loadAll = async () => {
    try {
      const [certRes, dnsRes] = await Promise.all([api.listCerts(), api.listDNSAccounts()]);
      setCerts(certRes.items || []);
      setDnsAccounts(dnsRes.items || []);
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const certCountByDns = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of certs) {
      if (c.dnsAccountId) {
        map[c.dnsAccountId] = (map[c.dnsAccountId] || 0) + 1;
      }
    }
    return map;
  }, [certs]);

  const openAcmeModal = () => {
    const lastEmail = certs.find((c) => c.source === 'acme' && c.acmeEmail)?.acmeEmail || '';
    const defaultDnsId = dnsAccounts[0]?.id || '';
    setAcmeForm((prev) => ({
      name: '',
      domainsText: '',
      email: prev.email || lastEmail,
      challengeMode: defaultDnsId ? 'dns' : 'http01',
      dnsAccountId: defaultDnsId,
      autoRenew: true,
      staging: false,
    }));
    setAcmeOpen(true);
  };

  const openCreateDnsModal = (from: 'acme' | 'editCert' | null = null) => {
    setEditingDnsId(null);
    setDnsForm({ ...emptyDnsForm });
    setReturnTarget(from);
    if (from === 'acme') setAcmeOpen(false);
    if (from === 'editCert') setEditCertOpen(false);
    setDnsModalOpen(true);
  };

  const openEditDnsModal = (acc: DNSAccount) => {
    setEditingDnsId(acc.id);
    setReturnTarget(null);
    setDnsForm({
      name: acc.name,
      provider: acc.provider,
      cfApiToken: '',
      aliKeyId: '',
      aliKeySecret: '',
      remark: acc.remark || '',
    });
    setDnsModalOpen(true);
  };

  const closeDnsModal = () => {
    setDnsModalOpen(false);
    if (returnTarget === 'acme') setAcmeOpen(true);
    if (returnTarget === 'editCert') setEditCertOpen(true);
    setReturnTarget(null);
  };

  const openEditCertModal = (c: Certificate) => {
    setEditingCert(c);
    const mode: 'dns' | 'http01' | 'keep' =
      c.source !== 'acme'
        ? 'keep'
        : c.dnsAccountId
          ? 'dns'
          : c.acmeChallenge === 'http01'
            ? 'http01'
            : dnsAccounts.length > 0
              ? 'keep'
              : 'keep';
    setEditCertForm({
      name: c.name,
      email: c.acmeEmail || '',
      challengeMode: mode,
      dnsAccountId: c.dnsAccountId || dnsAccounts[0]?.id || '',
      autoRenew: c.autoRenew,
    });
    setEditCertOpen(true);
  };

  const handleUploadManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.uploadManualCert(manualForm);
      showToast('success', 'SSL 证书上传并验证成功');
      setManualOpen(false);
      setManualForm({ name: '', certPem: '', keyPem: '' });
      loadAll();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleIssueACME = async (e: React.FormEvent) => {
    e.preventDefault();
    if (acmeForm.challengeMode === 'dns' && !acmeForm.dnsAccountId) {
      showToast('error', '请先添加并选择一个 DNS 账号');
      return;
    }

    setSubmitting(true);
    try {
      await api.issueACMECert({
        name: acmeForm.name.trim(),
        domains: acmeForm.domainsText
          .split(/[\s,]+/)
          .map((d) => d.trim())
          .filter(Boolean),
        email: acmeForm.email.trim(),
        challenge: acmeForm.challengeMode === 'http01' ? 'http01' : 'dns',
        dnsAccountId: acmeForm.challengeMode === 'dns' ? acmeForm.dnsAccountId : undefined,
        autoRenew: acmeForm.autoRenew,
        staging: acmeForm.staging,
      });
      showToast('success', 'Let’s Encrypt 证书申请成功！');
      setAcmeOpen(false);
      loadAll();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCertSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCert) return;

    const payload: {
      name?: string;
      autoRenew?: boolean;
      acmeEmail?: string;
      challenge?: string;
      dnsAccountId?: string;
    } = {
      name: editCertForm.name.trim(),
    };

    if (editingCert.source === 'acme') {
      payload.autoRenew = editCertForm.autoRenew;
      payload.acmeEmail = editCertForm.email.trim();
      if (editCertForm.challengeMode === 'http01') {
        payload.challenge = 'http01';
      } else if (editCertForm.challengeMode === 'dns') {
        if (!editCertForm.dnsAccountId) {
          showToast('error', '请选择一个 DNS 账号');
          return;
        }
        payload.dnsAccountId = editCertForm.dnsAccountId;
      }
    }

    setSubmitting(true);
    try {
      await api.updateCert(editingCert.id, payload);
      showToast('success', '证书配置已更新');
      setEditCertOpen(false);
      setEditingCert(null);
      loadAll();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleAutoRenew = async (c: Certificate) => {
    if (c.source !== 'acme') return;
    setTogglingId(c.id);
    try {
      await api.updateCert(c.id, { autoRenew: !c.autoRenew });
      showToast(
        'success',
        !c.autoRenew ? `已开启「${c.name}」自动续期` : `已关闭「${c.name}」自动续期`
      );
      loadAll();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const handleRenew = async (c: Certificate) => {
    setRenewingId(c.id);
    try {
      await api.renewCert(c.id);
      showToast('success', `证书「${c.name}」续期成功并已重载 Nginx`);
      loadAll();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setRenewingId(null);
    }
  };

  const handleDeleteCert = async (c: Certificate) => {
    const ok = await confirmDialog({
      title: '删除 SSL 证书',
      description: `确认删除证书「${c.name}」？此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCert(c.id);
      showToast('success', '证书已删除');
      loadAll();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleSaveDNSAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const config: Record<string, string> = {};
    if (dnsForm.provider === 'cloudflare') {
      if (dnsForm.cfApiToken.trim()) config.apiToken = dnsForm.cfApiToken.trim();
    } else if (dnsForm.provider === 'alidns') {
      if (dnsForm.aliKeyId.trim()) config.accessKeyId = dnsForm.aliKeyId.trim();
      if (dnsForm.aliKeySecret.trim()) config.accessKeySecret = dnsForm.aliKeySecret.trim();
    }

    setSubmitting(true);
    try {
      let saved: DNSAccount;
      if (editingDnsId) {
        saved = await api.updateDNSAccount(editingDnsId, {
          name: dnsForm.name.trim(),
          provider: dnsForm.provider,
          config,
          remark: dnsForm.remark.trim(),
        });
        showToast('success', `DNS 账号「${saved.name}」已更新`);
      } else {
        saved = await api.createDNSAccount({
          name: dnsForm.name.trim(),
          provider: dnsForm.provider,
          config,
          remark: dnsForm.remark.trim(),
        });
        showToast('success', `DNS 账号「${saved.name}」已添加`);
      }

      await loadAll();

      const target = returnTarget;
      setDnsModalOpen(false);
      setReturnTarget(null);

      if (target === 'acme') {
        setAcmeForm((prev) => ({
          ...prev,
          challengeMode: 'dns',
          dnsAccountId: saved.id,
        }));
        setAcmeOpen(true);
      } else if (target === 'editCert') {
        setEditCertForm((prev) => ({
          ...prev,
          challengeMode: 'dns',
          dnsAccountId: saved.id,
        }));
        setEditCertOpen(true);
      }
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDNSAccount = async (acc: DNSAccount) => {
    const ok = await confirmDialog({
      title: '删除 DNS 账号',
      description: `确认删除 DNS 账号「${acc.name}」？此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteDNSAccount(acc.id);
      showToast('success', 'DNS 账号已删除');
      loadAll();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

  const editingDnsInUse = !!(editingDnsId && (certCountByDns[editingDnsId] || 0) > 0);

  return (
    <div>
      <PageHeader
        title="SSL 证书管理"
        description="统一管理 DNS 服务商账号与 SSL 证书，支持 Let’s Encrypt 自动签发与到期前 30 天自动续期"
        actions={
          subTab === 'certs' ? (
            <>
              <Button variant="secondary" icon={Upload} onClick={() => setManualOpen(true)}>
                手动上传证书
              </Button>
              <Button variant="primary" icon={Sparkles} onClick={openAcmeModal}>
                申请免费证书 (ACME)
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={Plus} onClick={() => openCreateDnsModal(null)}>
              添加 DNS 账号
            </Button>
          )
        }
      />

      <div className="space-y-4">
        <Tabs
          value={subTab}
          onChange={(k) => setSubTab(k as 'certs' | 'dns')}
          items={[
            { key: 'certs', label: 'SSL 证书', icon: KeyRound, count: certs.length },
            { key: 'dns', label: 'DNS 账号', icon: Cloud, count: dnsAccounts.length },
          ]}
        />

        {/* Tab 1: SSL Certificates */}
        {subTab === 'certs' && (
          <Card noPadding>
            {certs.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                title="暂无 SSL 证书"
                description="可先在「DNS 账号」中添加 Cloudflare / 阿里云账号，再一键申请泛域名免费证书并自动续期。"
                action={
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" icon={Cloud} onClick={() => setSubTab('dns')}>
                      管理 DNS 账号
                    </Button>
                    <Button variant="primary" icon={Sparkles} onClick={openAcmeModal}>
                      申请免费证书 (ACME)
                    </Button>
                  </div>
                }
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>证书名称</Th>
                    <Th>覆盖域名</Th>
                    <Th>验证方式 / DNS 账号</Th>
                    <Th>自动续期</Th>
                    <Th>到期时间</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </THead>
                <TBody>
                  {certs.map((c) => {
                    const left = daysLeft(c.notAfter);
                    return (
                      <Tr key={c.id}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <KeyRound className="w-4 h-4 text-brand shrink-0" />
                            <span className="font-medium text-fg">{c.name}</span>
                            {c.acmeStaging && <Badge tone="warning">Staging</Badge>}
                          </div>
                          {c.issuer && (
                            <div className="text-xs text-fg-3 mt-0.5 truncate max-w-xs">
                              颁发机构: {c.issuer}
                            </div>
                          )}
                          {c.lastError && (
                            <div
                              className="text-xs text-danger-fg mt-1 max-w-xs truncate"
                              title={c.lastError}
                            >
                              上次续期失败: {c.lastError}
                            </div>
                          )}
                        </Td>
                        <Td className="font-mono text-[12.5px] text-fg">{c.domains.join(', ')}</Td>
                        <Td>
                          {c.source === 'manual' ? (
                            <Badge tone="neutral">手动导入</Badge>
                          ) : c.dnsAccountId ? (
                            <div className="space-y-1">
                              <Badge tone="brand">
                                {providerLabel(c.acmeChallenge)} · {c.dnsAccountName || '已删账号'}
                              </Badge>
                            </div>
                          ) : c.acmeChallenge === 'http01' ? (
                            <Badge tone="success">HTTP-01 文件验证</Badge>
                          ) : (
                            <div className="space-y-1">
                              <Badge tone="warning">
                                {providerLabel(c.acmeChallenge)}（旧内联凭证）
                              </Badge>
                            </div>
                          )}
                        </Td>
                        <Td>
                          {c.source === 'acme' ? (
                            <div>
                              <button
                                type="button"
                                disabled={togglingId === c.id}
                                onClick={() => handleToggleAutoRenew(c)}
                                className="cursor-pointer disabled:opacity-50"
                                title="点击切换到期前 30 天自动续期"
                              >
                                <StatusBadge
                                  active={c.autoRenew}
                                  activeText="已开启"
                                  inactiveText="已关闭"
                                />
                              </button>
                              {c.lastRenewAt && (
                                <div className="text-[11px] text-fg-3 mt-1 tabular-nums">
                                  上次: {formatDate(c.lastRenewAt)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-fg-3">-</span>
                          )}
                        </Td>
                        <Td>
                          <div className="text-xs text-fg tabular-nums">
                            {formatDate(c.notAfter)}
                          </div>
                          <div className="mt-1">
                            <Badge tone={left <= 7 ? 'danger' : left <= 30 ? 'warning' : 'success'}>
                              {left > 0 ? `剩余 ${left} 天` : '已过期'}
                            </Badge>
                          </div>
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {c.source === 'acme' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={renewingId === c.id}
                                onClick={() => handleRenew(c)}
                              >
                                <RefreshCw
                                  className={cn(
                                    'w-3.5 h-3.5',
                                    renewingId === c.id && 'animate-spin'
                                  )}
                                />
                                续期
                              </Button>
                            )}
                            <IconButton
                              icon={Edit2}
                              size="sm"
                              title="编辑证书设置"
                              onClick={() => openEditCertModal(c)}
                            />
                            <IconButton
                              icon={Trash2}
                              tone="danger"
                              size="sm"
                              title="删除"
                              onClick={() => handleDeleteCert(c)}
                            />
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>
        )}

        {/* Tab 2: DNS Accounts */}
        {subTab === 'dns' && (
          <Card noPadding>
            {dnsAccounts.length === 0 ? (
              <EmptyState
                icon={Cloud}
                title="暂无已保存的 DNS 账号"
                description="保存 Cloudflare 或阿里云 DNS API 凭证后，申请证书时可直接选择，到期自动续期时也会自动使用最新凭证。"
                action={
                  <Button variant="primary" icon={Plus} onClick={() => openCreateDnsModal(null)}>
                    添加 DNS 账号
                  </Button>
                }
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>账号名称</Th>
                    <Th>DNS 服务商</Th>
                    <Th>凭证摘要</Th>
                    <Th>关联证书</Th>
                    <Th>更新时间</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </THead>
                <TBody>
                  {dnsAccounts.map((acc) => {
                    const usedCount = certCountByDns[acc.id] || 0;
                    return (
                      <Tr key={acc.id}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <Cloud className="w-4 h-4 text-brand shrink-0" />
                            <span className="font-medium text-fg">{acc.name}</span>
                          </div>
                          {acc.remark && (
                            <div className="text-xs text-fg-3 mt-0.5 truncate max-w-xs">
                              {acc.remark}
                            </div>
                          )}
                        </Td>
                        <Td>
                          <Badge tone="brand">{providerLabel(acc.provider)}</Badge>
                        </Td>
                        <Td className="font-mono text-xs text-fg-2">
                          {dnsCredentialSummary(acc)}
                        </Td>
                        <Td>
                          <Badge tone={usedCount > 0 ? 'success' : 'neutral'}>
                            {usedCount} 张证书
                          </Badge>
                        </Td>
                        <Td className="text-xs text-fg-2 tabular-nums">
                          {formatDate(acc.updatedAt)}
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              icon={Edit2}
                              size="sm"
                              title="编辑 DNS 账号"
                              onClick={() => openEditDnsModal(acc)}
                            />
                            <IconButton
                              icon={Trash2}
                              tone="danger"
                              size="sm"
                              title="删除 DNS 账号"
                              onClick={() => handleDeleteDNSAccount(acc)}
                            />
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>
        )}
      </div>

      {/* Upload Manual PEM Modal */}
      <Modal
        open={manualOpen}
        wide
        title="手动导入 PEM 证书"
        onClose={() => setManualOpen(false)}
      >
        <form onSubmit={handleUploadManual} className="space-y-4">
          <Field label="证书备注名称">
            <Input
              value={manualForm.name}
              onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
              placeholder="留空则自动使用证书主域名"
            />
          </Field>

          <Field label="证书内容 (Fullchain PEM)" required>
            <Textarea
              mono
              required
              rows={5}
              value={manualForm.certPem}
              onChange={(e) => setManualForm({ ...manualForm, certPem: e.target.value })}
              placeholder="-----BEGIN CERTIFICATE-----"
            />
          </Field>

          <Field label="私钥内容 (Private Key PEM)" required>
            <Textarea
              mono
              required
              rows={5}
              value={manualForm.keyPem}
              onChange={(e) => setManualForm({ ...manualForm, keyPem: e.target.value })}
              placeholder="-----BEGIN PRIVATE KEY-----"
            />
          </Field>

          <ModalFooter>
            <Button variant="secondary" onClick={() => setManualOpen(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {submitting ? '正在校验保存...' : '保存证书'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* ACME Let's Encrypt Modal */}
      <Modal
        open={acmeOpen}
        wide
        title="申请 Let's Encrypt 免费证书 (ACME)"
        onClose={() => setAcmeOpen(false)}
      >
        <form onSubmit={handleIssueACME} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="证书名称">
              <Input
                value={acmeForm.name}
                onChange={(e) => setAcmeForm({ ...acmeForm, name: e.target.value })}
                placeholder="留空默认使用第一个域名"
              />
            </Field>

            <Field label="联系邮箱" required>
              <Input
                type="email"
                required
                value={acmeForm.email}
                onChange={(e) => setAcmeForm({ ...acmeForm, email: e.target.value })}
                placeholder="admin@example.com"
              />
            </Field>

            <Field
              label="申请域名（多个用逗号分隔，DNS 验证支持泛域名）"
              required
              className="md:col-span-2"
            >
              <Input
                mono
                required
                value={acmeForm.domainsText}
                onChange={(e) => setAcmeForm({ ...acmeForm, domainsText: e.target.value })}
                placeholder="example.com, *.example.com"
              />
            </Field>

            <Field label="域名验证方式" className="md:col-span-2">
              <Select
                value={acmeForm.challengeMode}
                onChange={(e) =>
                  setAcmeForm({
                    ...acmeForm,
                    challengeMode: e.target.value as 'dns' | 'http01',
                    dnsAccountId:
                      e.target.value === 'dns'
                        ? acmeForm.dnsAccountId || dnsAccounts[0]?.id || ''
                        : acmeForm.dnsAccountId,
                  })
                }
              >
                <option value="dns">
                  DNS-01 — 使用已保存 DNS 账号（支持泛域名，无需 80 端口，推荐）
                </option>
                <option value="http01">
                  HTTP-01 — 文件验证（需域名已解析到本机且公网 80 端口可达）
                </option>
              </Select>
            </Field>

            {acmeForm.challengeMode === 'dns' && (
              <div className="md:col-span-2">
                {dnsAccounts.length === 0 ? (
                  <Alert
                    tone="warning"
                    title="尚未配置 DNS 账号"
                    action={
                      <Button
                        size="sm"
                        variant="primary"
                        icon={Plus}
                        onClick={() => openCreateDnsModal('acme')}
                      >
                        立即添加
                      </Button>
                    }
                  >
                    请先添加一个 Cloudflare 或阿里云 DNS 账号，添加后可直接在下方选择并自动用于后续续期。
                  </Alert>
                ) : (
                  <Field
                    label="选择 DNS 账号"
                    required
                    hint="自动续期时会实时读取该账号的最新 API 凭证，后续更换 Token 只需修改账号即可。"
                  >
                    <div className="flex items-center gap-2">
                      <Select
                        wrapperClassName="flex-1"
                        value={acmeForm.dnsAccountId}
                        onChange={(e) =>
                          setAcmeForm({ ...acmeForm, dnsAccountId: e.target.value })
                        }
                      >
                        {dnsAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name}（{providerLabel(acc.provider)}）
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        icon={Plus}
                        onClick={() => openCreateDnsModal('acme')}
                      >
                        新建账号
                      </Button>
                    </div>
                  </Field>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-line p-3">
              <Switch
                checked={acmeForm.autoRenew}
                onChange={(v) => setAcmeForm({ ...acmeForm, autoRenew: v })}
                label="到期前 30 天自动续期（续期后自动重载 Nginx）"
              />
            </div>
            <div className="rounded-lg border border-line p-3">
              <Switch
                checked={acmeForm.staging}
                onChange={(v) => setAcmeForm({ ...acmeForm, staging: v })}
                label="使用 Let’s Encrypt 测试环境 (Staging)"
              />
            </div>
          </div>

          <ModalFooter>
            <Button variant="secondary" onClick={() => setAcmeOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={acmeForm.challengeMode === 'dns' && !acmeForm.dnsAccountId}
            >
              {submitting ? '正在向 Let’s Encrypt 验证签发...' : '立即申请证书'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Edit Certificate Settings Modal */}
      <Modal
        open={editCertOpen}
        title="编辑证书设置"
        description={editingCert ? `覆盖域名: ${editingCert.domains.join(', ')}` : undefined}
        onClose={() => {
          setEditCertOpen(false);
          setEditingCert(null);
        }}
      >
        <form onSubmit={handleSaveCertSettings} className="space-y-4">
          <Field label="证书名称" required>
            <Input
              required
              value={editCertForm.name}
              onChange={(e) => setEditCertForm({ ...editCertForm, name: e.target.value })}
            />
          </Field>

          {editingCert?.source === 'acme' && (
            <>
              <Field label="ACME 联系邮箱" required>
                <Input
                  type="email"
                  required
                  value={editCertForm.email}
                  onChange={(e) => setEditCertForm({ ...editCertForm, email: e.target.value })}
                />
              </Field>

              <Field label="续期验证方式">
                <Select
                  value={editCertForm.challengeMode}
                  onChange={(e) =>
                    setEditCertForm({
                      ...editCertForm,
                      challengeMode: e.target.value as 'dns' | 'http01' | 'keep',
                      dnsAccountId:
                        e.target.value === 'dns'
                          ? editCertForm.dnsAccountId || dnsAccounts[0]?.id || ''
                          : editCertForm.dnsAccountId,
                    })
                  }
                >
                  {!editingCert.dnsAccountId && editingCert.acmeChallenge !== 'http01' && (
                    <option value="keep">
                      保持当前旧内联凭证（{providerLabel(editingCert.acmeChallenge)}）
                    </option>
                  )}
                  <option value="dns">绑定已保存 DNS 账号（DNS-01）</option>
                  <option value="http01">HTTP-01 文件验证</option>
                </Select>
              </Field>

              {editCertForm.challengeMode === 'dns' && (
                <Field label="关联 DNS 账号" required>
                  {dnsAccounts.length === 0 ? (
                    <Alert
                      tone="warning"
                      title="暂无 DNS 账号"
                      action={
                        <Button
                          size="sm"
                          variant="primary"
                          icon={Plus}
                          onClick={() => openCreateDnsModal('editCert')}
                        >
                          立即添加
                        </Button>
                      }
                    >
                      请先添加一个 DNS 账号。
                    </Alert>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select
                        wrapperClassName="flex-1"
                        value={editCertForm.dnsAccountId}
                        onChange={(e) =>
                          setEditCertForm({ ...editCertForm, dnsAccountId: e.target.value })
                        }
                      >
                        {dnsAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name}（{providerLabel(acc.provider)}）
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        icon={Plus}
                        onClick={() => openCreateDnsModal('editCert')}
                      >
                        新建
                      </Button>
                    </div>
                  )}
                </Field>
              )}

              <div className="rounded-lg border border-line p-3">
                <Switch
                  checked={editCertForm.autoRenew}
                  onChange={(v) => setEditCertForm({ ...editCertForm, autoRenew: v })}
                  label="到期前 30 天自动续期（续期后自动重载 Nginx）"
                />
              </div>
            </>
          )}

          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setEditCertOpen(false);
                setEditingCert(null);
              }}
            >
              取消
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              保存修改
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Create / Edit DNS Account Modal */}
      <Modal
        open={dnsModalOpen}
        title={editingDnsId ? '编辑 DNS 账号' : '添加 DNS 账号'}
        description="保存后的 DNS 账号可在申请免费证书时直接选用，并自动用于到期续期"
        onClose={closeDnsModal}
      >
        <form onSubmit={handleSaveDNSAccount} className="space-y-4">
          <Field label="账号名称" required>
            <Input
              required
              value={dnsForm.name}
              onChange={(e) => setDnsForm({ ...dnsForm, name: e.target.value })}
              placeholder="例如：我的 Cloudflare 主账号"
            />
          </Field>

          <Field
            label="DNS 服务商"
            required
            hint={editingDnsInUse ? '当前账号已关联证书，无法切换服务商类型' : undefined}
          >
            <Select
              disabled={editingDnsInUse}
              value={dnsForm.provider}
              onChange={(e) => setDnsForm({ ...dnsForm, provider: e.target.value })}
            >
              <option value="cloudflare">Cloudflare（API Token）</option>
              <option value="alidns">阿里云 DNS（AccessKey）</option>
            </Select>
          </Field>

          {dnsForm.provider === 'cloudflare' && (
            <Field
              label="Cloudflare API Token"
              required={!editingDnsId}
              hint={
                editingDnsId
                  ? '留空则保持已保存的 API Token 不变；填入新值后会立即生效并用于后续自动续期'
                  : '建议创建仅授予目标域名 Zone:DNS:Edit 权限的 API Token'
              }
            >
              <Input
                mono
                required={!editingDnsId}
                type="password"
                value={dnsForm.cfApiToken}
                onChange={(e) => setDnsForm({ ...dnsForm, cfApiToken: e.target.value })}
                placeholder={
                  editingDnsId
                    ? '留空保持不变，或输入新的 API Token'
                    : '具有 Zone:DNS:Edit 权限的 API Token'
                }
              />
            </Field>
          )}

          {dnsForm.provider === 'alidns' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="阿里云 AccessKey ID"
                required={!editingDnsId}
                hint={editingDnsId ? '留空保持不变' : undefined}
              >
                <Input
                  mono
                  required={!editingDnsId}
                  value={dnsForm.aliKeyId}
                  onChange={(e) => setDnsForm({ ...dnsForm, aliKeyId: e.target.value })}
                  placeholder={editingDnsId ? '留空保持不变' : 'AccessKey ID'}
                />
              </Field>
              <Field
                label="阿里云 AccessKey Secret"
                required={!editingDnsId}
                hint={editingDnsId ? '留空保持不变' : undefined}
              >
                <Input
                  mono
                  required={!editingDnsId}
                  type="password"
                  value={dnsForm.aliKeySecret}
                  onChange={(e) => setDnsForm({ ...dnsForm, aliKeySecret: e.target.value })}
                  placeholder={editingDnsId ? '留空保持不变' : 'AccessKey Secret'}
                />
              </Field>
            </div>
          )}

          <Field label="备注">
            <Input
              value={dnsForm.remark}
              onChange={(e) => setDnsForm({ ...dnsForm, remark: e.target.value })}
              placeholder="可选：说明该账号管理的域名范围"
            />
          </Field>

          <ModalFooter>
            <Button variant="secondary" onClick={closeDnsModal}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {editingDnsId ? '保存修改' : '保存 DNS 账号'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
};
