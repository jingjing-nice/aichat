/**
 * 文档解析适配层：统一将不同二进制格式转换为可切块、可嵌入的纯文本。
 * 新格式只需在此处增加解析分支，Worker 的队列、状态、重试逻辑无需修改。
 */
// 集中维护白名单，上传接口和解析器使用同一规则，避免“能上传却不能解析”。
const SUPPORTED_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.csv', '.json', '.pdf', '.docx', '.xlsx', '.xls',
];

/**
 * 上传阶段的第一道格式校验。这里只按扩展名判断，生产环境还应校验文件头
 * （magic number）并做恶意文件扫描，不能把客户端文件名当作安全边界。
 */
export function isSupportedDocument(fileName: string) {
  // 后缀比较统一小写，支持用户上传扩展名大小写不一致的文件。
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(extension => lower.endsWith(extension));
}

export async function extractDocumentText(options: {
  /** 从 MinIO 下载得到的完整文件二进制数据。 */
  buffer: Buffer;
  /** 用后缀选择解析器；来自原始文件名或文档标题。 */
  fileName: string;
}): Promise<string> {
  // 用原文件后缀路由到正确的解析器；Worker 已保证文件来自受控对象存储。
  const lower = options.fileName.toLowerCase();

  if (lower.endsWith('.pdf')) {
    // 动态导入：Worker 真正处理 PDF 时才加载较重的解析依赖。
    const { PDFParse } = await import('pdf-parse');
    // PDFParse 持有解析资源，finally 中销毁可避免常驻 Worker 的内存持续增长。
    const parser = new PDFParse({ data: options.buffer });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }

  if (lower.endsWith('.docx')) {
    // mammoth 输出 Word 的原始文字而非复杂排版；RAG 检索关心语义文本而非样式。
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ buffer: options.buffer })).value;
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    // 表格转 CSV 后，行列关系仍以文本形式保留，才能和普通文档一起切块与检索。
    const XLSX = await import('xlsx');
    // type: buffer 明确告诉 xlsx 输入来自对象存储二进制而非文件路径或 base64。
    const workbook = XLSX.read(options.buffer, { type: 'buffer' });
    return workbook.SheetNames.map(sheetName => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      // 写入工作表名，避免不同 sheet 的同名列在检索结果中失去上下文。
      return `工作表：${sheetName}\n${csv}`;
    }).join('\n\n');
  }

  // txt / md / csv / json 等文本格式可直接按 UTF-8 解码。
  return options.buffer.toString('utf8');
}
