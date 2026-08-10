/**
 * 对话相关类型定义（前后端共用）
 *
 * 【与数据库的映射关系】
 * Conversation ↔ conversations 表（一条记录对应一个对话）
 * UIMessage    ↔ messages 表（一条记录对应一条消息，一对多）
 *
 * 【命名约定】
 * 前端/这里用驼峰（createdAt），数据库用下划线（created_at），
 * 两者在 API 层（src/app/api/conversations/）做转换。
 */
import type { UIMessage } from 'ai';

/** Token 用量记录 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** 单条消息的用量元数据 */
export interface MessageUsage {
  messageId: string;
  usage: TokenUsage;
  timestamp: string;
  model: string;
}

/**
 * 单个对话
 * 对应数据库 conversations 表 + 其关联的 messages 记录
 */
export interface Conversation {
  /** 前端生成的 UUID（乐观更新需要，详见 useConversationStore 注释） */
  id: string;
  title: string;
  /** AI SDK 的消息结构，存入数据库时序列化为 JSONB */
  messages: UIMessage[];
  createdAt: string;
  /** 侧边栏按此字段排序和时间分组（今天/昨天/最近 7 天/更早） */
  updatedAt: string;
  /** 累计 token 用量，存为 JSONB */
  tokenUsage: TokenUsage;
  /** 每条消息的用量明细，存为 JSONB 数组 */
  messageUsages: MessageUsage[];
}

/**
 * 应用状态结构（对话数据持久化至 PostgreSQL）
 *
 * 注意：activeConversationId 和 totalTokenUsage 只存在于前端内存，
 * 不存入数据库：前者是纯 UI 状态，后者可由各对话用量累加得出，
 * 不落库可减少数据冗余和不一致风险。
 */
export interface StorageSchema {
  version: number;
  conversations: Conversation[];
  activeConversationId: string | null;
  /** 全局累计 token 用量 */
  totalTokenUsage: TokenUsage;
}
