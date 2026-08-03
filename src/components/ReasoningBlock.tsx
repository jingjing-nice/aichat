'use client';

import { useState } from 'react';
import { CheckCircle, ChevronDown, Loader2 } from 'lucide-react';

interface ReasoningBlockProps {
    content: string;
    isStreaming?: boolean;
}

export function ReasoningBlock({
    content,
    isStreaming = false,
}: ReasoningBlockProps) {
    const [open, setOpen] = useState(true);

    return (
        <div className="mb-4">
            {/* 标题栏 */}
            <button
                onClick={() => setOpen(v => !v)}
                className="
          inline-flex items-center gap-2
          px-3 py-1.5
          rounded-lg
          border border-gray-200
          bg-white
          text-sm
          text-gray-600
          hover:bg-gray-50
          transition-colors
        "
            >
                {
                    isStreaming ? (
                        <Loader2
                            size={14}
                            className="animate-spin text-blue-500"
                        />
                    ) : (
                        <CheckCircle
                            size={14}
                            className="text-green-500"
                        />
                    )
                }

                <span className="font-medium">
                    {isStreaming
                        ? 'Deep thinking...'
                        : 'Deep thinking'}
                </span>

                <ChevronDown
                    size={14}
                    className={`
            transition-transform
            ${open ? 'rotate-180' : ''}
          `}
                />
            </button>

            {/* 思考内容 */}
            <div
                className={`
          overflow-hidden
          transition-all
          duration-300
          ${open
                        ? 'max-h-[500px] mt-2'
                        : 'max-h-0'
                    }
        `}
            >
                <div
                    className="
            text-sm
            text-gray-500
            leading-relaxed
            whitespace-pre-wrap
          "
                >
                    {content}
                </div>
            </div>
        </div>
    );
}