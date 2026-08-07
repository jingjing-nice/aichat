/**
 * 语义检索模块 - RAG 的 "R"（Retrieval）
 * 
 * 检索流程:
 * 用户问题 → 生成问题向量 → 在数据库中做余弦相似度搜索 → 返回最相关的分块
 * 
 * 为什么使用语义检索而不是关键词搜索:
 * - 关键词搜索（如 SQL LIKE）只能匹配精确的词汇
 * - 语义检索能理解同义词和近义表达
 * - 例如: 用户问"如何提升性能"，能匹配到"优化速度的方法"
 * - 这是通过向量空间中的距离度量实现的
 */

import { getRagPool } from './db';
import { generateEmbedding } from './embedding';

/** 检索到的文档分块 */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  /** 相似度分数 (0-1)，1 表示完全匹配 */
  similarity: number;
}

/**
 * 语义检索 - 找到与查询最相关的文档分块
 * 
 * 核心技术: 余弦相似度搜索
 * - 将查询文本转换为向量
 * - 在向量空间中计算查询向量与所有分块向量的余弦相似度
 * - 余弦相似度 = cos(θ) = A·B / (|A|×|B|)
 * - 值域 [0, 1]，越接近 1 表示语义越相似
 * 
 * 为什么使用 pgvector 的 <=> 操作符:
 * - <=> 是 pgvector 提供的余弦距离操作符
 * - 余弦距离 = 1 - 余弦相似度
 * - 使用 ORDER BY embedding <=> query_vector 实现最近邻搜索
 * - 配合 HNSW 索引，检索速度从 O(n) 降到 O(log n)
 * 
 * @param query - 用户查询文本
 * @param topK - 返回的最相关分块数量，默认 5
 *   为什么默认 5: 研究表明 3-5 个分块通常能提供足够的上下文
 *   过多会引入噪声，过少可能遗漏关键信息
 * @param threshold - 相似度阈值，低于此值的分块会被过滤
 *   为什么需要阈值: 即使排序后，低相似度的分块可能是噪声
 *   0.3 是经验值，低于此值的分块通常与查询关联度很低
 */
export async function retrieveRelevantChunks(
  query: string,
  topK = 5,
  threshold = 0.3,
): Promise<RetrievedChunk[]> {
  // 1. 将查询转换为向量
  const queryEmbedding = await generateEmbedding(query);
  const queryVector = `[${queryEmbedding.join(',')}]`;

  const pool = getRagPool();

  // 2. 执行向量相似度搜索
  // SQL 解释:
  // - <=> 计算余弦距离 (1 - similarity)
  // - 1 - (embedding <=> queryVector) 转换为相似度分数
  // - WHERE 过滤掉低于阈值的分块
  // - ORDER BY + LIMIT 取 topK 个最相关的
  const result = await pool.query(
    `SELECT 
       dc.id,
       dc.document_id,
       d.title AS document_title,
       dc.chunk_index,
       dc.content,
       1 - (dc.embedding <=> $1::vector) AS similarity
     FROM document_chunks dc
     JOIN documents d ON dc.document_id = d.id
     WHERE 1 - (dc.embedding <=> $1::vector) > $2
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $3`,
    [queryVector, threshold, topK]
  );

  return result.rows.map(row => ({
    id: row.id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    chunkIndex: row.chunk_index,
    content: row.content,
    similarity: parseFloat(row.similarity),
  }));
}

/**
 * 将检索到的分块格式化为 LLM 上下文
 * 
 * 为什么需要格式化:
 * - LLM 需要清晰的上下文标记来区分参考信息和指令
 * - 包含来源信息让 LLM 能引用具体文档
 * - 按相似度排序确保最相关的内容在前面
 * 
 * 格式设计参考了 Anthropic 的 RAG 最佳实践:
 * - 使用 XML 标签包裹上下文，LLM 对此格式理解最好
 * - 每条上下文标注来源，减少幻觉
 */
export function formatContextForLLM(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';

  const contextParts = chunks.map((chunk, i) => {
    return `<context source="${chunk.documentTitle}" chunk="${chunk.chunkIndex}" relevance="${(chunk.similarity * 100).toFixed(0)}%">
${chunk.content}
</context>`;
  });

  return `<retrieved_context>
以下是从知识库中检索到的与用户问题最相关的内容。
请优先基于这些内容回答用户问题。如果这些内容不足以回答问题，可以结合你自身的知识补充，但请明确区分。

${contextParts.join('\n\n')}
</retrieved_context>`;
}
