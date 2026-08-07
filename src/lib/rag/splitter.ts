/**
 * 递归字符文本分割器
 * 
 * 为什么需要文本分割:
 * 1. LLM 的上下文窗口有限，无法一次性处理整个文档
 * 2. Embedding 模型对输入长度有限制（通常 512-8192 tokens）
 * 3. 较小的分块能提高检索精度 - 大块中可能只有小部分与问题相关
 * 4. 分块后注入 LLM 的上下文更精炼，减少噪声干扰
 * 
 * 为什么使用递归分割而不是固定长度切分:
 * - 固定长度会在句子中间截断，破坏语义完整性
 * - 递归分割优先按段落 → 句子 → 子句的层级拆分
 * - 确保每个分块尽可能包含完整的语义单元
 */

export interface TextChunk {
  /** 分块内容 */
  content: string;
  /** 在原文中的起始位置（字符索引） */
  startIndex: number;
  /** 在原文中的结束位置（字符索引） */
  endIndex: number;
  /** 分块序号，从 0 开始 */
  index: number;
}

export interface SplitterOptions {
  /** 
   * 每个分块的目标最大字符数
   * 默认 500 字符 ≈ 200-300 tokens
   * 选择依据: 研究表明 200-500 tokens 的分块在检索精度和上下文完整性之间取得最佳平衡
   */
  chunkSize?: number;
  
  /**
   * 相邻分块之间的重叠字符数
   * 默认 50 字符 ≈ 20-30 tokens
   * 为什么需要重叠:
   * - 防止关键信息恰好被切割到两个分块的边界
   * - 保持上下文连贯性，确保跨分块的语义不会丢失
   */
  chunkOverlap?: number;
  
  /**
   * 分隔符优先级列表（从最优先到最次）
   * 分割器会先尝试用第一个分隔符拆分，如果块仍然太大，再用下一个分隔符
   */
  separators?: string[];
}

const DEFAULT_SEPARATORS = [
  '\n\n',  // 段落分隔 - 最优先，段落通常是完整的语义单元
  '\n',    // 换行符 - 次优先
  '。',    // 中文句号
  '！',    // 中文感叹号
  '？',    // 中文问号
  '. ',    // 英文句号
  '! ',    // 英文感叹号
  '? ',    // 英文问号
  '；',    // 中文分号
  '; ',    // 英文分号
  '，',    // 中文逗号
  ', ',    // 英文逗号
  ' ',     // 空格 - 最后的手段
  '',      // 空分隔符 - 最终兜底，按字符拆分
];

/**
 * 递归分割文本
 * 
 * 算法流程:
 * 1. 尝试用当前分隔符将文本拆分为若干段
 * 2. 如果单个段已经超过 chunkSize，递归用更小的分隔符继续拆分
 * 3. 将多个段合并到 chunkSize 限制内（贪心合并）
 * 4. 按 chunkOverlap 在相邻分块间创建重叠
 */
export function splitText(
  text: string,
  options: SplitterOptions = {}
): TextChunk[] {
  const {
    chunkSize = 500,
    chunkOverlap = 50,
    separators = DEFAULT_SEPARATORS,
  } = options;

  if (text.length <= chunkSize) {
    return [{
      content: text.trim(),
      startIndex: 0,
      endIndex: text.length,
      index: 0,
    }];
  }

  // 找到能有效拆分文本的最佳分隔符
  const separator = separators.find(s => s === '' || text.includes(s)) ?? '';

  // 用选定的分隔符拆分文本
  const parts = separator === '' ? [...text] : text.split(separator);

  // 递归处理: 如果某个 part 仍然太大，用更小的分隔符继续拆分
  const subParts: string[] = [];
  const nextSeparators = separators.slice(separators.indexOf(separator) + 1);

  for (const part of parts) {
    if (part.length > chunkSize && nextSeparators.length > 0) {
      // 递归拆分过大的段
      const subChunks = splitText(part, {
        chunkSize,
        chunkOverlap: 0, // 递归时不加重叠，最终合并时再加
        separators: nextSeparators,
      });
      subParts.push(...subChunks.map(c => c.content));
    } else {
      subParts.push(part);
    }
  }

  // 贪心合并: 将多个小段合并到 chunkSize 限制内
  const chunks: TextChunk[] = [];
  let currentContent = '';
  let currentStart = 0;
  let chunkIndex = 0;

  for (let i = 0; i < subParts.length; i++) {
    const part = subParts[i];
    // 计算加上这个 part 后的长度（包括分隔符）
    const separatorLen = separator.length;
    const newLength = currentContent.length + (currentContent ? separatorLen : 0) + part.length;

    if (newLength > chunkSize && currentContent.length > 0) {
      // 当前块已满，保存并开始新块
      const trimmed = currentContent.trim();
      if (trimmed) {
        chunks.push({
          content: trimmed,
          startIndex: currentStart,
          endIndex: currentStart + currentContent.length,
          index: chunkIndex++,
        });
      }

      // 新块的起始位置考虑重叠
      const overlapChars = Math.min(chunkOverlap, currentContent.length);
      currentStart = currentStart + currentContent.length - overlapChars;
      const overlapText = currentContent.slice(-overlapChars);
      currentContent = overlapText + separator + part;
    } else {
      currentContent += (currentContent ? separator : '') + part;
    }
  }

  // 处理最后一个块
  if (currentContent.trim()) {
    chunks.push({
      content: currentContent.trim(),
      startIndex: currentStart,
      endIndex: text.length,
      index: chunkIndex,
    });
  }

  // 重新编号索引
  return chunks.map((chunk, i) => ({ ...chunk, index: i }));
}
