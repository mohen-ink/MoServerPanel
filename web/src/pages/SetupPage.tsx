import React, { useState } from 'react';
import { Server, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/UI';

export const SetupPage: React.FC<{ onDone: (username: string) => void }> = ({ onDone }) => {
  const { showToast } = useToast();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      showToast('error', '密码长度至少需要 8 位');
      return;
    }
    if (password !== confirm) {
      showToast('error', '两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const res = await api.setup(username.trim(), password);
      showToast('success', '管理员账号初始化完成！');
      onDone(res.username);
    } catch (err: any) {
      showToast('error', err.message || '初始化失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">首次初始化</h1>
            <p className="text-xs text-slate-400">设置 WinServerPanel 管理员账号</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">管理员用户名</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">登录密码（至少 8 位）</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
              placeholder="请输入强密码"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">确认密码</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
              placeholder="再次输入密码"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm transition cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            {loading ? '正在初始化...' : '完成初始化并进入面板'}
          </button>
        </form>
      </div>
    </div>
  );
};
