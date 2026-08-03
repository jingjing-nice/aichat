import { Lightbulb, PenLine, BookOpen, Code2 } from 'lucide-react';
import type { ReactNode } from 'react';

export interface Suggestion {
  icon: ReactNode;
  title: string;
  text: string;
  desc: string;
}

export const SUGGESTIONS: Suggestion[] = [
  { icon: <Lightbulb size={18} />, title: '头脑风暴', text: '帮我头脑风暴一些创业想法', desc: '激发创意，探索可能性' },
  { icon: <PenLine size={18} />, title: '写作助手', text: '帮我润色一段文字', desc: '优化表达，提升文采' },
  { icon: <BookOpen size={18} />, title: '知识问答', text: '解释一下量子计算的基本原理', desc: '深入浅出，通俗易懂' },
  { icon: <Code2 size={18} />, title: '代码助手', text: '帮我写一个排序算法的实现', desc: '编写代码，调试问题' },
];
