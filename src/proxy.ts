// 判断token是否存在

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import jwt from 'jsonwebtoken';
import { jwtSecretKey } from './config';
/** 公开路由：无需登录即可访问 */
const publicPaths = ['/login', '/register', '/api/auth/login', '/api/auth/register'];


export function proxy(request: NextRequest) {

    const { pathname } = request.nextUrl

    // 公开路由直接放行
    if (publicPaths.some(path => pathname.startsWith(path))) {
        return NextResponse.next();
    }

    // 从 cookie 读取 token
    const token = request.cookies.get('token')

    if (!token) {
        // 没有 token，重定向到登录页
        return NextResponse.redirect(new URL('/login', request.url))
    }

    // 判断token是否失效（cookie.get 返回的是 RequestCookie 对象，要取 .value）
    try {
        jwt.verify(token.value, jwtSecretKey)
        // token有效放行
        return NextResponse.next()
    } catch {
        //  token 无效或已过期，清除 cookie 并重定向到登录页
        const response = NextResponse.redirect(new URL('/login', request.url));
        response.cookies.delete('token');
        return response;

    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

