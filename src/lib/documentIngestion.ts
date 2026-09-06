import type { PoolClient } from 'pg';
import type { ingestDocument } from './rag';

interface IngestionJob {
  data: { docId: string };
  attemptsMade: number;
  opts: { attempts?: number };
}
interface Dependencies {
  connect: () => Promise<PoolClient>;
  extract: (options: { buffer: Buffer; fileName: string }) => Promise<string>;
  download: (key: string) => Promise<Buffer>;
  ingest: typeof ingestDocument;
}

/** 会话锁随数据库连接释放。重领 stalled 任务时可恢复 parsing/indexing 状态。 */
export function createDocumentProcessor(deps: Dependencies) {
  return async (job: IngestionJob) => {
    const { docId } = job.data;
    const client = await deps.connect();
    const execute = (sql: string, params?: unknown[]) => client.query(sql, params);
    let locked = false;
    let connectionBroken = false;
    const onConnectionError = () => { connectionBroken = true; };
    client.on('error', onConnectionError);
    try {
      await execute('SELECT pg_advisory_lock(hashtextextended($1, 0))', [docId]);
      locked = true;
      const claimed = await execute(
        `UPDATE rag_documents SET ingestion_status = 'parsing', ingestion_error = NULL, updated_at = NOW()
         WHERE id = $1 AND ingestion_status IN ('queued', 'parsing', 'indexing')
         RETURNING *`, [docId],
      );
      const document = claimed.rows[0];
      if (!document) return;
      try {
        if (!document.object_key) throw new Error('文档缺少 MinIO object_key');
        const content = await deps.extract({
          buffer: await deps.download(document.object_key),
          fileName: document.original_name || document.source_info || document.title,
        });
        if (!content.trim()) throw new Error('未能从文档中提取有效文本');
        const indexing = await execute(
          `UPDATE rag_documents SET ingestion_status = 'indexing', updated_at = NOW() WHERE id = $1`, [docId],
        );
        if (!indexing.rowCount) return;
        // 清理上一次未完成的数据，避免重试后留下多余尾块。非 ready 文档不会被检索。
        await execute('DELETE FROM documents WHERE doc_id = $1', [docId]);
        const { chunkCount } = await deps.ingest({
          docId, title: document.title, content, userId: document.user_id,
          sourceType: document.source_type, sourceInfo: document.source_info,
          upsertMetadata: false, execute,
        });
        await execute(
          `UPDATE rag_documents SET ingestion_status = 'ready', ingestion_error = NULL,
           chunk_count = $1, updated_at = NOW() WHERE id = $2`, [chunkCount, docId],
        );
      } catch (error) {
        const retrying = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
        await execute(
          `UPDATE rag_documents SET ingestion_status = $1, ingestion_error = $2, updated_at = NOW() WHERE id = $3`,
          [retrying ? 'queued' : 'failed', (error instanceof Error ? error.message : '文档处理失败').slice(0, 500), docId],
        );
        throw error;
      }
    } finally {
      try {
        if (locked && !connectionBroken) await execute('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [docId]);
      } catch { connectionBroken = true; }
      client.removeListener('error', onConnectionError);
      client.release(connectionBroken);
    }
  };
}
