/**
 * 存储层：前端与数据库 API 之间的桥接层
 *
 * 【为什么单独抽这一层】
 * 1. 组件/Hook 不直接写 fetch，数据访问逻辑集中管理，接口变更只改这里
 * 2. 统一错误处理和数据结构转换（数据库返回 → 前端 StorageSchema）
 * 3. 便于测试：可以 mock 这一层而不需要真实 API
 */
import type { UIMessage } from 'ai';
import type { Conversation, MessageUsage, StorageSchema, TokenUsage } from './types';

/**
 * 从数据库加载所有对话
 *
 * 【为什么失败时返回空状态而不是抛出异常】
 * 对话列表加载失败不应该让整个应用白屏，降级为空状态后
 * 用户仍能新建对话（此时新建的对话会正常写入数据库），体验更平滑。
 */
export async function loadState(): Promise<StorageSchema> {
  try {
    const res = await fetch('/api/conversations');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const conversations: Conversation[] = await res.json();
    return {
      version: 2,
      conversations,
      // 默认激活最近更新的对话（API 已按 updated_at 倒序，第一条即最新）
      activeConversationId: conversations[0]?.id ?? null,
      // 全局 token 用量由各对话累加得出，不在数据库单独存储，避免双写不一致
      totalTokenUsage: conversations.reduce(
        (acc, c) => ({
          inputTokens: acc.inputTokens + c.tokenUsage.inputTokens,
          outputTokens: acc.outputTokens + c.tokenUsage.outputTokens,
          totalTokens: acc.totalTokens + c.tokenUsage.totalTokens,
        }),
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      ),
    };
  } catch (e) {
    console.error('[storage] 加载对话失败:', e);
    return {
      version: 2,
      conversations: [],
      activeConversationId: null,
      totalTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}

/**
 * 在数据库中创建新对话
 *
 * 注意：id 由调用方（前端）生成，配合乐观更新策略，
 * 详见 useConversationStore.createConversation 的注释
 */
export async function createConversationInDB(id: string, title: string): Promise<void> {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, title }),
  });
  if (!res.ok) throw new Error(`创建对话失败: HTTP ${res.status}`);
}

/**
 * 更新对话（标题、消息、token用量等）
 */
export async function updateConversationInDB(
  id: string,
  data: {
    title?: string;
    messages?: UIMessage[];
    tokenUsage?: TokenUsage;
    messageUsages?: MessageUsage[];
  },
): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`更新对话失败: HTTP ${res.status}`);
}

/**
 * 删除对话
 */
export async function deleteConversationInDB(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`删除对话失败: HTTP ${res.status}`);
}

/**
 * 保存整个状态（防抖全量保存，由 useConversationStore 的定时器触发）
 *
 * 【为什么逐个对话更新而不是一个接口批量提交】
 * 1. 单个对话失败不影响其他对话的保存（try/catch 隔离）
 * 2. 复用现有的 PUT 接口，无需额外的批量接口
 * 3. 对话数量少（几十个以内），串行请求的总耗时可接受
 */
export async function saveState(state: StorageSchema): Promise<void> {
  for (const conv of state.conversations) {
    try {
      await updateConversationInDB(conv.id, {
        title: conv.title,
        messages: conv.messages,
        tokenUsage: conv.tokenUsage,
        messageUsages: conv.messageUsages,
      });
    } catch (e) {
      // 单个对话保存失败仅记录日志，不阻断其他对话的保存
      console.error(`[storage] 保存对话 ${conv.id} 失败:`, e);
    }
  }
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
