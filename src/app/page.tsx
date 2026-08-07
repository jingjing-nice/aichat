'use client';

import { useState, useCallback } from 'react';
import { useConversationStore } from '@/hooks/useConversationStore';
import { Sidebar } from '@/components/Sidebar';
import { ChatView } from '@/components/ChatView';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { DocumentManager } from '@/components/DocumentManager';
import { Database } from 'lucide-react';

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
  const [docManagerOpen, setDocManagerOpen] = useState(false);

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

      {/* 知识库管理按钮 - 固定在右上角 */}
      <button
        onClick={() => setDocManagerOpen(true)}
        className="fixed top-3 right-3 z-50 p-2 rounded-lg bg-white border border-gray-200 shadow-sm hover:bg-blue-50 hover:border-blue-300 transition-colors group"
        title="知识库管理"
      >
        <Database size={18} className="text-gray-600 group-hover:text-blue-600" />
      </button>

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

      {/* 文档管理面板 */}
      <DocumentManager
        isOpen={docManagerOpen}
        onClose={() => setDocManagerOpen(false)}
      />
    </div>
  );
}
