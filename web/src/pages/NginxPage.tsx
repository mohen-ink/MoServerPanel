import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Edit2,
  FileText,
  Globe,
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
import {
  Badge,
  Button,
  Card,
  CodeBlock,
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
  const confirmDialog = useConfirm();
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
    const ok = await confirmDialog({
      title: '删除反代站点',
      description: `确认删除反代站点「${s.name}」？此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
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
    <div>
      <PageHeader
        title="Nginx 反向代理"
        description={`内嵌托管 ${status?.version || 'Nginx'} · 配置修改自动校验并在失败时回滚`}
        actions={
          <Button variant="primary" icon={Plus} onClick={openCreate}>
            新建反代站点
          </Button>
        }
      />

      <div className="space-y-4">
        {/* Nginx Service Control Bar */}
        <Card bodyClassName="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <StatusBadge active={!!status?.running} />
            <div className="text-xs text-fg-2">
              PID:{' '}
              <span className="font-mono text-fg tabular-nums">
                {status?.running ? status.pid : '-'}
              </span>
            </div>
            <Switch
              checked={!!status?.autoStart}
              onChange={toggleAutoStart}
              label="随面板自启"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!status?.running ? (
              <Button
                size="sm"
                variant="primary"
                icon={Play}
                disabled={busyAction}
                onClick={() => runAction('启动', api.nginxStart)}
              >
                启动
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={RefreshCw}
                  disabled={busyAction}
                  onClick={() => runAction('重载配置', api.nginxReload)}
                >
                  热重载
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={RotateCw}
                  disabled={busyAction}
                  onClick={() => runAction('重启', api.nginxRestart)}
                >
                  重启
                </Button>
                <Button
                  size="sm"
                  variant="danger-outline"
                  icon={Square}
                  disabled={busyAction}
                  onClick={() => runAction('停止', api.nginxStop)}
                >
                  停止
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={CheckCircle2}
              disabled={busyAction}
              onClick={() => runAction('校验配置', api.nginxTest)}
            >
              nginx -t
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={FileText}
              onClick={() => openLogs('error')}
            >
              日志
            </Button>
          </div>
        </Card>

        {/* Sites Table */}
        <Card noPadding>
          {sites.length === 0 ? (
            <EmptyState
              icon={Globe}
              title="暂无反向代理站点"
              description="暂无反向代理站点，点击右上角「新建反代站点」开始配置。"
              action={
                <Button variant="primary" icon={Plus} onClick={openCreate}>
                  新建反代站点
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>站点名称</Th>
                  <Th>域名 / 监听端口</Th>
                  <Th>目标上游 (Upstream)</Th>
                  <Th>特性</Th>
                  <Th>状态</Th>
                  <Th align="right">操作</Th>
                </tr>
              </THead>
              <TBody>
                {sites.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium text-fg">{s.name}</Td>
                    <Td>
                      <div className="font-mono text-[12.5px] text-fg">
                        {s.domains && s.domains.length > 0 ? s.domains.join(', ') : '* (任意域名)'}
                      </div>
                      <div className="text-xs text-fg-2 font-mono mt-0.5">:{s.listenPort}</div>
                    </Td>
                    <Td className="font-mono text-[12.5px] text-fg">{s.upstream}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {s.ssl && (
                          <Badge tone="success" icon={Lock}>
                            HTTPS
                          </Badge>
                        )}
                        {s.webSocket && <Badge tone="brand">WS</Badge>}
                        {s.forceHttps && <Badge tone="neutral">301→HTTPS</Badge>}
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge active={s.enabled} activeText="已启用" inactiveText="已停用" />
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton
                          icon={ShieldPlus}
                          tone="brand"
                          size="sm"
                          title={`放行防火墙 ${s.listenPort} 端口`}
                          onClick={() => handleQuickAllowPort(s)}
                        />
                        <IconButton
                          icon={Code2}
                          size="sm"
                          title="查看生成配置"
                          onClick={() => handlePreview(s)}
                        />
                        <IconButton
                          icon={Edit2}
                          size="sm"
                          title="编辑"
                          onClick={() => openEdit(s)}
                        />
                        <IconButton
                          icon={Trash2}
                          tone="danger"
                          size="sm"
                          title="删除"
                          onClick={() => handleDeleteSite(s)}
                        />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
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
            <Field label="站点名称" required>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：我的 API 服务"
              />
            </Field>

            <Field label="监听端口" required>
              <Input
                mono
                type="number"
                required
                min={1}
                max={65535}
                value={form.listenPort}
                onChange={(e) => setForm({ ...form, listenPort: Number(e.target.value) })}
              />
            </Field>

            <Field
              label="绑定域名（多个用逗号或空格分隔，留空表示按端口匹配任意域名）"
              className="md:col-span-2"
            >
              <Input
                mono
                value={form.domainsText}
                onChange={(e) => setForm({ ...form, domainsText: e.target.value })}
                placeholder="app.example.com, www.example.com"
              />
            </Field>

            <Field label="反向代理目标地址 (Upstream)" required className="md:col-span-2">
              <Input
                mono
                required
                value={form.upstream}
                onChange={(e) => setForm({ ...form, upstream: e.target.value })}
                placeholder="http://127.0.0.1:3000"
              />
            </Field>
          </div>

          {/* HTTPS Section */}
          <div className="p-4 rounded-lg bg-surface-2/50 border border-line space-y-3">
            <Switch
              checked={form.ssl}
              onChange={(checked) =>
                setForm({
                  ...form,
                  ssl: checked,
                  listenPort:
                    checked && form.listenPort === 80
                      ? 443
                      : !checked && form.listenPort === 443
                        ? 80
                        : form.listenPort,
                })
              }
              label="启用 HTTPS (SSL/TLS)"
            />
            {form.ssl && (
              <div className="space-y-3 pt-1">
                <Field label="选择 SSL 证书" required>
                  <Select
                    required
                    value={form.certId}
                    onChange={(e) => setForm({ ...form, certId: e.target.value })}
                  >
                    <option value="">-- 请先在「SSL 证书」页添加证书 --</option>
                    {certs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.domains.join(', ')})
                      </option>
                    ))}
                  </Select>
                </Field>

                <Switch
                  checked={form.forceHttps}
                  onChange={(v) => setForm({ ...form, forceHttps: v })}
                  label="同时监听 80 端口并强制 301 跳转 HTTPS"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-line p-3">
              <Switch
                checked={form.webSocket}
                onChange={(v) => setForm({ ...form, webSocket: v })}
                label="支持 WebSocket 升级"
              />
            </div>
            <div className="rounded-lg border border-line p-3">
              <Switch
                checked={form.realIpHeaders}
                onChange={(v) => setForm({ ...form, realIpHeaders: v })}
                label="透传 Host / 真实 IP 请求头"
              />
            </div>
            <div className="rounded-lg border border-line p-3">
              <Switch
                checked={form.enabled}
                onChange={(v) => setForm({ ...form, enabled: v })}
                label="启用该站点"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="最大请求体大小 (client_max_body_size)">
              <Input
                mono
                value={form.clientMaxBodySize}
                onChange={(e) => setForm({ ...form, clientMaxBodySize: e.target.value })}
                placeholder="50m"
              />
            </Field>
          </div>

          <Field label="高级：附加 Nginx server 块指令（可选）">
            <Textarea
              mono
              rows={3}
              value={form.customConfig}
              onChange={(e) => setForm({ ...form, customConfig: e.target.value })}
              placeholder="# 例如：add_header X-Frame-Options SAMEORIGIN;"
            />
          </Field>

          <ModalFooter>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {saving ? '校验并保存...' : '保存并重载 Nginx'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Preview Config Modal */}
      <Modal
        open={previewConf !== null}
        wide
        title="生成的 Nginx 站点配置"
        onClose={() => setPreviewConf(null)}
      >
        <CodeBlock>{previewConf}</CodeBlock>
      </Modal>

      {/* Logs Modal */}
      <Modal open={logsModal} wide title="Nginx 运行日志" onClose={() => setLogsModal(false)}>
        <div className="space-y-4">
          <Tabs
            value={logType}
            onChange={(k) => openLogs(k as 'access' | 'error')}
            items={[
              { key: 'error', label: 'error.log' },
              { key: 'access', label: 'access.log' },
            ]}
          />
          <CodeBlock wrap maxHeight="55vh">
            {logContent}
          </CodeBlock>
        </div>
      </Modal>
    </div>
  );
};
