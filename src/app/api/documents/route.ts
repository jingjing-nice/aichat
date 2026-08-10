/**
 * 文档管理 API - GET/POST/DELETE
 * 
 * 纯前端交互接口，不涉及实际数据库存储
 * 用于展示知识库管理的 UI 交互流程
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * GET - 获取文档列表（返回空列表）
 */
export async function GET() {
  return NextResponse.json({ documents: [] });
}

/**
 * POST - 上传文档（模拟成功响应）
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const title = formData.get('title') as string;
    const content = formData.get('content') as string;
    const file = formData.get('file') as File;

    if (!title) {
      return NextResponse.json(
        { error: '缺少必填字段: title' },
        { status: 400 }
      );
    }

    if (!content && !file) {
      return NextResponse.json(
        { error: '请提供文档内容或上传文件' },
        { status: 400 }
      );
    }

    // 模拟成功响应
    const docId = `doc_${Date.now()}`;
    return NextResponse.json({
      success: true,
      documentId: docId,
      title,
      chunkCount: 0,
    });
  } catch (error) {
    console.error('[Documents API] POST 错误:', error);
    return NextResponse.json(
      { error: '上传失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除文档（模拟成功响应）
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

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[Documents API] DELETE 错误:', error);
    return NextResponse.json(
      { error: '删除失败' },
      { status: 500 }
    );
  }
}
