import { Pool } from 'pg';

/**
 * Neon PostgreSQL 数据库客户端
 *
 * 【为什么使用 pg 原生驱动而不是 @neondatabase/serverless】
 * @neondatabase/serverless 底层使用 WebSocket 协议通信，该协议在中国大陆网络环境下
 * 可能被限制或不稳定。pg（node-postgres）使用标准 TCP + TLS 连接，兼容性最好，
 * 在本地开发（中国大陆）和 Vercel 服务器（海外）环境下都能稳定工作。
 *
 * 【为什么使用连接池 Pool 而不是每次新建 Client】
 * 1. 数据库连接建立成本高（TCP 握手 + TLS 协商 + 认证），连接池可复用连接
 * 2. Neon Serverless 架构对并发连接数有限制，连接池（max: 5）可控制连接上限
 * 3. Next.js API Route 会处理并发请求，连接池自动管理连接的借出与归还
 */

// 模块级单例：Next.js 开发模式下模块会被热重载缓存，
// 使用模块级变量可避免每次请求都创建新的连接池导致连接泄漏
let _pool: Pool | null = null;

/**
 * 获取数据库连接池（懒加载单例）
 *
 * 为什么懒加载：DATABASE_URL 环境变量可能在模块导入时尚未就绪，
 * 延迟到首次调用时读取可避免启动阶段报错，也方便测试时 mock。
 */
export function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      // 快速失败：缺少配置时给出明确错误信息，而不是让后续查询超时
      throw new Error('DATABASE_URL 环境变量未配置');
    }
    _pool = new Pool({
      connectionString: url,
      // Neon 强制要求 SSL 连接；rejectUnauthorized: false 是因为 Neon 使用
      // 自签名的中间证书链，严格校验会失败（Neon 官方推荐配置）
      ssl: { rejectUnauthorized: false },
      // 连接池上限 5：个人应用并发不高，小池子可避免超出 Neon 免费层连接数限制
      max: 5,
      // 空闲连接 30 秒后释放：Neon 的 compute 实例会在空闲时挂起，
      // 及时释放空闲连接可让实例更快进入休眠（免费层省资源），下次请求自动唤醒
      idleTimeoutMillis: 30000,
      // 建连超时 10 秒：Neon 冷启动唤醒 compute 实例通常需要 1-3 秒，
      // 10 秒足够覆盖冷启动，同时避免网络异常时无限挂起
      connectionTimeoutMillis: 10000,
    });
  }
  return _pool;
}

/**
 * 执行 SQL 查询（自动从连接池获取连接）
 *
 * 【为什么封装这一层】
 * 1. 统一入口：所有查询都经过这里，方便以后加日志、监控、重试逻辑
 * 2. 参数化查询：使用 $1、$2 占位符 + params 数组，pg 驱动会自动转义，
 *    从根本上防止 SQL 注入（绝不能拼接字符串构造 SQL）
 */
export async function query(text: string, params?: unknown[]) {
  const pool = getPool();
  return pool.query(text, params);
}

/**
 * 初始化对话相关表结构（如不存在则创建）
 *
 * 【为什么每个 API 请求都调用它而不是只在部署时建表】
 * Vercel 是无状态 Serverless 环境，没有可靠的"部署后执行一次"钩子。
 * 使用 CREATE TABLE IF NOT EXISTS 幂等语句，在每次请求时确保表存在，
 * 表已存在时该语句几乎零成本（PostgreSQL 直接跳过），换来的是
 * 首次部署无需手动执行迁移脚本，降低部署出错的可能。
 *
 * 【表结构设计说明】
 * conversations 表：存储对话元数据
 *   - token_usage / message_usages 用 JSONB：结构灵活且无需为统计数据单独建表，
 *     JSONB 还支持索引查询，兼顾灵活性和性能
 * messages 表：存储消息明细，与对话一对多关系
 *   - ON DELETE CASCADE：删除对话时自动级联删除其所有消息，避免产生孤儿数据
 *   - content 用 JSONB 存 UIMessage.parts：AI SDK 的消息 parts 是异构数组
 *     （文本/推理/工具调用等多种类型），关系型字段无法表达，JSONB 是最自然的映射
 *   - idx_messages_conv 索引：按 conversation_id 查消息是最高频操作，建索引加速
 */
export async function initConversationTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      token_usage JSONB NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"totalTokens":0}',
      message_usages JSONB NOT NULL DEFAULT '[]'
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)
  `);

  console.log('[db] 对话表初始化完成');
}

/**
 * 关闭连接池（仅用于 CLI 脚本退出时清理）
 *
 * 【为什么需要它】
 * pg 的连接池会保持 Node.js 进程存活（有打开的 socket），
 * 脚本（如 init-conversation-db.ts）执行完后若不关闭连接池，进程不会退出。
 * API Route 中不需要调用，进程由 Vercel/Next.js 托管。
 */
export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
