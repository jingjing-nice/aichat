'use client';

import { Plus, MessageSquare, Trash2, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react'; // 1. 引入 useEffect
import type { Conversation } from '@/lib/types';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

/** 按时间分组 */
function groupByTime(conversations: Conversation[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const week = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; items: Conversation[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '最近 7 天', items: [] },
    { label: '更早', items: [] },
  ];

  for (const c of conversations) {
    const d = new Date(c.updatedAt);
    if (d >= today) groups[0].items.push(c);
    else if (d >= yesterday) groups[1].items.push(c);
    else if (d >= week) groups[2].items.push(c);
    else groups[3].items.push(c);
  }

  return groups.filter(g => g.items.length > 0);
}

export function Sidebar({
  conversations,
  activeId,
  collapsed,
  onToggle,
  onNewChat,
  onSelect,
  onDelete,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 2. 增加客户端挂载状态
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // 3. 组件在客户端挂载后，标记为 true
    setIsMounted(true);
  }, []);

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onDelete(id);
    },
    [onDelete],
  );

  // 4. 核心修改：如果是服务端或客户端首次渲染，强制使用空数组
  // 这保证了首次渲染的 DOM 结构与服务端完全一致，消除 Hydration 报错
  const safeConversations = isMounted ? conversations : [];
  const groups = groupByTime(safeConversations);

  return (
    <>
      {/* 折叠状态的展开按钮 */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="fixed top-3 left-3 z-50 p-2 rounded-lg bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors"
          title="展开侧边栏"
        >
          <PanelLeft size={18} className="text-gray-600" />
        </button>
      )}

      {/* 侧边栏 */}
      <aside
        className={`
          fixed md:relative z-40 h-screen flex flex-col
          bg-[#f9f9f9] border-r border-gray-200
          transition-all duration-300 ease-in-out
          ${collapsed ? 'w-0 -translate-x-full md:-translate-x-full overflow-hidden' : 'w-[260px]'}
        `}
      >
        {/* 顶部 */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-gray-100">
          <button
            onClick={onNewChat}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200/60 transition-colors flex-1"
          >
            <Plus size={16} />
            新对话
          </button>
          <button
            onClick={onToggle}
            className="p-2 rounded-lg hover:bg-gray-200/60 transition-colors"
            title="收起侧边栏"
          >
            <PanelLeftClose size={16} className="text-gray-500" />
          </button>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto chat-scroll py-2 px-2">
          {groups.map(group => (
            <div key={group.label} className="mb-3">
              <div className="px-2 py-1 text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                {group.label}
              </div>
              {group.items.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  onMouseEnter={() => setHoveredId(conv.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`
                    group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer
                    transition-colors duration-150
                    ${conv.id === activeId
                      ? 'bg-gray-200/80 text-gray-900'
                      : 'text-gray-600 hover:bg-gray-100'
                    }
                  `}
                >
                  <MessageSquare size={14} className="shrink-0 text-gray-400" />
                  <span className="text-sm truncate flex-1">{conv.title}</span>
                  {hoveredId === conv.id && (
                    <button
                      onClick={e => handleDelete(e, conv.id)}
                      className="p-1 rounded hover:bg-gray-300/60 transition-colors shrink-0"
                      title="删除对话"
                    >
                      <Trash2 size={13} className="text-gray-500" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* 5. 使用 safeConversations 判断空状态 */}
          {safeConversations.length === 0 && (
            <div className="text-center text-gray-400 text-sm mt-8 px-4">
              还没有对话，点击上方按钮开始
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
