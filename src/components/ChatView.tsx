'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';

interface ChatViewProps {
  conversationId: string;
  initialMessages: UIMessage[];
  initialPrompt?: string;
  onPromptConsumed?: () => void;
  onSync: (convId: string, messages: UIMessage[]) => void;
  onEditMessage: (convId: string, messageId: string, newContent: string) => void;
}

export function ChatView({
  conversationId,
  initialMessages,
  initialPrompt,
  onPromptConsumed,
  onSync,
  onEditMessage,
}: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const promptSentRef = useRef(false);

  const { messages, sendMessage, status, stop, regenerate, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    messages: initialMessages,
  });

  const isLoading = status === 'streaming' || status === 'submitted';
  const isStreaming = status === 'streaming';

  // 挂载时发送待发送消息（来自 WelcomeScreen）
  useEffect(() => {
    if (initialPrompt && !promptSentRef.current) {
      promptSentRef.current = true;
      sendMessage({ text: initialPrompt });
      onPromptConsumed?.();
    }
  }, [initialPrompt, onPromptConsumed, sendMessage]);

  // 同步消息到 store
  useEffect(() => {
    if (messages.length > 0) {
      onSync(conversationId, messages);
    }
  }, [messages, conversationId, onSync]);

  // 监听滚动：用户上滑时暂停自动滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      shouldAutoScroll.current = nearBottom;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (shouldAutoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, status]);

  const handleSend = useCallback(
    (text: string) => {
      sendMessage({ text });
    },
    [sendMessage],
  );

  const handleEdit = useCallback(
    (messageId: string, newContent: string) => {
      // 截断后续消息并更新编辑的内容
      const idx = messages.findIndex(m => m.id === messageId);
      if (idx === -1) return;

      onEditMessage(conversationId, messageId, newContent);

      // 更新 useChat 的本地消息并重新发送
      const truncated = messages.slice(0, idx);
      const edited: UIMessage = {
        ...messages[idx],
        parts: [{ type: 'text', text: newContent }],
      };
      // setMessages 同步更新内部状态，sendMessage 会立即使用新消息
      setMessages([...truncated, edited]);
      sendMessage({ text: newContent });
    },
    [messages, conversationId, onEditMessage, setMessages, sendMessage],
  );

  const handleCopy = useCallback((msg: UIMessage) => {
    const text = msg.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('');
    navigator.clipboard.writeText(text);
  }, []);

  return (
    <div className="flex flex-col h-screen flex-1">
      {/* 消息区域 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll">
        {messages.length === 0 ? (
          <WelcomeScreen onSend={handleSend} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6">
            <div className="space-y-4">
              {messages.map((message, index) => (
                <div key={message.id}>
                  <MessageBubble
                    message={message}
                    isLastAssistant={
                      message.role === 'assistant' &&
                      !messages.slice(index + 1).some(m => m.role === 'assistant')
                    }
                    isStreaming={isStreaming}
                    onCopy={() => handleCopy(message)}
                    onRegenerate={regenerate}
                    onEdit={message.role === 'user' ? handleEdit : undefined}
                  />
                  {/* 用户消息后添加分隔线 */}
                  {message.role === 'user' && index < messages.length - 1 && (
                    <hr className="border-gray-100 my-4" />
                  )}
                </div>
              ))}

              {/* 打字指示器 */}
              {isLoading && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex items-center gap-1.5 animate-fade-in-up py-2">
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce-dot"
                      style={{ animationDelay: `${i * 0.16}s` }}
                    />
                  ))}
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </div>

      {/* 输入框 */}
      <ChatInput onSend={handleSend} onStop={stop} isLoading={isLoading} />
    </div>
  );
}
