/**
 * 文档管理 API - GET/POST/DELETE
 * 
 * GET    /api/documents - 获取所有已上传的文档列表
 * POST   /api/documents - 上传并摄入新文档
 * DELETE /api/documents?id=xxx - 删除指定文档
 * 
 * 为什么使用 RESTful API 而不是 Server Actions:
 * - 文档上传涉及 FormData（文件上传），REST API 处理更直观
 * - 便于未来扩展为独立的文档管理微服务
 * - 前端可以用 fetch/FormData 直接调用，无需额外封装
 */

import { NextRequest, NextResponse } from 'next/server';
import { ingestDocument, deleteDocument, listDocuments } from '@/lib/rag/vectorStore';

/**
 * GET - 获取文档列表
 * 
 * 返回所有已摄入的文档及其元信息
 * 用于前端文档管理面板展示
 */
export async function GET() {
  try {
    const documents = await listDocuments();
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('[Documents API] GET 错误:', error);
    return NextResponse.json(
      { error: '获取文档列表失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST - 上传并摄入文档
 * 
 * 接收 FormData，支持以下字段:
 * - title: 文档标题（必填）
 * - content: 文档文本内容（与 file 二选一）
 * - file: 上传的文件（与 content 二选一）
 * 
 * 处理流程:
 * 1. 解析 FormData 获取文档内容
 * 2. 生成唯一文档 ID
 * 3. 调用 ingestDocument 执行: 分割 → 嵌入 → 存储
 * 4. 返回摄入结果
 * 
 * 为什么支持两种输入方式:
 * - content: 适合前端直接粘贴文本，简单快捷
 * - file: 适合上传 .txt/.md 等文本文件
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const title = formData.get('title') as string;
    const content = formData.get('content') as string;
    const file = formData.get('file') as File;

    // 验证输入
    if (!title) {
      return NextResponse.json(
        { error: '缺少必填字段: title' },
        { status: 400 }
      );
    }

    let textContent = '';
    let sourceType = 'text';
    let sourceInfo = '';

    if (content) {
      // 直接文本输入
      textContent = content;
      sourceType = 'text';
      sourceInfo = '用户直接输入';
    } else if (file && file.size > 0) {
      // 文件上传
      // 为什么限制文件类型: 只处理纯文本文件，避免 PDF/Word 等需要额外解析
      const allowedTypes = ['text/plain', 'text/markdown', 'text/csv'];
      if (!allowedTypes.includes(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.md')) {
        return NextResponse.json(
          { error: '不支持的文件类型，请上传 .txt 或 .md 文件' },
          { status: 400 }
        );
      }

      // 限制文件大小 (1MB)
      // 为什么限制: 防止过大的文件导致 embedding API 超时或超出 token 限制
      if (file.size > 1024 * 1024) {
        return NextResponse.json(
          { error: '文件大小超过限制 (最大 1MB)' },
          { status: 400 }
        );
      }

      textContent = await file.text();
      sourceType = 'file';
      sourceInfo = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    } else {
      return NextResponse.json(
        { error: '请提供文档内容 (content) 或上传文件 (file)' },
        { status: 400 }
      );
    }

    if (textContent.trim().length === 0) {
      return NextResponse.json(
        { error: '文档内容为空' },
        { status: 400 }
      );
    }

    // 生成唯一文档 ID
    // 使用 时间戳 + 随机数 确保唯一性
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 摄入文档
    const result = await ingestDocument(textContent, {
      id: docId,
      title,
      sourceType,
      sourceInfo,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[Documents API] POST 错误:', error);
    return NextResponse.json(
      { error: '文档摄入失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除文档
 * 
 * 通过 URL 参数 ?id=xxx 指定要删除的文档
 * 级联删除: 文档元数据 + 所有关联的分块和向量
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: '缺少文档 ID 参数' },
        { status: 400 }
      );
    }

    await deleteDocument(id);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[Documents API] DELETE 错误:', error);
    return NextResponse.json(
      { error: '删除文档失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

