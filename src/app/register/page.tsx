'use client';

import { useState } from 'react';
import { Form, Input, Button, Upload, App } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, CameraOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';

export default function RegisterPage() {
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [form] = Form.useForm();

    const onFinish = async (values: any) => {
        setLoading(true);
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: values.username,
                    password: values.password,
                    email: values.email,
                    user_pic: fileList[0]?.url || null,
                }),
            })
            const data = await res.json();
            if (data.success) {
                message.success('注册成功，正在跳转…');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 800);
            } else {
                message.error(data.message || '注册失败，请稍后重试');
            }

        } catch (error) {
            message.error('注册请求失败');
        } finally {
            setLoading(false);
        }


    };

    // 头像上传前校验：文件类型 + 大小
    const beforeUpload = (file: File) => {
        const isImage = file.type.startsWith('image/');
        if (!isImage) {
            message.error('只能上传图片文件');
            return false;
        }
        const isLt2M = file.size / 1024 / 1024 < 2;
        if (!isLt2M) {
            message.error('图片大小不能超过 2MB');
            return false;
        }
        return true;
    };

    // 头像选择后：预览 + 更新列表
    const handleChange = (info: { file: UploadFile; fileList: UploadFile[] }) => {
        let newFileList = [...info.fileList].slice(-1);
        newFileList = newFileList.map((file) => {
            if (file.originFileObj) {
                file.url = URL.createObjectURL(file.originFileObj);
            }
            return file;
        });

        // 上传被 beforeUpload 拒绝时清空
        if (info.file.status === 'error' || info.file.error) {
            newFileList = [];
        }

        setFileList(newFileList);
    };

    return (
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
                    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', margin: 0 }}>
                            创建账户
                        </h1>
                        <p style={{ fontSize: '14px', color: '#6b7280', margin: '8px 0 0' }}>
                            注册您的 AI Chat 账户
                        </p>
                    </div>

                    {/* 头像上传 */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
                        <Upload
                            listType="picture-circle"
                            beforeUpload={beforeUpload}
                            onChange={handleChange}
                            fileList={fileList}
                            accept="image/*"
                            maxCount={1}
                            showUploadList={false}
                        >
                            {fileList.length > 0 && fileList[0].url ? (
                                <img
                                    src={fileList[0].url}
                                    alt="avatar"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                                />
                            ) : (
                                <div>
                                    <CameraOutlined style={{ fontSize: '24px', color: '#9ca3af' }} />
                                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#9ca3af' }}>上传头像</div>
                                </div>
                            )}
                        </Upload>
                    </div>

                    {/* 表单 */}
                    <Form
                        form={form}
                        name="register"
                        onFinish={onFinish}
                        autoComplete="off"
                        layout="vertical"
                        requiredMark={false}
                        size="large"
                    >
                        <Form.Item
                            name="username"
                            label="用户名"
                            rules={[{ required: true, message: '请输入用户名' }]}
                        >
                            <Input
                                prefix={<UserOutlined style={{ color: '#9ca3af' }} />}
                                placeholder="请输入用户名"
                            />
                        </Form.Item>

                        <Form.Item
                            name="email"
                            label="邮箱"
                            rules={[
                                { required: true, message: '请输入邮箱' },
                                { type: 'email', message: '邮箱格式不正确' },
                            ]}
                        >
                            <Input
                                prefix={<MailOutlined style={{ color: '#9ca3af' }} />}
                                placeholder="name@example.com"
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
                                placeholder="至少 6 位密码"
                            />
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
                                注册
                            </Button>
                        </Form.Item>
                    </Form>

                    {/* 登录入口 */}
                    <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px', margin: 0 }}>
                        已有账户？{' '}
                        <a href="/login" style={{ color: '#3b82f6', fontWeight: 500, textDecoration: 'none' }}>
                            立即登录
                        </a>
                    </p>
                </div>

                {/* 底部提示 */}
                <p style={{ textAlign: 'center', fontSize: '12px', color: '#9ca3af', marginTop: '24px' }}>
                    注册即表示您同意{' '}
                    <a href="#" style={{ color: '#6b7280' }}>服务条款</a> 和{' '}
                    <a href="#" style={{ color: '#6b7280' }}>隐私政策</a>
                </p>
            </div>
        </div>
    );
}
