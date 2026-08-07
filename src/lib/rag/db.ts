/**
 * RAG 数据库连接池
 * 
 * 设计说明:
 * - 使用全局单例模式，避免在 Next.js 热重载时创建过多连接
 * - Next.js 开发模式下模块会被反复导入，全局变量确保连接池不会重复创建
 * - 生产环境每个 Serverless 函数实例共享一个连接池
 */

import { Pool } from 'pg';

// 使用 globalThis 存储单例，防止 Next.js 热重载时创建多个连接池
const globalForRag = globalThis as unknown as {
  ragPool: Pool | undefined;
};

/**
 * 获取数据库连接池
 * 
 * 为什么使用连接池而不是每次创建新连接:
 * - TCP 连接建立需要三次握手，复用连接可显著降低延迟
 * - 连接池限制最大连接数，防止数据库过载
 * - Neon 的连接串已包含 pooler 地址，进一步优化连接管理
 */
export function getRagPool(): Pool {
  if (!globalForRag.ragPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL 环境变量未配置');
    }

    globalForRag.ragPool = new Pool({
      connectionString,
      // 连接池最大连接数 - 根据 Neon 免费套餐限制调整
      max: 5,
      // 空闲连接超时(毫秒) - 30秒后释放空闲连接
      idleTimeoutMillis: 30000,
      // 连接超时(毫秒) - 10秒内必须建立连接
      connectionTimeoutMillis: 10000,
    });
  }
  return globalForRag.ragPool;
}
