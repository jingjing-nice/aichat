/**
 * 数据库初始化脚本 - 创建 RAG 所需的表和索引
 * 
 * 运行方式: npx tsx scripts/init-db.ts
 * 
 * 说明:
 * - 启用 pgvector 扩展以支持向量存储
 * - 创建 documents 表存储原始文档
 * - 创建 document_chunks 表存储分块后的文本及其向量
 * - 创建 HNSW 索引加速余弦相似度检索
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

// 加载 .env.local 中的环境变量
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ 错误: 未找到 DATABASE_URL 环境变量');
  console.log('请在 .env.local 中配置 DATABASE_URL');
  process.exit(1);
}

async function initDatabase() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('🔗 正在连接数据库...');

    // 1. 启用 pgvector 扩展
    // 原因: PostgreSQL 原生不支持向量类型，pgvector 扩展提供了 vector 类型
    // 和相似度搜索函数（如余弦相似度），是实现语义检索的基础
    console.log('📦 启用 pgvector 扩展...');
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('✅ pgvector 扩展已启用');

    // 2. 创建 documents 表
    // 原因: 存储用户上传的原始文档元信息，便于管理和追溯
    // 每个文档可以产生多个 chunks，通过 document_id 关联
    console.log('📦 创建 documents 表...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        source_type   TEXT NOT NULL DEFAULT 'text',
        source_info   TEXT,
        chunk_count   INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ documents 表已创建');

    // 3. 创建 document_chunks 表
    // 原因: RAG 的核心是将文档切分为小块，每块生成向量嵌入
    // - document_id: 外键关联到 documents 表，支持级联删除
    // - chunk_index: 记录分块在原文中的顺序，检索时可保持上下文连贯
    // - content: 分块后的文本内容，会作为上下文注入 LLM prompt
    // - embedding: vector(1024) 存储文本的向量表示
    //   维度 1024 对应阿里云 text-embedding-v3 模型的输出维度
    // - token_count: 记录该块的 token 数，用于检索时控制总上下文长度
    console.log('📦 创建 document_chunks 表...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id            TEXT PRIMARY KEY,
        document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index   INTEGER NOT NULL,
        content       TEXT NOT NULL,
        embedding     vector(1024) NOT NULL,
        token_count   INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ document_chunks 表已创建');

    // 4. 创建 HNSW 索引
    // 原因: 向量相似度搜索如果逐行比较（暴力搜索），在数据量大时会非常慢
    // HNSW (Hierarchical Navigable Small World) 是一种近似最近邻算法
    // - 构建多层导航图，检索时从粗到精逐层定位
    // - 时间复杂度 O(log n)，远优于暴力搜索的 O(n)
    // - cosine 操作符指定使用余弦相似度作为距离度量
    // - m=16, ef_construction=64 是常用的平衡参数
    console.log('📦 创建 HNSW 向量索引...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS chunks_embedding_idx
      ON document_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);
    console.log('✅ HNSW 向量索引已创建');

    // 5. 创建 document_id 索引
    // 原因: 按文档删除 chunks 时需要快速查找，避免全表扫描
    await pool.query(`
      CREATE INDEX IF NOT EXISTS chunks_document_id_idx
      ON document_chunks(document_id)
    `);
    console.log('✅ document_id 索引已创建');

    console.log('\n🎉 数据库初始化完成！');
    console.log('📊 表结构:');
    console.log('   - documents: 文档元信息');
    console.log('   - document_chunks: 文档分块 + 向量嵌入');

  } catch (error) {
    console.error('❌ 数据库初始化失败:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
