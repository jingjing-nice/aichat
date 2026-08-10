'use client';

import { useState } from 'react';
import {
  FolderOpen,
  FileText,
  Search,
  FileEdit,
  Wrench,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface ToolCallBlockProps {
  /** 工具名称 */
  toolName: string;
  /** 工具调用的输入参数 */
  input?: any;
  /** 工具调用的状态 */
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'call' | 'result' | string;
  /** 工具调用的输出结果 */
  output?: any;
  /** 错误信息 */
  errorText?: string;
  /** 是否正在流式传输 */
  isStreaming?: boolean;
}

/** 根据工具名返回对应图标 */
function getToolIcon(toolName: string, size = 14) {
  const name = toolName.toLowerCase();
  if (name.includes('list') || name.includes('directory') || name.includes('folder')) {
    return <FolderOpen size={size} className="text-amber-500" />;
  }
  if (name.includes('read') || name.includes('file')) {
    return <FileText size={size} className="text-blue-500" />;
  }
  if (name.includes('write') || name.includes('edit')) {
    return <FileEdit size={size} className="text-green-500" />;
  }
  if (name.includes('search') || name.includes('grep')) {
    return <Search size={size} className="text-purple-500" />;
  }
  return <Wrench size={size} className="text-gray-500" />;
}

/** 格式化输出，对长字符串进行截断显示 */
function formatOutput(output: any): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

/** 格式化输入参数，只显示关键信息 */
function formatInput(input: any): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  // 文件相关工具：优先显示 path
  if (input.path) return input.path;
  try {
    const str = JSON.stringify(input);
    return str.length > 120 ? str.slice(0, 120) + '…' : str;
  } catch {
    return String(input);
  }
}

export function ToolCallBlock({
  toolName,
  input,
  state,
  output,
  errorText,
}: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);

  const isLoading =
    state === 'input-streaming' ||
    state === 'input-available' ||
    state === 'call';
  const isError = state === 'output-error' || !!errorText;
  const isDone = state === 'output-available' || state === 'result';

  const displayInput = formatInput(input);
  const displayOutput = formatOutput(output);

  return (
    <div className="my-2 rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* 头部：工具名 + 状态 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors"
      >
        {/* 状态图标 */}
        {isLoading ? (
          <Loader2 size={14} className="animate-spin text-blue-500 shrink-0" />
        ) : isError ? (
          <XCircle size={14} className="text-red-500 shrink-0" />
        ) : isDone ? (
          <CheckCircle2 size={14} className="text-green-500 shrink-0" />
        ) : (
          getToolIcon(toolName)
        )}

        {/* 工具名 */}
        <span className="font-medium text-gray-700 shrink-0">{toolName}</span>

        {/* 输入摘要 */}
        {displayInput && (
          <span className="text-gray-400 truncate font-mono text-xs">
            {displayInput}
          </span>
        )}

        {/* 展开箭头 */}
        <ChevronDown
          size={14}
          className={`ml-auto text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 展开的内容 */}
      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-xs">
          {/* 输入参数 */}
          {displayInput && (
            <div className="mb-2">
              <div className="text-gray-400 mb-1">输入</div>
              <pre className="text-gray-700 whitespace-pre-wrap break-all font-mono bg-white rounded px-2 py-1 border border-gray-100 max-h-40 overflow-auto">
                {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {/* 输出结果 */}
          {isError && errorText && (
            <div className="mb-2">
              <div className="text-red-400 mb-1">错误</div>
              <pre className="text-red-600 whitespace-pre-wrap break-all font-mono bg-red-50 rounded px-2 py-1 border border-red-100">
                {errorText}
              </pre>
            </div>
          )}

          {isDone && displayOutput && (
            <div>
              <div className="text-gray-400 mb-1">输出</div>
              <pre className="text-gray-700 whitespace-pre-wrap break-all font-mono bg-white rounded px-2 py-1 border border-gray-100 max-h-80 overflow-auto">
                {displayOutput}
              </pre>
            </div>
          )}

          {isLoading && (
            <div className="text-gray-400 italic">执行中…</div>
          )}
        </div>
      )}
    </div>
  );
}
