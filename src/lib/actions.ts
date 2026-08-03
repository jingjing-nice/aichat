'use server';

import { promises as fs } from 'fs';
import path from 'path';
import type { StorageSchema } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'conversations.json');
const TEMP_FILE = path.join(DATA_DIR, 'conversations.json.tmp');

const defaultState: StorageSchema = {
  version: 2,
  conversations: [],
  activeConversationId: null,
  totalTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
};

/** 校验存储数据结构 */
function validateState(data: unknown): StorageSchema | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  // 检查必要字段类型
  if (typeof obj.version !== 'number') return null;
  if (!Array.isArray(obj.conversations)) return null;
  if (obj.activeConversationId !== null && typeof obj.activeConversationId !== 'string') return null;
  if (!obj.totalTokenUsage || typeof obj.totalTokenUsage !== 'object') return null;
  return data as StorageSchema;
}

/** 从 data/conversations.json 加载状态（带结构校验） */
export async function loadStateAction(): Promise<StorageSchema> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = validateState(parsed);
    if (validated) return validated;
    console.warn('[actions] 数据文件格式无效，使用默认状态');
    return defaultState;
  } catch (e) {
    // 文件不存在或解析错误
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[actions] 加载状态失败:', e);
    }
    return defaultState;
  }
}

// 写入队列，串行化写入操作
let writeQueue: Promise<void> = Promise.resolve();

/** 将状态写入 data/conversations.json（原子写入 + 串行化） */
export async function saveStateAction(state: StorageSchema): Promise<void> {
  // 将写入操作加入队列，避免并发写入导致数据丢失
  writeQueue = writeQueue.then(async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      // 原子写入：先写临时文件，再重命名
      await fs.writeFile(TEMP_FILE, JSON.stringify(state, null, 2), 'utf-8');
      await fs.rename(TEMP_FILE, DATA_FILE);
    } catch (e) {
      console.error('[actions] Failed to save state:', e);
    }
  }).catch((e) => {
    console.error('[actions] 写入队列异常:', e);
  });
  return writeQueue;
}
