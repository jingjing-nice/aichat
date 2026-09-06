/** 按自然边界递归分块；输出上限为 chunkSize + overlap 个字符。 */
export function chunkText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {}
): string[] {
  // chunkSize 是 JavaScript 字符数，不是严格 token 数；overlap 保留相邻块边界语境。
  const { chunkSize = 500, overlap = 50 } = options;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || !Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new RangeError('chunkSize 必须为正整数，overlap 必须为小于 chunkSize 的非负整数');
  }
  // 清掉首尾空白，避免只由空白组成的“无效块”也产生 Embedding 成本。
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  // 从语义边界较强到较弱依次尝试；空字符串兜底，保证超长无标点文本也必然可切分。
  const separators = ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', ''];
  // 收集初步分块；重叠内容在递归结束后统一补充，避免递归时重复计算。
  const chunks: string[] = [];

  // 递归降低分隔符粒度：优先保留段落/句子完整性，再退化为字符级切分。
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
        start = end; // 重叠仅在最终输出时添加，避免重复和末尾死循环。
      }
      return;
    }
    // 保留分隔符两侧文本，随后用 buffer 尽可能组合成接近 chunkSize 的块。
    const parts = segment.split(sep);
    let buffer = '';
    for (const part of parts) {
      // buffer 非空时补回 split 移除的分隔符，避免句子或段落粘连失真。
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

  // 从最理想的“双换行”边界开始；只有必要时才降级至更细的边界。
  splitRecursive(clean, 0);

  // 对相邻块补充重叠前缀，保证边界语境完整
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prevTail = overlap === 0 ? '' : chunks[i - 1].slice(-overlap);
    return prevTail + chunk;
  });
}
