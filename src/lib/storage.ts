import type { UIMessage } from 'ai';
import type { StorageSchema } from './types';
import { loadStateAction, saveStateAction } from './actions';

/** 从服务端 data/conversations.json 加载 */
export async function loadState(): Promise<StorageSchema> {
  return loadStateAction();
}

/** 将状态保存到服务端 data/conversations.json */
export async function saveState(state: StorageSchema): Promise<void> {
  return saveStateAction(state);
}

/** 从对话消息中提取纯文本（用于生成标题） */
export function extractTextFromMessage(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

/** 自动生成对话标题 */
export function generateTitle(messages: UIMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return '新对话';
  const text = extractTextFromMessage(firstUser);
  return text.length > 25 ? text.slice(0, 25) + '…' : text || '新对话';
}
