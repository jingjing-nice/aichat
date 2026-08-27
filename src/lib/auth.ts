/**
 * API 层统一鉴权工具
 *
 * 【为什么在 Route Handler 内校验而不是依赖 middleware】
 * 1. Next.js middleware 运行在 Edge Runtime，jsonwebtoken 等 Node 库不可用
 * 2. Handler 内逐个校验让每个 API 的鉴权语义显式可见，
 *    未登录/登录过期统一返回标准 401，前端可集中处理跳转登录
 *
 * 使用方式（在每个需要登录的 Route Handler 开头）：
 *   if (!verifyAuth(request)) return unauthorized();
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { jwtSecretKey } from '@/config';

/** JWT payload 携带的登录用户信息（与登录接口 jwt.sign 的载荷对应） */
export interface AuthUser {
  id: number;
  username: string;
}

/**
 * 校验请求 cookie 中的 token
 * @returns 校验成功返回用户信息；缺少 token、签名无效或已过期返回 null
 */
export function verifyAuth(request: NextRequest): AuthUser | null {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecretKey) as jwt.JwtPayload & AuthUser;
    return { id: payload.id, username: payload.username };
  } catch {
    return null;
  }
}

/** 统一的 401 响应（未登录或登录过期） */
export function unauthorized() {
  return NextResponse.json(
    { success: false, error: '未登录或登录已过期，请重新登录' },
    { status: 401 },
  );
}
