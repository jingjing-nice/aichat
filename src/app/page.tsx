'use client';

import { useState, useCallback } from 'react';
import { useConversationStore } from '@/hooks/useConversationStore';
import { Sidebar } from '@/components/Sidebar';
import { ChatView } from '@/components/ChatView';
import { WelcomeScreen } from '@/components/WelcomeScreen';

interface PendingPrompt {
  convId: string;
  text: string;
}

export default function ChatPage() {
  const {
    conversations,
    activeConversationId,
    activeConversation,
    createConversation,
    deleteConversation,
    switchConversation,
    syncMessages,
    editAndTruncate,
  } = useConversationStore();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);

  const handleNewChat = useCallback(() => {
    createConversation();
  }, [createConversation]);

  const handleSendFromWelcome = useCallback(
    (text: string) => {
      const id = createConversation();
      // 设置待发送消息，ChatView 挂载后会自动发送
      setPendingPrompt({ convId: id, text });
    },
    [createConversation],
  );

  const handlePromptConsumed = useCallback(() => {
    setPendingPrompt(null);
  }, []);

  return (
    <div className="flex h-screen bg-white">
      <Sidebar
        conversations={conversations}
        activeId={activeConversationId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(prev => !prev)}
        onNewChat={handleNewChat}
        onSelect={switchConversation}
        onDelete={deleteConversation}
      />

      <main className="flex-1 min-w-0">
        {activeConversation ? (
          <ChatView
            key={activeConversation.id}
            conversationId={activeConversation.id}
            initialMessages={activeConversation.messages}
            initialPrompt={
              pendingPrompt?.convId === activeConversation.id
                ? pendingPrompt.text
                : undefined
            }
            onPromptConsumed={handlePromptConsumed}
            onSync={syncMessages}
            onEditMessage={editAndTruncate}
          />
        ) : (
          <div className="flex flex-col h-screen">
            <WelcomeScreen onSend={handleSendFromWelcome} />
          </div>
        )}
      </main>
    </div>
  );
}
