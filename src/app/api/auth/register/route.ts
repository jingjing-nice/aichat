// 注册接口

import { NextRequest, NextResponse } from 'next/server';
import { initUserTable, query } from '@/lib/db';
import bcrypt from 'bcryptjs';

/** 统一错误响应：状态码 200，success 为 false */
function fail(message: string) {
    return NextResponse.json({ success: false, message });
}

/** 统一成功响应：状态码 200，success 为 true */
function ok(message: string, data?: Record<string, unknown>) {
    return NextResponse.json({ success: true, message, ...data });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { username, password, email, user_pic } = body;

        // 初始化用户表
        await initUserTable();

        // 校验必填字段
        if (!username || !password || !email) {
            return fail('缺少用户名、密码或邮箱');
        }

        // 检查用户名或邮箱是否已存在
        const existing = await query(
            `SELECT * FROM users WHERE username = $1 OR email = $2`,
            [username, email]
        );
        if (existing.rows.length > 0) {
            return fail('用户名或邮箱已存在');
        }

        // 加密密码并插入用户记录
        const hashedPassword = bcrypt.hashSync(password, 10);
        await query(
            `INSERT INTO users (username, password, email, user_pic) VALUES ($1, $2, $3, $4)`,
            [username, hashedPassword, email, user_pic]
        );

        return ok('注册成功');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[register] 注册失败:', message);
        return fail('注册失败，请稍后重试');
    }
}