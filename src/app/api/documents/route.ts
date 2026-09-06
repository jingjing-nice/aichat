/**
 * RAG 文档 HTTP 接口。
 *
 * POST：保存原文件和元数据后投递后台任务；GET：展示当前用户文档；
 * DELETE：删除任务、向量和原文件；PATCH：将失败任务重新入队。
 * 这样 Web 请求保持短暂，慢速解析和模型调用交给常驻 Worker 执行。
 */
// SHA-256 用于同用户文件去重；UUID 作为跨数据库、队列、对象存储的文档主键。
import { createHash, randomUUID } from 'crypto';
// Next.js 的请求/响应对象，用于实现四个 REST 方法。
import { NextRequest, NextResponse } from 'next/server';
// 每个接口均先鉴权，以 user.id 作为文件归属与检索隔离边界。
import { verifyAuth, unauthorized } from '@/lib/auth';
// 初始化 RAG 表并执行参数化 SQL，避免首次上传和并发请求出错。
import { initDocumentTables, query } from '@/lib/db';
// 上传前按白名单快速拒绝 Worker 无法解析的格式。
import { isSupportedDocument } from '@/lib/documentParser';
// 原文件存 MinIO；数据库只存定位该文件的 objectKey 与元数据。
import { deleteObjectFromMinio, uploadBufferToMinio } from '@/lib/minio';
import {
  cancelDocumentIngestion,
  enqueueDocumentIngestion,
  retryDocumentIngestion,
} from '@/lib/ingestionQueue';
import { deleteDocument, listDocuments } from '@/lib/rag';

/**
 * 当前接口会用 file.arrayBuffer() 将完整文件读进 Node.js 内存；限制为 10 MB
 * 可防止多个并发上传耗尽内存。更大的文件应改为浏览器经预签名 URL 直传 MinIO/S3。
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 统一返回 API 错误格式，方便前端只读取 success 和 error。 */
function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function isStorageUnavailable(error: unknown) {
  // MinIO 或 Redis 未启动时常见的网络错误；将其转换为可理解的 503 响应。
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ECONNREFUSED';
}

/**
 * 上传原文件到 MinIO 后，只向 Redis/BullMQ 投递 docId；耗时处理不会阻塞此请求。
 */
export async function POST(req: NextRequest) {
  // 上传接口只完成“保存原件 + 创建任务”，不在 HTTP 请求中解析/向量化文件。
  const user = verifyAuth(req);
  if (!user) return unauthorized();

  let objectKey: string | undefined;
  let metadataSaved = false;
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const textContent = formData.get('content');
    // FormData 的值可能是 File、string 或 null；先安全转字符串再 trim，
    // 让“用户填写的展示标题”与“原始文件名”成为两个独立概念。
    const requestedTitle = String(formData.get('title') || '').trim();
    let buffer: Buffer;
    let originalName: string;
    let mimeType: string;

    if (file instanceof File) {
      // 文件模式：标题可为空，后面会回退为 originalName；文件内容由浏览器传入。
      if (!isSupportedDocument(file.name)) return fail('仅支持 txt、md、csv、json、pdf、docx、xlsx、xls 文件', 415);
      if (file.size === 0 || file.size > MAX_FILE_BYTES) return fail('文件大小必须在 1 B 到 10 MB 之间', 413);
      buffer = Buffer.from(await file.arrayBuffer());
      originalName = file.name;
      mimeType = file.type || 'application/octet-stream';
    } else if (typeof textContent === 'string' && textContent.trim()) {
      // 文本模式没有真实文件名，因此强制标题，并人为生成 .txt 原始文件名。
      if (!requestedTitle) return fail('文本上传需要文档标题', 400);
      buffer = Buffer.from(textContent, 'utf8');
      if (buffer.length > MAX_FILE_BYTES) return fail('文本内容不能超过 10 MB', 413);
      originalName = `${requestedTitle}.txt`;
      mimeType = 'text/plain; charset=utf-8';
    } else {
      return fail('缺少 file 或非空 content 字段', 400);
    }

    // 同一用户、相同二进制内容只处理一次，避免重复存储和重复 Embedding 费用。
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    await initDocumentTables();
    const duplicate = await query(
      `SELECT id, title, ingestion_status FROM rag_documents
       WHERE user_id = $1 AND file_hash = $2`,
      [user.id, fileHash],
    );
    if (duplicate.rows[0]) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        docId: duplicate.rows[0].id,
        title: duplicate.rows[0].title,
        status: duplicate.rows[0].ingestion_status,
        message: '检测到相同文件，已复用已有文档',
      });
    }

    // 不使用数据库自增 ID：对象存储 key、队列 jobId、向量 doc_id 可立刻共享该全局唯一值。
    const docId = `doc_${randomUUID()}`;
    // Key 不包含用户可控的文件名，避免重名、特殊字符影响对象管理。
    objectKey = `users/${user.id}/documents/${docId}/original`;
    await uploadBufferToMinio({ objectKey, buffer, mimeType });

    /**
     * rag_documents 是“一份原始文档一行”的元数据表；真正的文本块稍后由 Worker 写入。
     *
     * 为什么先写 queued，再立即入队？
     * 1. Worker 收到的任务只有 docId，它必须先能查到该 docId 对应的 object_key、用户和标题；
     * 2. queued 是“原文件与元数据已就绪，等待 Worker 处理”的真实状态，前端据此开始轮询；
     * 3. 不能先入队再写数据库：Worker 可能抢先领取任务，此时查不到元数据或 MinIO 定位信息；
     * 4. 两步紧挨着执行，确保数据库状态和 BullMQ 任务尽量同步。若入队失败，下面 catch 会把
     *    状态改为 failed 并保留原文件，用户可通过 PATCH 重新入队，无须重复上传。
     */
    await query(
      `INSERT INTO rag_documents
        (id, user_id, title, source_type, source_info, chunk_count,
         object_key, original_name, mime_type, file_size, file_hash, ingestion_status)
       VALUES ($1, $2, $3, 'file', $4, 0, $5, $6, $7, $8, $9, 'queued')`,
      [
        docId,
        user.id,
        requestedTitle || originalName,
        originalName,
        objectKey,
        originalName,
        mimeType,
        buffer.length,
        fileHash,
      ],
    );
    metadataSaved = true;

    try {
      /**
       * 元数据 INSERT 成功后才允许入队：此刻 Worker 无论何时开始，都能通过 docId 查到完整上下文。
       * BullMQ/Redis 只保存轻量 docId；大文件已经在 MinIO，不能复制到 Redis。
       */
      await enqueueDocumentIngestion(docId);
    } catch (queueError) {
      // 保留文件和元数据；后续可通过“重新入队”恢复，而不是让用户重新上传。
      await query(
        `UPDATE rag_documents SET ingestion_status = 'failed', ingestion_error = $1, updated_at = NOW()
         WHERE id = $2`,
        [queueError instanceof Error ? queueError.message.slice(0, 500) : '任务入队失败', docId],
      );
      throw queueError;
    }

    return NextResponse.json({
      success: true,
      docId,
      objectKey,
      status: 'queued',
      message: '原文件已保存并进入处理队列',
    }, { status: 202 });
  } catch (error) {
    // 数据库失败时补偿删除已上传对象，避免留下孤儿文件。
    if (objectKey && !metadataSaved) {
      try { await deleteObjectFromMinio(objectKey); } catch { /* 保留原始上传错误 */ }
    }
    console.error('[Documents API] 原文件上传失败:', error);
    if (isStorageUnavailable(error)) {
      return fail('对象存储或 Redis 服务不可用，请启动依赖服务后重试', 503);
    }
    return fail('原文件上传失败', 500);
  }
}

export async function GET(req: NextRequest) {
  // 只按当前用户查询，避免知识库列表跨用户泄露。
  const user = verifyAuth(req);
  if (!user) return unauthorized();
  try {
    const chunkId = req.nextUrl.searchParams.get('chunkId');
    if (chunkId) {
      await initDocumentTables();
      const result = await query(
        `SELECT d.id, d.content, r.title FROM documents d
         JOIN rag_documents r ON r.id = d.doc_id
         WHERE d.id = $1 AND r.user_id = $2 AND r.ingestion_status = 'ready'`,
        [chunkId, user.id],
      );
      if (!result.rows[0]) return fail('证据不存在或文档尚未就绪', 404);
      return NextResponse.json({ success: true, source: result.rows[0] });
    }
    return NextResponse.json({ success: true, documents: await listDocuments(user.id) });
  } catch (error) {
    console.error('[Documents API] 获取列表失败:', error);
    return fail('获取文档列表失败', 500);
  }
}

export async function DELETE(req: NextRequest) {
  // 删除顺序：先尝试取消排队任务，再删数据库/向量，最后删 MinIO 原件。
  const user = verifyAuth(req);
  if (!user) return unauthorized();
  const docId = req.nextUrl.searchParams.get('id');
  if (!docId) return fail('缺少查询参数 id', 400);

  try {
    await initDocumentTables();
    // 删除 MinIO 前先读取 object_key；删除元数据后就无法再定位原始文件。
    const metadata = await query(
      'SELECT object_key FROM rag_documents WHERE id = $1 AND user_id = $2',
      [docId, user.id],
    );
    if (!metadata.rows[0]) return fail('文档不存在', 404);
    await cancelDocumentIngestion(docId);

    const deleted = await deleteDocument(docId, user.id);
    if (!deleted) return fail('文档不存在', 404);
    const objectKey = metadata.rows[0].object_key as string | null;
    if (objectKey) {
      try { await deleteObjectFromMinio(objectKey); } catch (error) {
        // 数据库、向量已删除；记录对象存储清理异常，便于后续补偿任务处理。
        console.error(`[Documents API] MinIO 对象删除失败: ${objectKey}`, error);
      }
    }
    return NextResponse.json({ success: true, docId });
  } catch (error) {
    console.error('[Documents API] 删除失败:', error);
    return fail('删除文档失败', 500);
  }
}

/** 失败文档复用已存于 MinIO 的原文件重新入队，无需再次上传。 */
export async function PATCH(req: NextRequest) {
  // 仅允许 failed 状态重新进入队列，避免运行中的任务被重复消费。
  const user = verifyAuth(req);
  if (!user) return unauthorized();
  const docId = req.nextUrl.searchParams.get('id');
  if (!docId) return fail('缺少查询参数 id', 400);

  try {
    await initDocumentTables();
    // 先用条件 UPDATE 把状态改回 queued；这是前端可见状态和队列状态的一致性保障。
    const result = await query(
      `UPDATE rag_documents SET ingestion_status = 'queued', ingestion_error = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND ingestion_status = 'failed'
       RETURNING id`,
      [docId, user.id],
    );
    if (!result.rows[0]) return fail('仅处理失败的文档可重新入队', 409);
    try {
      await retryDocumentIngestion(docId);
    } catch (error) {
      await query(
        `UPDATE rag_documents SET ingestion_status = 'failed', ingestion_error = $1, updated_at = NOW() WHERE id = $2`,
        [error instanceof Error ? error.message.slice(0, 500) : '任务入队失败', docId],
      );
      throw error;
    }
    return NextResponse.json({ success: true, docId, status: 'queued' }, { status: 202 });
  } catch (error) {
    console.error('[Documents API] 重新入队失败:', error);
    return fail('重新入队失败', 500);
  }
}
