import React, { useState } from 'react';
import { Lock, ShieldCheck, User } from 'lucide-react';
import { api } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Button, Field, Input, useToast } from '../components/UI';

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
    <AuthLayout title="初始化管理员账号" subtitle="设置 MoServerPanel 管理员账号">
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="管理员用户名">
          <Input
            icon={User}
            type="text"
            required
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
          />
        </Field>

        <Field label="登录密码（至少 8 位）">
          <Input
            icon={Lock}
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入强密码"
          />
        </Field>

        <Field label="确认密码">
          <Input
            icon={Lock}
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="再次输入密码"
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          icon={ShieldCheck}
          loading={loading}
          className="w-full"
        >
          {loading ? '正在初始化...' : '完成初始化并进入面板'}
        </Button>
      </form>
    </AuthLayout>
  );
};
