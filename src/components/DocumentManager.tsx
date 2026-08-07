'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, FileText, Trash2, X, Database, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

/**
 * 文档管理面板组件
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
 */

interface Document {
  id: string;
  title: string;
  source_type: string;
  source_info: string | null;
  chunk_count: number;
  created_at: string;
}

interface DocumentManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export function DocumentManager({ isOpen, onClose }: DocumentManagerProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadError, setUploadError] = useState('');
  const [uploadMode, setUploadMode] = useState<'text' | 'file'>('text');
  const [title, setTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载文档列表
  const fetchDocuments = useCallback(async () => {
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
    if (isOpen) {
      fetchDocuments();
    }
  }, [isOpen, fetchDocuments]);

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

      setUploadStatus('success');
      resetForm();
      fetchDocuments(); // 刷新列表

      // 2秒后重置状态
      setTimeout(() => setUploadStatus('idle'), 2000);
    } catch (error) {
      setUploadStatus('error');
      setUploadError(error instanceof Error ? error.message : '上传失败');
    }
  };

  // 删除文档
  const handleDelete = async (docId: string) => {
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
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // 自动用文件名填充标题（如果标题为空）
      if (!title) {
        setTitle(file.name.replace(/\.(txt|md|csv)$/, ''));
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
                    '点击选择 .txt 或 .md 文件'
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            )}

            {/* 状态提示 */}
            {uploadStatus === 'success' && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle size={16} />
                文档已成功摄入知识库
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
                  正在摄入...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  上传并摄入
                </>
              )}
            </button>
          </div>

          {/* 文档列表 */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <FileText size={16} />
              已摄入文档 ({documents.length})
            </h3>

            {loading ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 size={20} className="animate-spin mr-2" />
                加载中...
              </div>
            ) : documents.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                还没有文档，上传第一个文档开始使用 RAG
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
                          {doc.chunk_count} 个分块 · {doc.source_info || doc.source_type}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                      title="删除文档"
                    >
                      <Trash2 size={14} />
                    </button>
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
