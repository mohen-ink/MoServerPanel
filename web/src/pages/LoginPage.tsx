import React, { useState } from 'react';
import { Lock, User } from 'lucide-react';
import { api } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Button, Field, Input, useToast } from '../components/UI';

export const LoginPage: React.FC<{ onSuccess: (username: string) => void }> = ({ onSuccess }) => {
  const { showToast } = useToast();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.login(username.trim(), password);
      onSuccess(res.username);
    } catch (err: any) {
      showToast('error', err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="登录控制台" subtitle="使用管理员账号登录 MoServerPanel">
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="用户名">
          <Input
            icon={User}
            type="text"
            required
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>

        <Field label="密码">
          <Input
            icon={Lock}
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入管理员密码"
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          icon={Lock}
          loading={loading}
          className="w-full"
        >
          {loading ? '登录中...' : '登录'}
        </Button>
      </form>
    </AuthLayout>
  );
};
