// 独立 Node 进程需自行读取 .env.local/.env 中的 Redis、MinIO、模型配置。
import 'dotenv/config';
// Worker 从 BullMQ 领取异步任务；它不能运行在请求结束即回收的 Route Handler 中。
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
// 数据库状态机、连接关闭；状态让前端能够展示异步进度。
import { closePool, getPool, initDocumentTables } from '../src/lib/db';
// 根据文件格式把二进制原件转换为可向量化的纯文本。
import { extractDocumentText } from '../src/lib/documentParser';
// 从对象存储取回原文件；Redis 任务中仅保存 docId，不保存大文件。
import { downloadBufferFromMinio } from '../src/lib/minio';
// 执行分块、Embedding 和向量写入，是 RAG 摄入的最终步骤。
import { ingestDocument } from '../src/lib/rag';

/**
 * 消费队列并将 MinIO 的 PDF/Word/Excel/文本文件解析为可检索纯文本。
 *
 * Worker 是独立常驻进程，不能放在短生命周期的 Next.js 请求中运行。
 * 队列名 document-ingestion 必须与 src/lib/ingestionQueue.ts 一致。
 */
import { createDocumentProcessor } from '../src/lib/documentIngestion';

async function main() {
  await initDocumentTables();
  const workerConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
  const worker = new Worker('document-ingestion', createDocumentProcessor({
    connect: () => getPool().connect(),
    extract: extractDocumentText,
    download: downloadBufferFromMinio,
    ingest: ingestDocument,
  }), { connection: workerConnection, concurrency: 3 });

  worker.on('completed', job => console.info(`[document-worker] 任务完成: ${job.id}`));
  worker.on('failed', (job, error) => console.error(`[document-worker] 任务失败: ${job?.id}`, error.message));

  async function shutdown() {
    // 先停止领取新任务，再释放数据库连接，让容器/终端退出不留下连接。
    await worker.close();
    await workerConnection.quit();
    await closePool();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

}
main().catch(error => { console.error(error); process.exit(1); });
