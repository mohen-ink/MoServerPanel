import React, { useEffect, useState } from 'react';
import {
  Edit2,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { api, FirewallRule, ListeningPort, SystemFirewallRule } from '../api/client';
import {
  AdminBanner,
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
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
  Th,
  THead,
  Tr,
  useConfirm,
  useToast,
} from '../components/UI';

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
  const confirmDialog = useConfirm();
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
    const ok = await confirmDialog({
      title: '删除防火墙规则',
      description: `确认删除防火墙规则「${r.name}」(端口 ${r.port})？此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
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
    <div>
      <PageHeader
        title="端口通行（Windows 防火墙）"
        description="可视化管理入站放行/拦截规则、查看本机监听端口与系统规则"
        actions={
          <>
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() =>
                subTab === 'managed'
                  ? loadManaged()
                  : subTab === 'ports'
                    ? loadPorts()
                    : loadSystem()
              }
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => openCreate()}>
              添加端口规则
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        <AdminBanner isAdmin={isAdmin} />

        <Tabs
          value={subTab}
          onChange={(k) => setSubTab(k as 'managed' | 'ports' | 'system')}
          items={[
            { key: 'managed', label: '面板管理规则', icon: Shield, count: rules.length },
            { key: 'ports', label: '本机监听端口与进程', icon: Radio },
            { key: 'system', label: '系统全部入站规则', icon: ShieldCheck },
          ]}
        />

        {/* Tab 1: Managed Rules */}
        {subTab === 'managed' && (
          <Card noPadding>
            {loading && rules.length === 0 ? (
              <Loading text="正在加载防火墙规则..." />
            ) : rules.length === 0 ? (
              <EmptyState
                icon={Shield}
                title="暂无面板管理的端口规则"
                description="暂无面板管理的端口规则，点击右上角「添加端口规则」开始放行端口。"
                action={
                  <Button variant="primary" icon={Plus} onClick={() => openCreate()}>
                    添加端口规则
                  </Button>
                }
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>规则名称</Th>
                    <Th>协议</Th>
                    <Th>端口</Th>
                    <Th>策略</Th>
                    <Th>来源 IP</Th>
                    <Th>状态</Th>
                    <Th>备注</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </THead>
                <TBody>
                  {rules.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium text-fg">{r.name}</Td>
                      <Td>
                        <Badge tone="neutral">{r.protocol}</Badge>
                      </Td>
                      <Td className="font-mono text-[12.5px] font-semibold tabular-nums">
                        {r.port}
                      </Td>
                      <Td>
                        {r.action === 'Allow' ? (
                          <Badge tone="success">允许放行</Badge>
                        ) : (
                          <Badge tone="danger">拒绝拦截</Badge>
                        )}
                      </Td>
                      <Td className="font-mono text-[12.5px] text-fg-2">
                        {r.remoteAddress || 'Any'}
                      </Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => handleToggle(r)}
                          className="cursor-pointer"
                        >
                          <StatusBadge
                            active={r.enabled}
                            activeText="已启用"
                            inactiveText="已禁用"
                          />
                        </button>
                      </Td>
                      <Td className="text-fg-2 text-xs max-w-[200px] truncate">
                        {r.remark || '-'}
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            icon={Edit2}
                            title="编辑"
                            size="sm"
                            onClick={() => openEdit(r)}
                          />
                          <IconButton
                            icon={Trash2}
                            title="删除"
                            tone="danger"
                            size="sm"
                            onClick={() => handleDelete(r)}
                          />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        )}

        {/* Tab 2: Listening Ports */}
        {subTab === 'ports' && (
          <Card noPadding>
            {loading && ports.length === 0 ? (
              <Loading text="正在扫描本机监听端口..." />
            ) : ports.length === 0 ? (
              <EmptyState
                icon={Radio}
                title="暂未检测到监听端口"
                description="当前没有检测到正在监听的本机端口。"
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>协议</Th>
                    <Th>监听地址</Th>
                    <Th>端口</Th>
                    <Th>进程</Th>
                    <Th>PID</Th>
                    <Th>面板放行状态</Th>
                    <Th align="right">快捷操作</Th>
                  </tr>
                </THead>
                <TBody>
                  {ports.map((p, idx) => (
                    <Tr key={`${p.protocol}-${p.localAddr}-${p.port}-${idx}`}>
                      <Td>
                        <Badge tone="neutral">{p.protocol}</Badge>
                      </Td>
                      <Td className="font-mono text-[12.5px] text-fg-2">{p.localAddr}</Td>
                      <Td className="font-mono text-[12.5px] font-semibold tabular-nums">
                        {p.port}
                      </Td>
                      <Td>
                        <div className="font-medium text-fg">{p.processName}</div>
                        {p.processPath && (
                          <div
                            className="text-xs text-fg-3 truncate max-w-xs mt-0.5"
                            title={p.processPath}
                          >
                            {p.processPath}
                          </div>
                        )}
                      </Td>
                      <Td className="font-mono text-[12.5px] text-fg-2 tabular-nums">{p.pid}</Td>
                      <Td>
                        {p.managedAllow ? (
                          <StatusBadge active={true} activeText="已放行" />
                        ) : (
                          <span className="text-xs text-fg-3">未在面板放行</span>
                        )}
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        {!p.managedAllow && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={ShieldCheck}
                            onClick={() =>
                              openCreate({
                                name: `${p.processName.replace('.exe', '')}-${p.port}`,
                                protocol: p.protocol,
                                port: String(p.port),
                                action: 'Allow',
                                remark: `快速放行进程 ${p.processName} (PID ${p.pid})`,
                              })
                            }
                          >
                            一键放行
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        )}

        {/* Tab 3: System Inbound Rules */}
        {subTab === 'system' && (
          <div className="space-y-4">
            <div className="max-w-sm">
              <Input
                icon={Search}
                value={sysSearch}
                onChange={(e) => setSysSearch(e.target.value)}
                placeholder="搜索规则名、端口、协议或分组..."
              />
            </div>

            <Card noPadding>
              {loading ? (
                <Loading text="正在读取 Windows 防火墙系统规则..." />
              ) : filteredSys.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="没有匹配的系统规则"
                  description="尝试调整搜索关键词。"
                />
              ) : (
                <Table maxHeight="600px">
                  <THead>
                    <tr>
                      <Th>显示名称</Th>
                      <Th>协议</Th>
                      <Th>本地端口</Th>
                      <Th>策略</Th>
                      <Th>状态</Th>
                      <Th>配置集</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {filteredSys.slice(0, 300).map((r) => (
                      <Tr key={r.name}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <span className="text-fg">{r.displayName || r.name}</span>
                            {r.managed && <Badge tone="brand">面板管理</Badge>}
                          </div>
                        </Td>
                        <Td>
                          <Badge tone="neutral">{r.protocol}</Badge>
                        </Td>
                        <Td className="font-mono text-[12.5px] text-fg">{r.localPort}</Td>
                        <Td>
                          {r.action === 'Allow' ? (
                            <Badge tone="success">{r.action}</Badge>
                          ) : (
                            <Badge tone="danger">{r.action}</Badge>
                          )}
                        </Td>
                        <Td>
                          <StatusBadge
                            active={r.enabled}
                            activeText="启用"
                            inactiveText="禁用"
                          />
                        </Td>
                        <Td className="text-xs text-fg-2">{r.profile}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        title={editingId ? '编辑端口规则' : '添加端口通行规则'}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="规则名称" className="md:col-span-2">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：放行 Web HTTPS"
              />
            </Field>

            <Field label="协议">
              <Select
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value })}
              >
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
                <option value="Any">TCP + UDP</option>
              </Select>
            </Field>

            <Field label="动作策略">
              <Select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
              >
                <option value="Allow">允许放行 (Allow)</option>
                <option value="Block">拒绝拦截 (Block)</option>
              </Select>
            </Field>

            <Field label="端口 / 端口段" required className="md:col-span-2">
              <Input
                mono
                required
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                placeholder="示例：80、443、8000-8010 或 80,443"
              />
            </Field>

            <Field
              label="允许的来源 IP / CIDR（留空或 Any 表示全部）"
              className="md:col-span-2"
            >
              <Input
                mono
                value={form.remoteAddress}
                onChange={(e) => setForm({ ...form, remoteAddress: e.target.value })}
                placeholder="Any 或 192.168.1.0/24, 1.2.3.4"
              />
            </Field>

            <Field label="备注" className="md:col-span-2">
              <Input
                value={form.remark}
                onChange={(e) => setForm({ ...form, remark: e.target.value })}
                placeholder="可选备注说明"
              />
            </Field>
          </div>

          <Switch
            checked={form.enabled}
            onChange={(v) => setForm({ ...form, enabled: v })}
            label="创建后立即启用此规则"
          />

          <ModalFooter>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {submitting ? '正在应用...' : '保存并应用'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
};
