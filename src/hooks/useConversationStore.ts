'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import type { UIMessage } from 'ai';
import type { Conversation, StorageSchema } from '@/lib/types';
import { loadState, saveState, generateTitle } from '@/lib/storage';

export function useConversationStore() {
  const [state, setState] = useState<StorageSchema | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loading = state === null;

  // 异步加载初始数据
  useEffect(() => {
    loadState()
      .then(setState)
      .catch((e) => {
        console.error('[store] 加载状态失败:', e);
        setState({
          version: 2,
          conversations: [],
          activeConversationId: null,
          totalTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        });
      });
  }, []);

  // 防抖保存到服务端（仅在加载完成后）
  useEffect(() => {
    if (!state) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveState(state), 500);
    return () => clearTimeout(saveTimer.current);
  }, [state]);

  const activeConversation = state?.conversations.find(c => c.id === state.activeConversationId) ?? null;

  /** 新建对话 */
  const createConversation = useCallback(() => {
    const conv: Conversation = {
      id: uuid(),
      title: '新对话',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      messageUsages: [],
    };
    setState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        conversations: [conv, ...prev.conversations],
        activeConversationId: conv.id,
      };
    });
    return conv.id;
  }, []);

  /** 删除对话 */
  const deleteConversation = useCallback((id: string) => {
    setState(prev => {
      if (!prev) return prev;
      const filtered = prev.conversations.filter(c => c.id !== id);
      return {
        ...prev,
        conversations: filtered,
        activeConversationId:
          prev.activeConversationId === id
            ? (filtered[0]?.id ?? null)
            : prev.activeConversationId,
      };
    });
  }, []);

  /** 切换对话 */
  const switchConversation = useCallback((id: string) => {
    setState(prev => prev ? { ...prev, activeConversationId: id } : prev);
  }, []);

  /** 同步 useChat 消息回 store（每次消息变化时调用） */
  const syncMessages = useCallback((convId: string, messages: UIMessage[]) => {
    setState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        conversations: prev.conversations.map(c => {
          if (c.id !== convId) return c;
          // 第一次有用户消息时自动生成标题
          const needsTitle = c.messages.length === 0 && messages.some(m => m.role === 'user');
          return {
            ...c,
            messages,
            title: needsTitle ? generateTitle(messages) : c.title,
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    });
  }, []);

  /** 编辑消息后截断并重发 */
  const editAndTruncate = useCallback((convId: string, messageId: string, newContent: string) => {
    setState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        conversations: prev.conversations.map(c => {
          if (c.id !== convId) return c;
          const idx = c.messages.findIndex(m => m.id === messageId);
          if (idx === -1) return c;
          const truncated = c.messages.slice(0, idx);
          const edited: UIMessage = {
            ...c.messages[idx],
            parts: [{ type: 'text', text: newContent }],
          };
          return {
            ...c,
            messages: [...truncated, edited],
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    });
  }, []);

  return {
    loading,
    conversations: state?.conversations ?? [],
    activeConversationId: state?.activeConversationId ?? null,
    activeConversation,
    createConversation,
    deleteConversation,
    switchConversation,
    syncMessages,
    editAndTruncate,
  };
}
