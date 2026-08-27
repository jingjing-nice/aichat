// 登录接口

import { NextRequest, NextResponse } from 'next/server';
import { initUserTable, query } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { jwtSecretKey } from '@/config';
import jwt from 'jsonwebtoken';

/**
 * 统一错误响应：使用真实 HTTP 状态码，便于前端/网关按状态码统一处理
 * 400 参数错误 / 401 认证失败 / 500 服务端错误；
 * 响应体保留 { success, message } 结构，前端可读 message 展示具体原因
 */
function fail(message: string, status: number) {
    return NextResponse.json({ success: false, message }, { status });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { username, password } = body;

        // 校验必填字段
        if (!username || !password) {
            return fail('缺少用户名、密码', 400);
        }

        // 初始化用户表
        await initUserTable();

        // 根据用户名查询用户是否存在
        const existing = await query('SELECT * FROM users WHERE username = $1', [username]);

        // 用户不存在或密码错误统一返回 401，不区分具体原因（避免撞库探测账号是否存在）
        if (existing.rows.length === 0) return fail('登录失败', 401);
        // 验证密码是否正确 compareSync(用户输入的密码, 数据库中存储的密码)
        const compareResult = bcrypt.compareSync(password, existing.rows[0].password);

        if (!compareResult) return fail('登录失败', 401);
        // 登录成功 生成 Token 字符串
        const tokenStr = jwt.sign(
            { id: existing.rows[0].id, username: existing.rows[0].username },
            jwtSecretKey,
            { expiresIn: '60s' }
        );

        // 设置 HttpOnly cookie，token 不暴露给客户端 JavaScript
        const response = NextResponse.json({ success: true, message: '登录成功' });
        response.cookies.set({
            name: 'token',
            value: tokenStr,
            path: '/',
            maxAge: 60,        // 有效期 60s，与 JWT 有效期保持一致
            httpOnly: true,          // 防止 XSS 攻击，JavaScript 无法读取
            sameSite: 'lax',         // 防止 CSRF 攻击
        });
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[login] 登录失败:', message);
        return fail('登录失败，请稍后重试', 500);
    }
}
