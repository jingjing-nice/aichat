'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { ArrowUp, StopCircle, Plus, ChevronDown, Globe } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, onStop, isLoading, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [deepThinkOpen, setDeepThinkOpen] = useState(false);

  // 自适应高度
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      resize();
    },
    [resize],
  );

  const handleSend = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ta.value.trim();
    if (!text || isLoading) return;
    onSend(text);
    ta.value = '';
    ta.style.height = 'auto';
  }, [isLoading, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // 提交后聚焦
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <footer className="sticky bottom-0 bg-white">
      <div className="max-w-3xl mx-auto px-4 pb-4 pt-2">
        <div className="relative rounded-2xl border border-gray-200 bg-white shadow-sm focus-within:border-gray-300 focus-within:shadow-md transition-all duration-200">
          {/* 文本输入区 */}
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="在这里输入内容，探索模型的无限可能"
            disabled={disabled}
            className="w-full resize-none border-0 bg-transparent outline-none max-h-[200px] text-[15px] placeholder:text-gray-400 px-4 pt-3 pb-1 leading-relaxed disabled:opacity-50"
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />

          {/* 底部工具栏 */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            {/* 左侧按钮组 */}
            <div className="flex items-center gap-1">
              {/* <button
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="添加"
              >
                <Plus size={18} />
              </button> */}

              {/* 深度思考按钮
              <div className="relative">
                <button
                  onClick={() => setDeepThinkOpen(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7" />
                    <path d="M9 21h6" />
                    <path d="M10 17v4" />
                    <path d="M14 17v4" />
                  </svg>
                  <span>深度思考</span>
                  <ChevronDown size={14} className={`transition-transform ${deepThinkOpen ? 'rotate-180' : ''}`} />
                </button>
              </div> */}

              {/* 搜索按钮 */}
              {/* <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <Globe size={14} />
                <span>搜索</span>
              </button> */}
            </div>

            {/* 右侧 发送按钮 */}
            <div className="flex items-center gap-3">
              {isLoading ? (
                <button
                  onClick={onStop}
                  className="h-8 w-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200 active:scale-95 transition-all duration-150 shrink-0 border border-gray-200"
                  title="停止生成"
                >
                  <StopCircle size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={disabled}
                  className="h-8 w-8 rounded-full bg-gray-800 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-700 active:scale-95 transition-all duration-150 shrink-0"
                  title="发送"
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
