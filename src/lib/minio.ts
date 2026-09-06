/**
 * RAG 原始文件的对象存储适配层。
 *
 * PostgreSQL 只保存文件的元数据和向量；PDF、Word 等二进制原件保存在
 * MinIO。MinIO 兼容 S3 API，因此生产环境可替换为 AWS S3、OSS 或 R2。
 */
// MinIO 的 S3 兼容客户端，负责保存需要重试/重新解析的原始二进制文件。
import * as Minio from 'minio';
// getObject 返回流；Readable 类型让 for await 的分块读取具有明确类型。
import { Readable } from 'node:stream';

/**
 * MinIO SDK 客户端。以下属性都来自 .env.local：
 * - endPoint：MinIO 服务地址；本机运行 Docker 时为 127.0.0.1。
 * - port：S3 兼容 API 端口；本项目 Compose 映射为 9000。
 * - useSSL：是否用 HTTPS 连接；本地开发为 false，生产应为 true。
 * - accessKey / secretKey：访问对象存储的凭证，生产应使用最小权限账号。
 */
export const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',

    accessKey: process.env.MINIO_ACCESS_KEY!,
    secretKey: process.env.MINIO_SECRET_KEY!,
});

/** bucket 是对象存储的第一层容器，类似“文件仓库”，不是本地磁盘目录。 */
export const MINIO_BUCKET =
    process.env.MINIO_BUCKET || 'knowledge-base';

/**
 * 上传、删除前确保 bucket 已创建。
 * 首次上传时自动建桶，避免开发者还要手动进入 MinIO 控制台创建。
 */
export async function ensureBucketExists() {
    // bucketExists 后再创建使操作幂等：多次上传不会因桶已存在而失败。
    const exists = await minioClient.bucketExists(MINIO_BUCKET);
    if (!exists) await minioClient.makeBucket(MINIO_BUCKET, 'us-east-1')
}

/** Route Handler 接收的是内存 Buffer，因此使用 putObject 而非 fPutObject（本地文件路径）。 */
export async function uploadBufferToMinio(options: {
    /** 唯一对象名，例如 users/12/documents/doc_xxx/original。 */
    objectKey: string;
    /** 来自 HTTP 上传的二进制内容；不是用户电脑上的文件路径。 */
    buffer: Buffer;
    /** MIME 类型，例如 application/pdf；作为对象元数据供下载/预览使用。 */
    mimeType: string;
}) {
    // 先确保容器存在，降低首次启动时因手动初始化遗漏导致上传失败的概率。
    await ensureBucketExists();
    await minioClient.putObject(
        MINIO_BUCKET,
        options.objectKey,
        options.buffer,
        options.buffer.length,
        { 'Content-Type': options.mimeType },
    );
}

/** 删除原文件；调用方应先确认当前用户拥有对应文档。 */
export async function deleteObjectFromMinio(objectKey: string) {
    await ensureBucketExists();
    await minioClient.removeObject(MINIO_BUCKET, objectKey);
}       

/** Worker 从对象存储读取原文件，后续交给解析器处理。 */
export async function downloadBufferFromMinio(objectKey: string): Promise<Buffer> {
    // getObject 返回 Node.js 可读流；聚合为 Buffer 以适配各格式解析库。
    const stream = await minioClient.getObject(MINIO_BUCKET, objectKey);
    // 流式累积避免假设单次网络读取能拿到完整文件；解析库最终仍需要完整 Buffer。
    const chunks: Buffer[] = [];
    for await (const chunk of stream as Readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    // 合并成连续内存，供 PDF、DOCX、XLSX 解析器使用。
    return Buffer.concat(chunks);
}
