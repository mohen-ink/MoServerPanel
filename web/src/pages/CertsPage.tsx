import React, { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, Certificate, formatDate } from '../api/client';
import {
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
  Switch,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  useConfirm,
  useToast,
} from '../components/UI';

export const CertsPage: React.FC = () => {
  const { showToast } = useToast();
  const confirmDialog = useConfirm();
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
      load();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

  return (
    <div>
      <PageHeader
        title="SSL 证书管理"
        description="支持手动导入 PEM 证书或 Let’s Encrypt 自动签发（到期前 30 天自动续期）"
        actions={
          <>
            <Button variant="secondary" icon={Upload} onClick={() => setManualOpen(true)}>
              手动上传证书
            </Button>
            <Button variant="primary" icon={Sparkles} onClick={() => setAcmeOpen(true)}>
              申请免费证书 (ACME)
            </Button>
          </>
        }
      />

      <Card noPadding>
        {certs.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="暂无 SSL 证书"
            description="暂无 SSL 证书，点击右上角上传已有证书或申请 Let’s Encrypt 免费证书。"
            action={
              <Button variant="primary" icon={Sparkles} onClick={() => setAcmeOpen(true)}>
                申请免费证书 (ACME)
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>证书名称</Th>
                <Th>覆盖域名</Th>
                <Th>来源</Th>
                <Th>颁发机构</Th>
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
                      </div>
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
                      {c.source === 'acme' ? (
                        <Badge tone="success">ACME ({c.acmeChallenge})</Badge>
                      ) : (
                        <Badge tone="neutral">手动导入</Badge>
                      )}
                    </Td>
                    <Td className="text-xs text-fg-2">{c.issuer || '-'}</Td>
                    <Td>
                      <div className="text-xs text-fg tabular-nums">{formatDate(c.notAfter)}</div>
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
                          icon={Trash2}
                          tone="danger"
                          size="sm"
                          title="删除"
                          onClick={() => handleDelete(c)}
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

            <Field label="申请域名（多个用逗号分隔）" required className="md:col-span-2">
              <Input
                mono
                required
                value={acmeForm.domainsText}
                onChange={(e) => setAcmeForm({ ...acmeForm, domainsText: e.target.value })}
                placeholder="app.example.com"
              />
            </Field>

            <Field label="域名验证方式" className="md:col-span-2">
              <Select
                value={acmeForm.challenge}
                onChange={(e) => setAcmeForm({ ...acmeForm, challenge: e.target.value })}
              >
                <option value="http01">
                  HTTP-01 文件验证（需域名已解析到本机且公网 80 端口可达）
                </option>
                <option value="cloudflare">
                  DNS-01 — Cloudflare API Token（支持泛域名，无需 80 端口）
                </option>
                <option value="alidns">DNS-01 — 阿里云 DNS（支持泛域名，无需 80 端口）</option>
              </Select>
            </Field>

            {acmeForm.challenge === 'cloudflare' && (
              <Field label="Cloudflare API Token" required className="md:col-span-2">
                <Input
                  mono
                  required
                  type="password"
                  value={acmeForm.cfApiToken}
                  onChange={(e) => setAcmeForm({ ...acmeForm, cfApiToken: e.target.value })}
                  placeholder="具有 Zone:DNS:Edit 权限的 API Token"
                />
              </Field>
            )}

            {acmeForm.challenge === 'alidns' && (
              <>
                <Field label="阿里云 AccessKey ID" required>
                  <Input
                    mono
                    required
                    value={acmeForm.aliKeyId}
                    onChange={(e) => setAcmeForm({ ...acmeForm, aliKeyId: e.target.value })}
                  />
                </Field>
                <Field label="阿里云 AccessKey Secret" required>
                  <Input
                    mono
                    required
                    type="password"
                    value={acmeForm.aliKeySecret}
                    onChange={(e) => setAcmeForm({ ...acmeForm, aliKeySecret: e.target.value })}
                  />
                </Field>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-line p-3">
              <Switch
                checked={acmeForm.autoRenew}
                onChange={(v) => setAcmeForm({ ...acmeForm, autoRenew: v })}
                label="到期前 30 天自动续期"
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
            <Button type="submit" variant="primary" loading={submitting}>
              {submitting ? '正在向 Let’s Encrypt 验证签发...' : '立即申请证书'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
};
