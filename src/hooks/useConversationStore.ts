/**
 * 对话状态管理 Hook
 *
 * 【核心设计：乐观更新（Optimistic Update）】
 * 所有写操作（新建/删除/修改消息）都是：
 *   1. 先更新内存状态 → UI 立即响应，用户无感知延迟
 *   2. 再异步写入数据库 → 失败仅记录日志，不打断用户操作
 * 这样数据库的网络延迟（尤其 Neon 冷启动）完全不影响交互体验。
 *
 * 【为什么用内存状态 + 防抖落库，而不是每次操作立即写库】
 * AI 流式对话时消息每帧都在变化（逐字输出），若每次变化都写库，
 * 一次回答会产生上百次数据库写入。防抖 1 秒后全量保存，
 * 把高频变化合并为一次写入，大幅降低数据库压力。
 */
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import type { UIMessage } from 'ai';
import type { Conversation, StorageSchema } from '@/lib/types';
import {
  loadState,
  saveState,
  generateTitle,
  createConversationInDB,
  deleteConversationInDB,
} from '@/lib/storage';

export function useConversationStore() {
  // state 为 null 表示尚未从数据库加载完成，UI 可据此显示加载态
  const [state, setState] = useState<StorageSchema | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loading = state === null;

  // 首次挂载时从数据库加载全部对话（通过 API，非直连数据库）
  useEffect(() => {
    loadState()
      .then(setState)
      .catch((e) => {
        console.error('[store] 加载状态失败:', e);
        // 加载失败降级为空状态，保证应用可用（loadState 内部已处理，这里是兑底）
        setState({
          version: 2,
          conversations: [],
          activeConversationId: null,
          totalTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        });
      });
  }, []);

  // 【防抖落库】state 每次变化都会重置定时器，停止变化 1 秒后才真正写库。
  // 这能把 AI 流式输出时的高频消息更新合并为一次数据库写入。
  // 只在加载完成（state 非 null）后启用，避免把初始空状态误写入数据库。
  useEffect(() => {
    if (!state) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveState(state), 1000);
    return () => clearTimeout(saveTimer.current);
  }, [state]);

  const activeConversation = state?.conversations.find(c => c.id === state.activeConversationId) ?? null;

  /**
   * 新建对话
   * 流程：前端生成 UUID → 立即插入本地状态并切换 → 异步写入数据库
   * 【为什么前端生成 id】乐观更新需要本地对象和数据库记录共用同一 id，
   * 等数据库返回自增 id 再更新 UI 会产生明显延迟。
   */
  const createConversation = useCallback(async () => {
    const id = uuid();
    const conv: Conversation = {
      id,
      title: '新对话',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      messageUsages: [],
    };

    // 乐观更新：先更新本地状态，UI 立即切换到新对话
    setState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        conversations: [conv, ...prev.conversations],
        activeConversationId: id,
      };
    });

    // 异步写入数据库：失败仅记日志，不阻断用户（后续消息同步会再次触发写入）
    try {
      await createConversationInDB(id, '新对话');
    } catch (e) {
      console.error('[store] 创建对话到数据库失败:', e);
    }

    return id;
  }, []);

  /**
   * 删除对话
   * 流程：立即从本地状态移除 → 异步从数据库删除（消息由数据库级联删除）
   */
  const deleteConversation = useCallback(async (id: string) => {
    // 乐观更新：先更新本地状态；若删的是当前对话，自动切换到剩余的第一个
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

    // 异步从数据库删除（messages 表会级联删除）
    try {
      await deleteConversationInDB(id);
    } catch (e) {
      console.error('[store] 从数据库删除对话失败:', e);
    }
  }, []);

  /** 切换对话：纯前端内存操作，不涉及数据库 */
  const switchConversation = useCallback((id: string) => {
    setState(prev => prev ? { ...prev, activeConversationId: id } : prev);
  }, []);

  /**
   * 同步 useChat 的消息到 store（ChatView 每次消息变化时调用）
   * 这里只更新内存状态，落库由上方的防抖 useEffect 统一处理
   */
  const syncMessages = useCallback((convId: string, messages: UIMessage[]) => {
    setState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        conversations: prev.conversations.map(c => {
          if (c.id !== convId) return c;
          // 首次出现用户消息时，用用户第一句话自动生成标题（取前 25 字）
          const needsTitle = c.messages.length === 0 && messages.some(m => m.role === 'user');
          const newTitle = needsTitle ? generateTitle(messages) : c.title;
          return {
            ...c,
            messages,
            title: newTitle,
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    });
  }, []);

  /**
   * 编辑消息：截断该消息之后的所有消息，并用新内容替换该消息
   * 之后用户重新发送，AI 基于截断后的上下文重新回答
   */
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
