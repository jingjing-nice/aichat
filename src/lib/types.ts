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

/** 单个对话 */
export interface Conversation {
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: string;
  updatedAt: string;
  /** 累计 token 用量 */
  tokenUsage: TokenUsage;
  /** 每条消息的用量明细 */
  messageUsages: MessageUsage[];
}

/** localStorage 存储结构 */
export interface StorageSchema {
  version: number;
  conversations: Conversation[];
  activeConversationId: string | null;
  /** 全局累计 token 用量 */
  totalTokenUsage: TokenUsage;
}
