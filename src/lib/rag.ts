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
import { query, initDocumentTables } from '@/lib/db';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-v4';

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
}): Promise<{ docId: string; chunkCount: number }> {
  const { title, content } = options;
  const docId = options.docId || `doc_${uuidv4()}`;

  await initDocumentTables();

  const chunks = chunkText(content);
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
        `INSERT INTO documents (id, source_name, content, embedding)
         VALUES ($1, $2, $3, $4::vector)
         ON CONFLICT (id) DO UPDATE SET content = $3, embedding = $4::vector`,
        [`${docId}_${i + j}`, title, batch[j], JSON.stringify(embeddings[j])]
      );
    }
  }

  console.log(`[rag] 文档 "${title}" 入库完成，共 ${chunks.length} 个块`);
  return { docId, chunkCount: chunks.length };
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
 *
 * 【为什么把阈值下推到 SQL】
 * 原先是先取 topK 再在 JS 里过滤阈值：若排名靠前的块恰好都低于阈值，
 * 会白白浪费 topK 名额导致返回为空。下推到 SQL 后，数据库会在过滤阈值
 * 之后再取 topK，保证拿到的都是达标的高相关块。
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

  // WHERE 用余弦距离表达阈值条件（距离 <= 1 - 相似度），与 ORDER BY 同一表达式，
  // 便于 HNSW 索引参与排序过滤
  const res = await query(
    `SELECT content, source_name, 1 - (embedding <=> $1::vector) AS similarity
     FROM documents
     WHERE embedding <=> $1::vector <= 1 - $3
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(embedding), topK, minSimilarity]
  );

  return res.rows as RetrievedChunk[];
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
