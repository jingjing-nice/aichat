// 登录接口

import { NextRequest, NextResponse } from 'next/server';
import { initUserTable, query } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { jwtSecretKey } from '@/config';
import jwt from 'jsonwebtoken';

/**
 * 统一错误响应：使用真实 HTTP 状态码，便于前端/网关按状态码统一处理
 * 400 参数错误 / 401 认证失败 / 500 服务端错误；
 * 全站失败响应统一为 { success: false, error } 结构（与 unauthorized() 一致）
 */
function fail(error: string, status: number) {
    return NextResponse.json({ success: false, error }, { status });
}

/** Token 有效期：7 天（JWT 与 Cookie 保持一致），过短会导致用户频繁掉线 */
const TOKEN_EXPIRES_IN = '7d';
const TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

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
        // 验证密码是否正确（异步版本，避免阻塞事件循环）
        const compareResult = await bcrypt.compare(password, existing.rows[0].password);

        if (!compareResult) return fail('登录失败', 401);
        // 登录成功 生成 Token 字符串
        const tokenStr = jwt.sign(
            { id: existing.rows[0].id, username: existing.rows[0].username },
            jwtSecretKey,
            { expiresIn: TOKEN_EXPIRES_IN }
        );

        // 设置 HttpOnly cookie，token 不暴露给客户端 JavaScript
        const response = NextResponse.json({ success: true, message: '登录成功' });
        response.cookies.set({
            name: 'token',
            value: tokenStr,
            path: '/',
            maxAge: TOKEN_MAX_AGE_SECONDS, // 有效期与 JWT 有效期保持一致
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
