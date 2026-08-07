/**
 * 向量存储模块 - 负责将文档分块和嵌入写入数据库
 * 
 * 数据流程:
 * 原始文本 → 文本分割 → 批量 Embedding → 批量写入数据库
 * 
 * 为什么将存储逻辑独立为一个模块:
 * - 关注点分离: embedding.ts 只负责向量生成，本模块只负责数据库操作
 * - 便于事务管理: 文档元数据和分块需要在同一事务中写入，保证数据一致性
 */

import { getRagPool } from './db';
import { splitText, type TextChunk } from './splitter';
import { generateEmbeddings } from './embedding';

/** 文档元信息 */
export interface DocumentMeta {
  id: string;
  title: string;
  sourceType: string;
  sourceInfo?: string;
}

/** 存储结果 */
export interface IngestResult {
  documentId: string;
  chunkCount: number;
  title: string;
}

/**
 * 摄入文档: 分割 → 嵌入 → 存储
 * 
 * 为什么使用数据库事务:
 * - 文档元数据（documents 表）和分块数据（document_chunks 表）必须同时成功或失败
 * - 如果元数据写入成功但分块失败，会导致"幽灵文档"——有记录但无法检索
 * - 事务保证数据完整性
 * 
 * @param text - 文档原始文本
 * @param meta - 文档元信息
 * @param chunkSize - 分块大小（字符数）
 * @param chunkOverlap - 分块重叠大小
 */
export async function ingestDocument(
  text: string,
  meta: DocumentMeta,
  chunkSize = 500,
  chunkOverlap = 50,
): Promise<IngestResult> {
  const pool = getRagPool();

  // 1. 文本分割
  // 为什么在嵌入之前分割: 减少 embedding API 调用次数
  // 如果先嵌入再分割，可能对整篇文档调用 embedding，超出 API 限制
  const chunks: TextChunk[] = splitText(text, { chunkSize, chunkOverlap });

  if (chunks.length === 0) {
    throw new Error('文档分割后为空，请检查文档内容');
  }

  // 2. 批量生成 Embedding
  // 为什么一次性批量: 减少网络往返次数
  // 25 条/批是阿里云 API 的上限
  const embeddings = await generateEmbeddings(chunks.map(c => c.content));

  // 3. 事务写入数据库
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 3a. 插入文档元数据
    await client.query(
      `INSERT INTO documents (id, title, source_type, source_info, chunk_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [meta.id, meta.title, meta.sourceType, meta.sourceInfo || null, chunks.length]
    );

    // 3b. 批量插入分块 + 向量
    // 为什么使用 UNNEST 批量插入而不是循环 INSERT:
    // - 单次 SQL 完成所有插入，减少数据库往返
    // - 对于 50 个分块，从 50 次 INSERT 减少到 1 次
    // - 性能提升显著（约 10-50 倍）
    await client.query(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding, token_count)
       SELECT 
         unnest($1::text[]),
         unnest($2::text[]),
         unnest($3::int[]),
         unnest($4::text[]),
         unnest($5::vector(1024)[]),
         unnest($6::int[])`,
      [
        chunks.map((_, i) => `${meta.id}_chunk_${i}`),
        chunks.map(() => meta.id),
        chunks.map(c => c.index),
        chunks.map(c => c.content),
        embeddings.map(e => `[${e.join(',')}]`),
        chunks.map(c => Math.ceil(c.content.length / 4)), // 粗略估算 token 数
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    documentId: meta.id,
    chunkCount: chunks.length,
    title: meta.title,
  };
}

/**
 * 删除文档及其所有分块
 * 
 * 为什么使用级联删除:
 * - document_chunks 表设置了 ON DELETE CASCADE
 * - 删除 documents 记录时，关联的 chunks 会自动删除
 * - 无需手动清理子表数据
 */
export async function deleteDocument(documentId: string): Promise<void> {
  const pool = getRagPool();
  const result = await pool.query(
    'DELETE FROM documents WHERE id = $1',
    [documentId]
  );
  if (result.rowCount === 0) {
    throw new Error(`文档 ${documentId} 不存在`);
  }
}

/**
 * 获取所有文档列表
 */
export async function listDocuments() {
  const pool = getRagPool();
  const result = await pool.query(
    `SELECT id, title, source_type, source_info, chunk_count, created_at
     FROM documents
     ORDER BY created_at DESC`
  );
  return result.rows;
}

