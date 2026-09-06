/**
 * 文档摄入队列：把“解析文件、切块、调用 Embedding”从上传 HTTP 请求中移走。
 *
 * 为什么单独放在此文件：API Route 是任务生产者，document-worker.ts 是消费者；
 * 两者共享同一份连接、队列名和任务类型，避免配置分散后出现“投递了但领不到”的问题。
 */
// IORedis 提供 BullMQ 所需的 Redis 长连接。
import IORedis from 'ioredis';
// Queue 是生产者 API；实际消费由 scripts/document-worker.ts 的 Worker 完成。
import { Queue } from 'bullmq';

export interface DocumentIngestionPayload {
  /** 文档元数据主键；Worker 用它查询 object_key 和用户归属。 */
  docId: string;
}

/**
 * 任务内容只保存 docId。原文件仍在 MinIO，避免把大文件复制到 Redis。
 */
export const documentQueueConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  // HTTP 生产者必须在 Redis 不可用时快速失败，Worker 使用单独的持久连接。
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  connectTimeout: 5000,
  retryStrategy: times => times <= 2 ? 500 : null,
});

documentQueueConnection.on('error', error => console.error('[queue] Redis 连接失败:', error.message));

/** 队列名必须与 document-worker.ts 中 Worker 的第一个参数完全一致。 */
let documentIngestionQueue: Queue<DocumentIngestionPayload> | undefined;
function getQueue() {
  documentIngestionQueue ??= new Queue<DocumentIngestionPayload>('document-ingestion', {
    connection: documentQueueConnection,
  });
  return documentIngestionQueue;
}

export async function enqueueDocumentIngestion(docId: string) {
  // 向 Redis 新增轻量任务；不传 Buffer，避免 Redis 被大文件耗尽内存。
  await getQueue().add('parse-and-index', { docId }, {
    // 与 docId 相同可避免同一文档在正常入队时出现两个处理任务。
    jobId: docId,
    // 包含首次执行在内最多三次；临时网络错误无需用户重新上传。
    attempts: 3,
    // 指数退避：失败后逐渐拉长等待时间，避免持续冲击 Embedding API。
    backoff: { type: 'exponential', delay: 5_000 },
    // 成功历史只留最近 200 条，控制 Redis 内存占用。
    removeOnComplete: 200,
    // 失败任务保留，前端才能展示原因并调用 PATCH 重试。
    removeOnFail: false,
  });
}

/**
 * 重新投递一个已失败的任务。
 *
 * BullMQ 的 jobId 全局唯一；失败任务保留时，直接再次 add 同一个 jobId
 * 只会命中旧任务而不会进入 waiting 队列。因此必须复用 BullMQ 的 retry
 * 状态迁移，才能保证 Worker 会再次消费该文档。
 */
export async function retryDocumentIngestion(docId: string) {
  // 先按 jobId 找到保留的失败任务，兼容极少数 Redis 已清理旧任务的情况。
  const job = await getQueue().getJob(docId);
  if (!job) {
    await enqueueDocumentIngestion(docId);
    return;
  }

  // 读取状态后再重试，避免把运行中或已完成任务错误地重新执行。
  const state = await job.getState();
  if (state !== 'failed') {
    throw new Error(`任务当前状态为 ${state}，无法重新处理`);
  }
  // retry('failed') 将失败任务移回 waiting，由 Worker 按原有配置再次领取。
  await job.retry('failed');
}

/** 删除尚未执行的队列任务；active 任务由 Worker 的状态检查安全收尾。 */
export async function cancelDocumentIngestion(docId: string) {
  const job = await getQueue().getJob(docId);
  if (!job) return;
  // active job 不能被 BullMQ 直接移除；下一步 Worker 会处理该并发边界。
  try { await job.remove(); } catch { /* 允许删除流程继续 */ }
}
