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
      user_id INTEGER REFERENCES users(id),
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
 * 初始化 RAG 文档向量表（如不存在则创建）
 *
 * 【pgvector 依赖】
 * Neon 原生支持 pgvector 扩展。初始化结果在当前 Node.js 进程中缓存，
 * 避免文档列表轮询时重复执行 DDL 和索引检查。
 *
 * 【表结构设计说明】
 * rag_documents 表：文档元数据（一个文档一行），用于列表展示和按文档删除
 * documents 表：存储分块后的文档内容及向量，通过 doc_id 关联元数据
 *   - embedding VECTOR(1024)：维度与 text-embedding-v4 默认输出维度一致，
 *     若更换 embedding 模型需同步修改此维度
 *   - doc_id 列：新增列，老数据通过 IF NOT EXISTS 平滑补齐
 *   - HNSW 索引 + 余弦相似度：近似最近邻检索，比精确扫描快几个数量级，
 *     小规模数据下召回率几乎无损
 */
// 进程内共享同一个初始化 Promise：并发首请求只会执行一次 DDL，避免索引创建竞争。
let documentTablesInitialization: Promise<void> | null = null;

export function initDocumentTables(): Promise<void> {
  // 已在初始化或初始化完成时直接复用 Promise，调用方始终 await 同一结果。
  if (!documentTablesInitialization) {
    documentTablesInitialization = initializeDocumentTables().catch((error: unknown) => {
      // 初始化失败不能缓存失败结果，修复配置/数据库后允许后续请求重试。
      documentTablesInitialization = null;
      throw error;
    });
  }
  return documentTablesInitialization;
}

async function initializeDocumentTables(): Promise<void> {
  await initUserTable();
  // pgvector 提供 VECTOR 类型、<=> 余弦距离操作符和 HNSW 索引能力。
  await query(`CREATE EXTENSION IF NOT EXISTS vector`);

  // 一份原始文档一行：供前端列表、权限控制、重试和删除使用。
  await query(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'text',
      source_info TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      object_key TEXT,
      original_name TEXT,
      mime_type TEXT,
      file_size BIGINT,
      file_hash TEXT,
      ingestion_status TEXT NOT NULL DEFAULT 'uploaded',
      ingestion_error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);


  // 一个文本分块一行：content 用于给 LLM 提供证据，embedding 用于语义相似度检索。
  await query(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding VECTOR(1024),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 老表补列：每条 ALTER 都是幂等迁移，部署到已有数据库也不会丢失历史数据。
  // doc_id 将向量块关联到元数据，支持按文档删除、用户隔离和统计。
  await query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_id TEXT`);
  // NOT VALID 保留旧数据；新写入受外键保护，删除元数据会级联清理分块。
  await query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_doc_id_fkey'
                   AND conrelid = 'documents'::regclass) THEN
      ALTER TABLE documents ADD CONSTRAINT documents_doc_id_fkey
        FOREIGN KEY (doc_id) REFERENCES rag_documents(id) ON DELETE CASCADE NOT VALID;
    END IF;
  END $$`);

  await query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS object_key TEXT`);
  await query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS original_name TEXT`);
  await query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS mime_type TEXT`);
  await query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS file_size BIGINT`);
  await query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS file_hash TEXT`);
  await query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS ingestion_status TEXT NOT NULL DEFAULT 'uploaded'`);
  await query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS ingestion_error TEXT`);
  await query(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  // 迁移前已完成向量化的文档没有对象存储定位信息，视为已就绪，避免 UI 无限轮询。
  // HNSW 是近似最近邻索引；vector_cosine_ops 与 rag.ts 的 <=> 余弦距离查询匹配。
  await query(`
    UPDATE rag_documents SET ingestion_status = 'ready'
    WHERE chunk_count > 0 AND object_key IS NULL AND ingestion_status = 'uploaded'
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_documents_embedding
    ON documents USING hnsw (embedding vector_cosine_ops)
  `);

  // 加速按 docId 删除所有分块；这是删除文档与 Worker 清理孤儿向量的高频条件。
  await query(`CREATE INDEX IF NOT EXISTS idx_documents_doc_id ON documents(doc_id)`);
  // 同一用户的相同文件只保留一份，避免重复产生 Embedding 成本。
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_documents_user_file_hash
    ON rag_documents (user_id, file_hash)
    WHERE file_hash IS NOT NULL
  `);

  console.log('[db] 文档向量表初始化完成');
}


/***
 * 创建登录信息表
 * id
 * username
 * password
 * email
 * user_pic
*/

export async function initUserTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      user_pic TEXT
    )
  `);

  console.log('[db] 用户表初始化完成');
}

/**
 * 关闭连接池（仅用于 CLI 脚本退出时清理）
 *
 * 【为什么需要它】
 * pg 的连接池会保持 Node.js 进程存活（有打开的 socket），
 * 后台 Worker 退出时需要关闭连接池，释放数据库连接。
 * API Route 中不需要调用，进程由 Vercel/Next.js 托管。
 */
export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
