import React from 'react';
import { Globe, Server, Shield, TerminalSquare } from 'lucide-react';

const features = [
  { icon: Shield, text: '防火墙端口可视化管理' },
  { icon: Globe, text: 'Nginx 反向代理与自动 SSL 证书' },
  { icon: TerminalSquare, text: '内置 SSH/SFTP 与网页终端' },
];

export const AuthLayout: React.FC<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
}> = ({ title, subtitle, children }) => (
  <div className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-canvas text-fg">
    {/* Left Brand Showcase */}
    <div className="hidden lg:flex flex-col justify-between relative overflow-hidden bg-zinc-950 text-white p-12 border-r border-zinc-900">
      <div
        className="absolute inset-0 opacity-[0.15] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.35) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
      <div className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-[#3b82f6]/30 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-[#6366f1]/25 blur-[120px] pointer-events-none" />

      <div className="relative flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand to-[#6366f1] text-white grid place-items-center shadow-sm">
          <Server className="w-4 h-4" />
        </div>
        <span className="text-base font-semibold tracking-tight text-white">MoServerPanel</span>
      </div>

      <div className="relative my-auto py-12">
        <h2 className="text-3xl font-semibold tracking-tight leading-tight text-white">
          轻量、安全的
          <br />
          Windows 服务器管理面板
        </h2>
        <p className="text-sm text-zinc-400 mt-3 max-w-md leading-relaxed">
          开箱即用的 Windows 服务器运维控制台，集成端口防火墙、反向代理与加密终端能力。
        </p>

        <div className="mt-8 space-y-3.5">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.text} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-white/10 border border-white/10 grid place-items-center shrink-0 text-white">
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-sm text-zinc-300">{f.text}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative text-xs text-zinc-500">© MoServerPanel</div>
    </div>

    {/* Right Form Area */}
    <div className="flex items-center justify-center p-6">
      <div className="w-full max-w-[380px]">
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand to-[#6366f1] text-white grid place-items-center shadow-sm">
            <Server className="w-4 h-4" />
          </div>
          <span className="text-base font-semibold tracking-tight text-fg">MoServerPanel</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        <p className="text-[13px] text-fg-2 mt-1.5 mb-8">{subtitle}</p>

        {children}
      </div>
    </div>
  </div>
);
