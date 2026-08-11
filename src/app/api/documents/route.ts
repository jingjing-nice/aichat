/**
 * 文档知识库 API
 *
 * - POST   /api/documents          入库：分块 → embedMany 向量化 → 写入 pgvector
 * - GET    /api/documents          列表：返回已入库文档的元数据
 * - DELETE /api/documents?id=xxx   删除：清除元数据和全部分块向量
 *
 * 【POST 支持两种请求格式】
 * 1. JSON：{ title, content } —— 直接提交文本内容
 * 2. FormData：file 字段（仅支持 .txt/.md 纯文本文件）+ 可选 title
 *
 * PDF/Word 等二进制格式需要额外解析库（如 pdf-parse），
 * 最小闭环先覆盖纯文本场景。
 */
import { NextRequest, NextResponse } from 'next/server';
import { ingestDocument, listDocuments, deleteDocument } from '@/lib/rag';

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.json'];

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    let title = '';
    let content = '';
    let sourceType = 'text';
    let sourceInfo: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      // FormData 模式：可能是纯文本 content 字段，也可能是 file 文件上传
      const formData = await req.formData();
      title = (formData.get('title') as string) || '';
      const formContent = formData.get('content');

      if (typeof formContent === 'string' && formContent.trim()) {
        // 文本输入模式
        content = formContent;
      } else {
        // 文件上传模式
        const file = formData.get('file') as File | null;
        if (!file) {
          return NextResponse.json({ error: '缺少 file 或 content 字段' }, { status: 400 });
        }

        const fileName = file.name || 'untitled.txt';
        const lowerName = fileName.toLowerCase();
        const isTextFile = TEXT_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
        if (!isTextFile) {
          return NextResponse.json(
            { error: `暂不支持该文件类型，目前仅支持：${TEXT_EXTENSIONS.join(', ')}` },
            { status: 415 }
          );
        }

        content = await file.text();
        title = title || fileName;
        sourceType = 'file';
        sourceInfo = fileName;
      }
    } else {
      // JSON 模式
      const body = await req.json();
      title = body.title || '';
      content = body.content || '';
    }

    if (!title) {
      return NextResponse.json({ error: '缺少文档标题 title' }, { status: 400 });
    }
    if (!content || !content.trim()) {
      return NextResponse.json({ error: '文档内容为空' }, { status: 400 });
    }

    // 执行分块 + 向量化 + 入库
    const { docId, chunkCount } = await ingestDocument({
      title,
      content,
      sourceType,
      sourceInfo,
    });

    if (chunkCount === 0) {
      return NextResponse.json({ error: '分块结果为空，请检查文档内容' }, { status: 422 });
    }

    return NextResponse.json({ success: true, docId, title, chunkCount });
  } catch (error) {
    console.error('[Documents API] 入库失败:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: '文档入库失败',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/documents - 获取已入库文档列表
 * 前端 DocumentManager 面板打开时调用，返回 { documents: [...] }
 */
export async function GET() {
  try {
    const documents = await listDocuments();
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('[Documents API] 获取列表失败:', error);
    return NextResponse.json({ error: '获取文档列表失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/documents?id=xxx - 删除文档及其所有分块向量
 * 幂等设计：文档不存在时返回 404，重复删除无副作用
 */
export async function DELETE(req: NextRequest) {
  try {
    const docId = req.nextUrl.searchParams.get('id');
    if (!docId) {
      return NextResponse.json({ error: '缺少查询参数 id' }, { status: 400 });
    }

    const deleted = await deleteDocument(docId);
    if (!deleted) {
      return NextResponse.json({ error: '文档不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, docId });
  } catch (error) {
    console.error('[Documents API] 删除失败:', error);
    return NextResponse.json({ error: '删除文档失败' }, { status: 500 });
  }
}