'use client';

import { useRef, useEffect, useCallback } from 'react';
import { ArrowUp, StopCircle } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, onStop, isLoading, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自适应高度
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);

  const handleChange = useCallback(() => {
    resize();
  }, [resize]);

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
            {/* 左侧按钮组（预留） */}
            <div className="flex items-center gap-1" />

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
