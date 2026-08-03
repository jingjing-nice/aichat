'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UIMessage } from 'ai';
import { Copy, Check, RefreshCw, Pencil, X, Check as CheckIcon } from 'lucide-react';
import { CodeBlock } from './CodeBlock';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCallBlock } from './ToolCallBlock';

/** 递归提取 React 节点中的纯文本 */
const extractText = (node: any): string => {
  if (typeof node === 'string') return node;
  if (node?.props?.children) {
    return Array.isArray(node.props.children)
      ? node.props.children.map(extractText).join('')
      : extractText(node.props.children);
  }
  return '';
};

interface MessageBubbleProps {
  message: UIMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onEdit?: (messageId: string, newContent: string) => void;
}

export function MessageBubble({
  message,
  isLastAssistant,
  isStreaming,
  onCopy,
  onRegenerate,
  onEdit,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  const isUser = message.role === 'user';

  const handleCopyFull = useCallback(() => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopy]);

  const handleStartEdit = useCallback(() => {
    const text = message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('');
    setEditContent(text);
    setIsEditing(true);
  }, [message.parts]);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editContent.trim();
    if (trimmed && trimmed !== extractTextFromParts(message.parts)) {
      onEdit?.(message.id, trimmed);
    }
    setIsEditing(false);
  }, [editContent, message.id, message.parts, onEdit]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  // 编辑模式下自适应高度 + 聚焦
  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.style.height = 'auto';
      editRef.current.style.height = editRef.current.scrollHeight + 'px';
      editRef.current.focus();
    }
  }, [isEditing]);

  /* ─ 用户消息 ── */
  if (isUser) {
    return (
      <div className="group animate-fade-in-up">
        {isEditing ? (
          <div className="max-w-3xl mx-auto">
            <textarea
              ref={editRef}
              value={editContent}
              onChange={e => {
                setEditContent(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveEdit();
                }
                if (e.key === 'Escape') handleCancelEdit();
              }}
              className="w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-[15px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              rows={2}
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1.5 text-xs text-white bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-1"
              >
                <CheckIcon size={12} />
                保存并发送
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-[#f0edff] rounded-xl px-5 py-4 text-[15px] leading-relaxed text-gray-800">
            {message.parts.map((part, i) => {
              if (part.type !== 'text') return null;
              return <span key={i}>{part.text}</span>;
            })}
          </div>
        )}
        {/* 编辑按钮 */}
        {!isStreaming && onEdit && !isEditing && (
          <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={handleStartEdit}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-all"
              title="编辑消息"
            >
              <Pencil size={13} />
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── AI 消息 ── */
  return (
    <div className="group animate-fade-in-up">
      <div className="flex-1 min-w-0">
        {/* Markdown 内容 */}
        {message.parts.map((part, pIndex) => {
          if (part.type === 'reasoning') {
            return <ReasoningBlock
              key={pIndex}
              content={part.text}
              isStreaming={isStreaming}
            />
          }

          if (part.type === 'dynamic-tool') {
            return <ToolCallBlock key={part.toolCallId} {...part} />;
          }

          if (part.type !== 'text') return null;

          return (
            <div key={pIndex} className="prose prose-sm max-w-none text-gray-800 prose-p:my-2 prose-headings:my-3 prose-pre:my-0 prose-li:my-0.5 prose-a:text-blue-500">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre({ children }) {
                    const codeText = extractText(children);
                    // 尝试从子元素提取语言
                    let lang = 'text';
                    const codeChild = findCodeChild(children);
                    if (codeChild?.props?.className) {
                      const match = /language-(\w+)/.exec(codeChild.props.className);
                      if (match) lang = match[1];
                    }
                    return <CodeBlock code={codeText} language={lang} />;
                  },
                  code({ className, children, ...props }) {
                    const isInline = !className;
                    return isInline ? (
                      <code
                        className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded-md text-[0.85em] font-mono border border-gray-200"
                        {...props}
                      >
                        {children}
                      </code>
                    ) : (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {part.text}
              </ReactMarkdown>
            </div>
          );
        })}

        {/* 操作栏 */}
        {!isStreaming && (
          <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={handleCopyFull}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-all"
              title="复制回答"
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
            {isLastAssistant && (
              <button
                onClick={onRegenerate}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-all"
                title="重新生成"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 从 React 节点中提取纯文本 */
function extractTextFromParts(parts: UIMessage['parts']): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

/** 递归查找 code 子元素 */
function findCodeChild(children: any): any {
  if (!children) return null;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findCodeChild(child);
      if (found) return found;
    }
    return null;
  }
  if (children?.type === 'code' || children?.props?.className?.includes('language-')) {
    return children;
  }
  if (children?.props?.children) {
    return findCodeChild(children.props.children);
  }
  return null;
}
