'use client';

import { Sparkles } from 'lucide-react';
import { SUGGESTIONS } from '@/lib/constants';

interface WelcomeScreenProps {
  onSend: (text: string) => void;
}

export function WelcomeScreen({ onSend }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex flex-col justify-center items-center px-4 animate-fade-in mt-50">

      <h2 className="text-2xl font-semibold mb-1.5 text-gray-800">有什么可以帮你的？</h2>
      <p className="text-gray-400 text-sm mb-8">试试下面的话题开始对话</p>

      {/* 建议卡片 */}
      <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s.title}
            onClick={() => onSend(s.text)}
            className="group text-left p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-gray-500 group-hover:text-gray-700 transition-colors">
                {s.icon}
              </span>
              <span className="text-sm font-medium text-gray-700">{s.title}</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{s.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
