'use client';

import { useState } from 'react';
import { Form, Input, Button, Checkbox, App, ConfigProvider } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';

export default function LoginPage() {
    const [loading, setLoading] = useState(false);
    const { message } = App.useApp();

    const onFinish = async (values: { username: string; password: string; remember: boolean }) => {
        setLoading(true);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.message || '登录失败，请稍后重试');
            }
            message.success('登录成功，正在跳转…');
            setTimeout(() => {
                window.location.href = '/';
            }, 800);
        } catch (err: unknown) {
            message.error(err instanceof Error ? err.message : '登录失败，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ConfigProvider locale={zhCN}>
            <App>
                <div
                    style={{
                        minHeight: '100vh',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 50%, #eef2ff 100%)',
                        padding: '16px',
                    }}
                >
                    <div className="w-full max-w-[400px] animate-fade-in-up">
                        {/* 卡片 */}
                        <div
                            style={{
                                background: 'rgba(255, 255, 255, 0.85)',
                                backdropFilter: 'blur(20px)',
                                borderRadius: '20px',
                                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.06)',
                                border: '1px solid rgba(255, 255, 255, 0.6)',
                                padding: '40px 32px',
                            }}
                        >
                            {/* Logo & 标题 */}
                            <div style={{ textAlign: 'center', marginBottom: '36px' }}>
                                <h1
                                    style={{
                                        fontSize: '24px',
                                        fontWeight: 700,
                                        color: '#111827',
                                        margin: 0,
                                    }}
                                >
                                    欢迎回来
                                </h1>
                                <p
                                    style={{
                                        fontSize: '14px',
                                        color: '#6b7280',
                                        margin: '8px 0 0',
                                    }}
                                >
                                    登录您的账户
                                </p>
                            </div>

                            {/* 表单 */}
                            <Form
                                name="login"
                                onFinish={onFinish}
                                autoComplete="off"
                                layout="vertical"
                                requiredMark={false}
                                size="large"
                            >
                                <Form.Item
                                    name="username"
                                    label="用户名"
                                    rules={[
                                        { required: true, message: '请输入用户名' },
                                    ]}
                                >
                                    <Input
                                        prefix={<UserOutlined style={{ color: '#9ca3af' }} />}
                                        placeholder="请输入用户名"
                                    />
                                </Form.Item>

                                <Form.Item
                                    name="password"
                                    label="密码"
                                    rules={[
                                        { required: true, message: '请输入密码' },
                                        { min: 6, message: '密码长度至少 6 位' },
                                    ]}
                                >
                                    <Input.Password
                                        prefix={<LockOutlined style={{ color: '#9ca3af' }} />}
                                        placeholder="输入密码"
                                    />
                                </Form.Item>

                                <Form.Item>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Form.Item name="remember" valuePropName="checked" noStyle>
                                            <Checkbox>记住我</Checkbox>
                                        </Form.Item>
                                        <a style={{ color: '#3b82f6', fontSize: '14px' }}>忘记密码？</a>
                                    </div>
                                </Form.Item>

                                <Form.Item style={{ marginBottom: '16px' }}>
                                    <Button
                                        type="primary"
                                        htmlType="submit"
                                        loading={loading}
                                        block
                                        style={{
                                            height: '44px',
                                            borderRadius: '12px',
                                            fontWeight: 500,
                                            background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                                            boxShadow: '0 6px 16px rgba(59, 130, 246, 0.3)',
                                        }}
                                    >
                                        登录
                                    </Button>
                                </Form.Item>
                            </Form>

                            {/* 分隔线 */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    margin: '20px 0',
                                    color: '#9ca3af',
                                    fontSize: '12px',
                                }}
                            >
                                <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                                <span style={{ padding: '0 12px' }}>或</span>
                                <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                            </div>

                            {/* 注册入口 */}
                            <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px', margin: 0 }}>
                                还没有账户？{' '}
                                <a
                                    href="/register"
                                    style={{
                                        color: '#3b82f6',
                                        fontWeight: 500,
                                        textDecoration: 'none',
                                    }}
                                >
                                    立即注册
                                </a>
                            </p>
                        </div>

                        {/* 底部提示 */}
                        <p
                            style={{
                                textAlign: 'center',
                                fontSize: '12px',
                                color: '#9ca3af',
                                marginTop: '24px',
                            }}
                        >
                            登录即表示您同意{' '}
                            <a href="#" style={{ color: '#6b7280' }}>
                                服务条款
                            </a>{' '}
                            和{' '}
                            <a href="#" style={{ color: '#6b7280' }}>
                                隐私政策
                            </a>
                        </p>
                    </div>
                </div>
            </App>
        </ConfigProvider>
    );
}
