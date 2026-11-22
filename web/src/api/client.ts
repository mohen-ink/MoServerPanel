export interface AuthStatus {
  initialized: boolean;
  authenticated: boolean;
  username: string;
  version: string;
}

export interface DiskInfo {
  mountpoint: string;
  fstype: string;
  total: number;
  used: number;
  usedPercent: number;
}

export interface SystemOverview {
  hostname: string;
  os: string;
  platform: string;
  arch: string;
  uptime: number;
  isAdmin: boolean;
  cpuCores: number;
  cpuPercent: number;
  memTotal: number;
  memUsed: number;
  memPercent: number;
  netBytesSent: number;
  netBytesRecv: number;
  netSentRate: number;
  netRecvRate: number;
  disks: DiskInfo[];
  collectedAt: string;
}

export interface NginxStatus {
  installed: boolean;
  running: boolean;
  pid: number;
  version: string;
  nginxDir: string;
  autoStart: boolean;
  siteCount: number;
  activeSite: number;
}

export interface ProxySite {
  id: string;
  name: string;
  enabled: boolean;
  domains: string[];
  listenPort: number;
  upstream: string;
  ssl: boolean;
  certId: string;
  forceHttps: boolean;
  webSocket: boolean;
  realIpHeaders: boolean;
  clientMaxBodySize: string;
  customConfig: string;
  createdAt: string;
  updatedAt: string;
}

export interface Certificate {
  id: string;
  name: string;
  source: 'manual' | 'acme';
  domains: string[];
  issuer: string;
  notBefore: string;
  notAfter: string;
  certPath: string;
  keyPath: string;
  acmeEmail?: string;
  acmeChallenge?: string;
  autoRenew: boolean;
  lastRenewAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface FirewallRule {
  id: string;
  winRuleName: string;
  name: string;
  protocol: string;
  port: string;
  action: string;
  remoteAddress: string;
  enabled: boolean;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListeningPort {
  protocol: string;
  localAddr: string;
  port: number;
  pid: number;
  processName: string;
  processPath: string;
  managedAllow: boolean;
}

export interface SystemFirewallRule {
  name: string;
  displayName: string;
  enabled: boolean;
  action: string;
  profile: string;
  group: string;
  protocol: string;
  localPort: string;
  remoteAddress: string;
  managed: boolean;
}

export interface SSHSession {
  id: string;
  remoteIp: string;
  username: string;
  mode: string;
  startedAt: string;
}

export interface SSHStatus {
  running: boolean;
  enabled: boolean;
  autoStart: boolean;
  listenAddr: string;
  port: number;
  username: string;
  passwordSet: boolean;
  defaultShell: string;
  workDir: string;
  enableSftp: boolean;
  activeSessions: number;
  hostFingerprint: string;
  sessions: SSHSession[];
}

export interface BanEntry {
  namespace: string;
  ip: string;
  failCount: number;
  bannedUntil: string;
}

export interface DashboardData {
  system: SystemOverview;
  nginx: NginxStatus;
  ssh: SSHStatus;
  firewall: {
    total: number;
    enabled: number;
    isAdmin: boolean;
  };
  certs: {
    total: number;
    expiringSoon: number;
  };
  serviceStatus: string;
  version: string;
}

export interface SettingsData {
  listenAddr: string;
  port: number;
  username: string;
  dataDir: string;
  version: string;
  isAdmin: boolean;
  serviceStatus: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  tagName: string;
  hasUpdate: boolean;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  publishedAt: string;
  assetName: string;
  assetSize: number;
  hasChecksum: boolean;
}

export interface UpdateStatus {
  state: 'idle' | 'downloading' | 'verifying' | 'replacing' | 'restarting' | 'done' | 'error';
  targetVersion?: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  message?: string;
  error?: string;
  restartMode?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || data?.message || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  // Auth
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  setup: (username: string, password: string) =>
    request<{ ok: boolean; username: string }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ ok: boolean; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),
  listBans: (namespace = '') =>
    request<{ items: BanEntry[] }>(`/api/security/bans${namespace ? `?namespace=${namespace}` : ''}`),
  unban: (namespace: string, ip: string) =>
    request<{ ok: boolean }>('/api/security/bans', {
      method: 'DELETE',
      body: JSON.stringify({ namespace, ip }),
    }),

  // Dashboard & Settings
  dashboard: () => request<DashboardData>('/api/dashboard'),
  getSettings: () => request<SettingsData>('/api/settings'),
  updateSettings: (listenAddr: string, port: number) =>
    request<{ ok: boolean; message: string }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ listenAddr, port }),
    }),

  // Firewall
  listFirewallRules: () => request<{ items: FirewallRule[]; isAdmin: boolean }>('/api/firewall/rules'),
  createFirewallRule: (payload: Partial<FirewallRule>) =>
    request<FirewallRule>('/api/firewall/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateFirewallRule: (id: string, payload: Partial<FirewallRule>) =>
    request<FirewallRule>(`/api/firewall/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  toggleFirewallRule: (id: string, enabled: boolean) =>
    request<FirewallRule>(`/api/firewall/rules/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  deleteFirewallRule: (id: string) =>
    request<{ ok: boolean }>(`/api/firewall/rules/${id}`, { method: 'DELETE' }),
  listListeningPorts: () => request<{ items: ListeningPort[]; isAdmin: boolean }>('/api/firewall/ports'),
  listSystemFirewallRules: () => request<{ items: SystemFirewallRule[] }>('/api/firewall/system-rules'),

  // Nginx
  nginxStatus: () => request<NginxStatus>('/api/nginx/status'),
  nginxStart: () => request<NginxStatus>('/api/nginx/start', { method: 'POST' }),
  nginxStop: () => request<NginxStatus>('/api/nginx/stop', { method: 'POST' }),
  nginxRestart: () => request<NginxStatus>('/api/nginx/restart', { method: 'POST' }),
  nginxReload: () => request<NginxStatus>('/api/nginx/reload', { method: 'POST' }),
  nginxTest: () => request<{ ok: boolean; output: string }>('/api/nginx/test', { method: 'POST' }),
  nginxSettings: (autoStart: boolean, customPath: string) =>
    request<NginxStatus>('/api/nginx/settings', {
      method: 'PUT',
      body: JSON.stringify({ autoStart, customPath }),
    }),
  nginxLogs: (type: 'access' | 'error', lines = 200) =>
    request<{ type: string; content: string }>(`/api/nginx/logs?type=${type}&lines=${lines}`),
  listNginxSites: () => request<{ items: ProxySite[]; status: NginxStatus }>('/api/nginx/sites'),
  createNginxSite: (payload: Partial<ProxySite>) =>
    request<ProxySite>('/api/nginx/sites', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateNginxSite: (id: string, payload: Partial<ProxySite>) =>
    request<ProxySite>(`/api/nginx/sites/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteNginxSite: (id: string) =>
    request<{ ok: boolean }>(`/api/nginx/sites/${id}`, { method: 'DELETE' }),
  previewNginxSite: (id: string) =>
    request<{ config: string }>(`/api/nginx/sites/${id}/preview`),

  // Certificates
  listCerts: () => request<{ items: Certificate[] }>('/api/certs'),
  uploadManualCert: (payload: { name: string; certPem: string; keyPem: string }) =>
    request<Certificate>('/api/certs/manual', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  issueACMECert: (payload: {
    name: string;
    domains: string[];
    email: string;
    challenge: string;
    providerConfig?: Record<string, string>;
    autoRenew: boolean;
    staging?: boolean;
  }) =>
    request<Certificate>('/api/certs/acme', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  renewCert: (id: string) => request<Certificate>(`/api/certs/${id}/renew`, { method: 'POST' }),
  deleteCert: (id: string) => request<{ ok: boolean }>(`/api/certs/${id}`, { method: 'DELETE' }),

  // SSH
  sshStatus: () => request<SSHStatus>('/api/ssh/status'),
  sshUpdateConfig: (payload: {
    autoStart: boolean;
    listenAddr: string;
    port: number;
    username: string;
    password?: string;
    defaultShell: string;
    workDir: string;
    enableSftp: boolean;
  }) =>
    request<SSHStatus>('/api/ssh/config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  sshStart: () => request<SSHStatus>('/api/ssh/start', { method: 'POST' }),
  sshStop: () => request<SSHStatus>('/api/ssh/stop', { method: 'POST' }),
  sshKickSession: (id: string) =>
    request<{ ok: boolean }>(`/api/ssh/sessions/${id}/kick`, { method: 'POST' }),

  // Self-update (GitHub Releases)
  updateCheck: () => request<UpdateCheckResult>('/api/update/check'),
  updateStatus: () => request<UpdateStatus>('/api/update/status'),
  updateApply: () => request<UpdateStatus>('/api/update/apply', { method: 'POST' }),
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins} 分钟`;
  return `${mins} 分钟`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}
