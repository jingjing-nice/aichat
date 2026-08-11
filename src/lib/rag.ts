/**
 * RAG 核心模块：分块、向量化入库、相似度检索、上下文构建
 *
 * 【Embedding 模型选择】
 * 复用与聊天相同的 BASE_URL（阿里云百炼 DashScope 兼容模式），
 * 使用 text-embedding-v4，默认输出 1024 维向量，与 documents 表的
 * VECTOR(1024) 定义保持一致。可通过环境变量覆盖模型名。
 */
import { embed, embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { v4 as uuidv4 } from 'uuid';
import { query, initDocumentTables, getPool } from '@/lib/db';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL as string;

// Embedding Provider 单例（模块级缓存，避免重复创建）
const embeddingProvider = createOpenAI({
  baseURL: process.env.BASE_URL,
  apiKey: process.env.API_KEY,
});

function getEmbeddingModel() {
  return embeddingProvider.embedding(EMBEDDING_MODEL);
}

// ==========================================
// 1. 文本分块
// ==========================================

/**
 * 递归切分文本为带重叠的块
 *
 * 【为什么带重叠（overlap）】
 * 切分点可能正好落在语义中间（如一句话被切断），重叠区让相邻块
 * 共享边界内容，检索时任一块命中都能带回完整语境。
 *
 * 【切分策略】
 * 优先按段落/句子等自然边界切，找不到合适边界时硬切字符，
 * 保证中文文本（无空格）也能合理分块。
 */
export function chunkText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {}
): string[] {
  const { chunkSize = 500, overlap = 50 } = options;
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  const separators = ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', ''];
  const chunks: string[] = [];

  function splitRecursive(segment: string, sepIndex: number) {
    if (segment.length <= chunkSize) {
      if (segment.trim()) chunks.push(segment.trim());
      return;
    }
    const sep = separators[sepIndex];
    // 最后一个分隔符是空串：直接按字符硬切
    if (sep === '') {
      let start = 0;
      while (start < segment.length) {
        const end = Math.min(start + chunkSize, segment.length);
        const piece = segment.slice(start, end);
        if (piece.trim()) chunks.push(piece.trim());
        start = end - overlap;
        if (start >= segment.length) break;
      }
      return;
    }
    const parts = segment.split(sep);
    let buffer = '';
    for (const part of parts) {
      const candidate = buffer ? buffer + sep + part : part;
      if (candidate.length > chunkSize) {
        if (buffer.trim()) chunks.push(buffer.trim());
        // 单个 part 仍超长，降级用下一级分隔符继续切
        if (part.length > chunkSize) {
          splitRecursive(part, sepIndex + 1);
          buffer = '';
        } else {
          buffer = part;
        }
      } else {
        buffer = candidate;
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
  }

  splitRecursive(clean, 0);

  // 对相邻块补充重叠前缀，保证边界语境完整
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prevTail = chunks[i - 1].slice(-overlap);
    return prevTail + chunk;
  });
}

// ==========================================
// 2. 向量化入库
// ==========================================

/**
 * 将文档分块并向量化存入 documents 表
 *
 * 【为什么分批 embedMany】
 * DashScope 等 embedding 服务对单次请求的文本条数有限制
 * （通常 10~25 条），按 10 条一批调用最稳妥，也避免单请求超时。
 *
 * @returns 入库的块数
 */
export async function ingestDocument(options: {
  title: string;
  content: string;
  docId?: string;
  sourceType?: string;
  sourceInfo?: string;
}): Promise<{ docId: string; chunkCount: number }> {
  const { title, content } = options;
  const docId = options.docId || `doc_${uuidv4()}`;

  await initDocumentTables();

  const chunks = chunkText(content);

  // 写入/更新文档元数据（幂等，重复入库同一 docId 会覆盖）
  await query(
    `INSERT INTO rag_documents (id, title, source_type, source_info, chunk_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       title = $2, source_type = $3, source_info = $4, chunk_count = $5`,
    [docId, title, options.sourceType || 'text', options.sourceInfo || null, chunks.length]
  );

  if (chunks.length === 0) {
    return { docId, chunkCount: 0 };
  }

  // 分批向量化
  const BATCH_SIZE = 10;
  const model = getEmbeddingModel();
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const { embeddings } = await embedMany({ model, values: batch });

    // 逐块写入（块 ID = 文档 ID + 序号，便于按文档删除/去重）
    for (let j = 0; j < batch.length; j++) {
      await query(
        `INSERT INTO documents (id, doc_id, source_name, content, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (id) DO UPDATE SET content = $4, embedding = $5::vector`,
        [`${docId}_${i + j}`, docId, title, batch[j], JSON.stringify(embeddings[j])]
      );
    }
  }

  console.log(`[rag] 文档 "${title}" 入库完成，共 ${chunks.length} 个块`);
  return { docId, chunkCount: chunks.length };
}

// ==========================================
// 2.5 文档列表与删除
// ==========================================

export interface DocumentMeta {
  id: string;
  title: string;
  source_type: string;
  source_info: string | null;
  chunk_count: number;
  created_at: string;
}

/** 获取所有已入库文档的元数据列表，按创建时间倒序 */
export async function listDocuments(): Promise<DocumentMeta[]> {
  await initDocumentTables();
  const res = await query(
    `SELECT id, title, source_type, source_info, chunk_count, created_at
     FROM rag_documents
     ORDER BY created_at DESC`
  );
  return res.rows as DocumentMeta[];
}

/**
 * 删除文档：同时清除元数据和所有分块向量
 * 两条 DELETE 放在事务里，避免删了一半的脏数据
 */
export async function deleteDocument(docId: string): Promise<boolean> {
  await initDocumentTables();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM documents WHERE doc_id = $1', [docId]);
    // 兼容早期数据：老块没有 doc_id 列值，按 ID 前缀兑底清理
    await client.query('DELETE FROM documents WHERE doc_id IS NULL AND id LIKE $1', [`${docId}_%`]);
    const res = await client.query('DELETE FROM rag_documents WHERE id = $1', [docId]);
    await client.query('COMMIT');
    return (res.rowCount ?? 0) > 0;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ==========================================
// 3. 相似度检索
// ==========================================

export interface RetrievedChunk {
  content: string;
  source_name: string;
  similarity: number;
}

/**
 * 按用户问题检索最相关的文档块
 *
 * 【余弦距离 <=>】
 * pgvector 的 <=> 运算符返回余弦距离（0~2），相似度 = 1 - 距离。
 * 相似度阈值过滤掉明显不相关的块，避免无关内容污染上下文。
 */
export async function retrieveRelevant(
  queryText: string,
  topK: number = 5,
  minSimilarity: number = 0.3
): Promise<RetrievedChunk[]> {
  if (!queryText.trim()) return [];

  await initDocumentTables();

  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: queryText.slice(0, 8000), // embedding 接口有输入长度上限，截断保护
  });

  const res = await query(
    `SELECT content, source_name, 1 - (embedding <=> $1::vector) AS similarity
     FROM documents
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(embedding), topK]
  );

  return (res.rows as RetrievedChunk[]).filter(
    (row) => Number(row.similarity) >= minSimilarity
  );
}

// ==========================================
// 4. 聊天上下文构建
// ==========================================

/**
 * 从 UIMessage 数组中提取最后一条用户消息的纯文本
 *
 * AI SDK v6 的消息内容是 parts 数组，只取 text 类型的部分。
 */
export function extractLastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.parts)) {
      const text = msg.parts
        .filter((p: any) => p?.type === 'text')
        .map((p: any) => p.text)
        .join('\n');
      if (text.trim()) return text;
    }
  }
  return '';
}

/**
 * 根据用户问题检索资料并拼接为可注入 system prompt 的上下文字符串
 * 无相关资料时返回空串，调用方直接拼接即可。
 */
export async function buildRagContext(userText: string): Promise<string> {
  const docs = await retrieveRelevant(userText);
  if (docs.length === 0) return '';

  const sections = docs
    .map((d, i) => `[资料${i + 1} · 来源: ${d.source_name}]\n${d.content}`)
    .join('\n\n---\n\n');

  return `\n\n【知识库参考资料】
以下是与用户问题可能相关的资料，请优先依据这些资料回答；如引用请注明资料编号。资料与问题无关时忽略。

${sections}`;
}
