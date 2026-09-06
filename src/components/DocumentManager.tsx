'use client';

// React 状态、生命周期、缓存回调和隐藏 file input 的引用。
import { useState, useEffect, useCallback, useRef } from 'react';
// 知识库管理界面的图标；只影响视觉提示，不承载 RAG 业务逻辑。
import { Upload, FileText, Trash2, X, Database, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

/**
 * RAG 文档管理面板组件。
 * 
 * 功能:
 * 1. 查看已上传的文档列表
 * 2. 上传新文档（文本输入或文件上传）
 * 3. 删除已有文档
 * 
 * 设计说明:
 * - 使用 Modal 形式展示，不占用主聊天区域空间
 * - 上传后立即开始摄入，显示进度状态
 * - 摄入完成后自动刷新文档列表
 *
 * 为什么前端只轮询状态而不等待上传接口完成：接口返回 202 只代表任务已接受；
 * PDF 解析和 Embedding 属于后台工作，可能耗时数秒至数分钟。
 */

interface Document {
  /** rag_documents.id，同时也是 BullMQ jobId 和 documents.doc_id 的关联键。 */
  id: string;
  /** 前端显示的文档标题，不一定等于用户上传时的原始文件名。 */
  title: string;
  source_type: string;
  source_info: string | null;
  chunk_count: number;
  /** Worker 处理进度；只有 ready 状态的文档才会参与聊天检索。 */
  ingestion_status: 'uploaded' | 'queued' | 'parsing' | 'indexing' | 'ready' | 'failed';
  /** 最终失败时由 Worker 写入的可展示错误原因。 */
  ingestion_error: string | null;
  created_at: string;
}

interface DocumentManagerProps {
  /** 父组件控制弹窗显示；关闭时停止轮询，避免后台空请求。 */
  isOpen: boolean;
  /** 点击关闭按钮时回调给父组件，由父组件更新显示状态。 */
  onClose: () => void;
}

// 上传阶段是前端即时反馈；与数据库 ingestion_status（Worker 后台阶段）分开维护。
type UploadStatus = 'idle' | 'uploading' | 'queued' | 'error';

export function DocumentManager({ isOpen, onClose }: DocumentManagerProps) {
  // 后端返回的元数据列表，是渲染状态、重试按钮和删除按钮的唯一数据来源。
  const [documents, setDocuments] = useState<Document[]>([]);
  // GET 请求期间展示列表加载状态，防止用户误以为没有文档。
  const [loading, setLoading] = useState(false);
  // 当前上传动作的短期状态；不替代每份文档的 ingestion_status。
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadError, setUploadError] = useState('');
  const [uploadMode, setUploadMode] = useState<'text' | 'file'>('text');
  const [title, setTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载文档列表
  const fetchDocuments = useCallback(async () => {
    // 请求前置 loading，finally 中无论成功失败都复位，避免 UI 永久转圈。
    setLoading(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.documents) {
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error('获取文档列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 弹窗关闭时不请求；setTimeout(0) 将状态更新安排到 effect 后，符合 React effect 规则。
    if (!isOpen) return;
    const timer = window.setTimeout(() => { void fetchDocuments(); }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, fetchDocuments]);

  // 仅在有运行中任务时轮询，完成或失败后自动停止，避免空闲请求。
  useEffect(() => {
  // uploaded 是兼容历史数据的静态状态；新任务创建后直接进入 queued。
  // 不能把它视作处理中，否则历史记录会导致永久轮询。
  const hasPending = documents.some(doc => ['queued', 'parsing', 'indexing'].includes(doc.ingestion_status));
    if (!isOpen || !hasPending) return;
    const timer = window.setInterval(fetchDocuments, 2000);
    return () => window.clearInterval(timer);
  }, [documents, fetchDocuments, isOpen]);

  // 重置表单
  const resetForm = () => {
    setTitle('');
    setTextContent('');
    setSelectedFile(null);
    setUploadStatus('idle');
    setUploadError('');
  };

  // 上传文档
  const handleUpload = async () => {
    // 先在浏览器校验必填项，减少无效文件上传；服务端仍会重复校验作为安全边界。
    if (!title.trim()) {
      setUploadError('请输入文档标题');
      return;
    }

    if (uploadMode === 'text' && !textContent.trim()) {
      setUploadError('请输入文档内容');
      return;
    }

    if (uploadMode === 'file' && !selectedFile) {
      setUploadError('请选择文件');
      return;
    }

    setUploadStatus('uploading');
    setUploadError('');

    try {
      // 与 documents/route.ts 的 POST 协议对应：文本走 content，文件走 file。
      const formData = new FormData();
      formData.append('title', title.trim());

      if (uploadMode === 'text') {
        formData.append('content', textContent);
      } else if (selectedFile) {
        formData.append('file', selectedFile);
      }

      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '上传失败');
      }

      // 202 只表示已进入队列，清空表单后立即刷新，以展示 queued/parsing 等后台状态。
      resetForm();
      setUploadStatus('queued');
      fetchDocuments(); // 刷新列表

      // 2秒后重置状态
      setTimeout(() => setUploadStatus('idle'), 2000);
    } catch (error) {
      setUploadStatus('error');
      setUploadError(error instanceof Error ? error.message : '上传失败');
    }
  };

  const handleRetry = async (docId: string) => {
    // PATCH 只重新入队，不重新上传；原始文件仍保存在 MinIO。
    try {
      const res = await fetch(`/api/documents?id=${docId}`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '重新处理失败');
      await fetchDocuments();
    } catch (error) {
      alert(error instanceof Error ? error.message : '重新处理失败');
    }
  };

  // 删除文档
  const handleDelete = async (docId: string) => {
    // 删除会清除向量和原文件，先确认以避免不可逆的误操作。
    if (!confirm('确定要删除这个文档吗？相关的向量数据也会被清除。')) {
      return;
    }

    try {
      const res = await fetch(`/api/documents?id=${docId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '删除失败');
      }

      fetchDocuments(); // 刷新列表
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除失败');
    }
  };

  // 处理文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // file input 可选值只取第一个：当前 RAG 上传接口一次只创建一份文档任务。
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // 自动用文件名填充标题（如果标题为空）
      if (!title) {
        setTitle(file.name.replace(/\.(txt|md|markdown|csv|json|pdf|docx|xlsx|xls)$/i, ''));
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Database size={20} className="text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">知识库管理</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* 上传区域 */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Upload size={16} />
              上传文档
            </h3>

            {/* 模式切换 */}
            <div className="flex gap-2">
              <button
                onClick={() => setUploadMode('text')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  uploadMode === 'text'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                文本输入
              </button>
              <button
                onClick={() => setUploadMode('file')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  uploadMode === 'file'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                文件上传
              </button>
            </div>

            {/* 标题输入 */}
            <input
              type="text"
              placeholder="文档标题"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {/* 内容输入 */}
            {uploadMode === 'text' ? (
              <textarea
                placeholder="粘贴文档内容..."
                value={textContent}
                onChange={e => setTextContent(e.target.value)}
                rows={5}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            ) : (
              <div className="space-y-2">
                <div
                  className="block w-full px-3 py-4 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors cursor-pointer text-center"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {selectedFile ? (
                    <span className="flex items-center justify-center gap-2">
                      <FileText size={16} />
                      {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </span>
                  ) : (
                    '支持 TXT、Markdown、CSV、JSON、PDF、Word、Excel（最大 10 MB）'
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.markdown,.csv,.json,.pdf,.docx,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            )}

            {/* 状态提示 */}
            {uploadStatus === 'queued' && (
              <div className="flex items-center gap-2 text-blue-600 text-sm">
                <Loader2 size={16} className="animate-spin" />
                文档已上传，正在等待异步处理
              </div>
            )}
            {uploadStatus === 'error' && uploadError && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle size={16} />
                {uploadError}
              </div>
            )}

            {/* 上传按钮 */}
            <button
              onClick={handleUpload}
              disabled={uploadStatus === 'uploading'}
              className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {uploadStatus === 'uploading' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  正在上传...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  上传并加入队列
                </>
              )}
            </button>
          </div>

          {/* 文档列表 */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <FileText size={16} />
              文档任务 ({documents.length})
            </h3>

            {loading ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 size={20} className="animate-spin mr-2" />
                加载中...
              </div>
            ) : documents.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                还没有文档，上传第一个文档开始构建知识库
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map(doc => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={16} className="text-gray-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {doc.title}
                        </div>
                        <div className="text-xs text-gray-500">
                          <StatusBadge status={doc.ingestion_status} /> · {doc.chunk_count} 个分块 · {doc.source_info || doc.source_type}
                        </div>
                        {doc.ingestion_status === 'failed' && doc.ingestion_error && (
                          <div className="mt-1 text-xs text-red-500 truncate" title={doc.ingestion_error}>
                            {doc.ingestion_error}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      {doc.ingestion_status === 'failed' && (
                        <button
                          onClick={() => handleRetry(doc.id)}
                          className="p-2 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-500 transition-colors"
                          title="重新处理"
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                        title="删除文档"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Document['ingestion_status'] }) {
  // 数据库存英文状态适合程序判断；在这里集中映射为中文和颜色，避免 JSX 中散落条件判断。
  const labels: Record<Document['ingestion_status'], string> = {
    uploaded: '已上传',
    queued: '排队中',
    parsing: '正在解析',
    indexing: '正在索引',
    ready: '已就绪',
    failed: '处理失败',
  };
  const colors: Record<Document['ingestion_status'], string> = {
    uploaded: 'text-gray-500',
    queued: 'text-blue-600',
    parsing: 'text-amber-600',
    indexing: 'text-violet-600',
    ready: 'text-green-600',
    failed: 'text-red-600',
  };
  return <span className={colors[status]}>{labels[status]}</span>;
}
