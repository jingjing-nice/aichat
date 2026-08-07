/**
 * Embedding 生成模块
 * 
 * 什么是 Embedding（向量嵌入）:
 * - 将文本转换为高维浮点数向量（如 1024 维）
 * - 语义相近的文本在向量空间中距离更近
 * - 例如："如何学习编程" 和 "编程入门指南" 的向量会很接近
 * 
 * 为什么使用阿里云的 Embedding 模型:
 * - 项目已配置阿里云 OpenAI 兼容 API，无需额外注册服务
 * - text-embedding-v3 模型支持中文，且输出 1024 维向量
 * - OpenAI 兼容接口意味着可以用标准 HTTP 请求调用，无需特殊 SDK
 * 
 * 参考: https://help.aliyun.com/zh/model-studio/text-embedding-api
 */

const BASE_URL = process.env.BASE_URL || '';
const API_KEY = process.env.API_KEY || '';
const EMBEDDING_MODEL = 'text-embedding-v3';
const EMBEDDING_DIMENSIONS = 1024;

/**
 * 批量生成文本的向量嵌入
 * 
 * 为什么支持批量:
 * - 减少网络请求次数，一个文档可能有几十个分块
 * - API 通常支持批量输入（一次最多 25 条）
 * - 批量处理的吞吐量远高于逐条调用
 * 
 * @param texts - 待转换的文本数组
 * @returns 二维数组，每个元素是对应的 1024 维向量
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // 分批处理，每批最多 10 条（阿里云 Embedding API 限制）
  const batchSize = 10;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const response = await fetch(`${BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
        // 指定输出维度 - text-embedding-v3 支持 512/1024/1536
        // 选择 1024: 在精度和存储成本之间取得平衡
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Embedding API 请求失败 (${response.status}): ${errorText}`
      );
    }

    const data = await response.json();

    // OpenAI 兼容格式: { data: [{ embedding: number[], index: number }], usage: {...} }
    const batchEmbeddings = data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((item: { embedding: number[] }) => item.embedding);

    allEmbeddings.push(...batchEmbeddings);
  }

  return allEmbeddings;
}

/**
 * 生成单条文本的向量嵌入
 * 
 * @param text - 待转换的文本
 * @returns 1024 维向量
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const embeddings = await generateEmbeddings([text]);
  return embeddings[0];
}
