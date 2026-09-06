 'use client';

import { useState } from 'react';
import type { RagSource } from '@/lib/rag';

function isSource(value: unknown): value is RagSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<RagSource>;
  return typeof source.id === 'string' && typeof source.chunkId === 'string'
    && typeof source.citation === 'string' && typeof source.title === 'string'
    && typeof source.excerpt === 'string' && typeof source.similarity === 'number';
}

export function RagSources({ metadata }: { metadata: unknown }) {
  const sources = metadata && typeof metadata === 'object' && 'sources' in metadata
    && Array.isArray(metadata.sources) ? metadata.sources.filter(isSource) : [];
  const [opened, setOpened] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!sources.length) return null;
  const open = async (source: RagSource) => {
    setLoading(source.chunkId);
    setError('');
    try {
      const response = await fetch(`/api/documents?chunkId=${encodeURIComponent(source.chunkId)}`);
      if (!response.ok) throw new Error('无法读取证据，文档可能已删除或尚未就绪');
      const data = await response.json();
      if (typeof data.source?.content !== 'string') throw new Error('证据格式无效');
      setOpened(previous => ({ ...previous, [source.chunkId]: data.source.content }));
    } catch (error) {
      setError(error instanceof Error ? error.message : '读取失败');
    } finally { setLoading(null); }
  };
  return <div className="mt-3 space-y-2 text-sm">
    <p className="text-gray-500">检索参考资料</p>
    {sources.map(source => <div key={source.citation} className="rounded-lg border border-gray-200 p-3">
      <div className="font-medium">[{source.citation}] {source.title}</div>
      <p className="whitespace-pre-wrap text-gray-600">{opened[source.chunkId] ?? source.excerpt}</p>
      {!opened[source.chunkId] && <button className="mt-1 text-blue-600" disabled={loading !== null}
        onClick={() => open(source)}>{loading === source.chunkId ? '加载中…' : '查看完整证据片段'}</button>}
    </div>)}
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </div>;
}
