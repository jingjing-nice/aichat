/**
 * 对话列表 API（Next.js Route Handler）
 *
 * 【架构说明】
 * 前端不直接连数据库，而是通过这层 REST API 中转，原因：
 * 1. 安全：DATABASE_URL 只存在于服务端，不会暴露给浏览器
 * 2. 兼容：Vercel Serverless 环境下，API Route 与函数计算模型天然契合
 * 3. 解耦：前端只依赖 HTTP 接口，未来换数据库/换 ORM 不影响前端代码
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, initConversationTables } from '@/lib/db';
import { verifyAuth, unauthorized } from '@/lib/auth';
import type { UIMessage } from 'ai';
import type { Conversation, MessageUsage, TokenUsage } from '@/lib/types';

/**
 * GET /api/conversations
 * 获取所有对话列表（含消息）
 *
 * 【为什么一次性加载全部对话和消息】
 * 应用启动时需要渲染侧边栏（全部对话）+ 当前对话的消息，
 * 个人应用的对话量级小（几十条），一次拉全比按需懒加载更简单，
 * 避免切换对话时再发请求带来的加载延迟。
 */
export async function GET(request: NextRequest) {
  // 鉴权：未登录或登录过期返回 401，防止未授权读取对话数据
  const user = verifyAuth(request);
  if (!user) return unauthorized();



  try {
    // 幂等建表：首次部署时无需手动执行迁移脚本，表不存在会自动创建
    await initConversationTables();

    // 查询 1：当前用户的所有对话，按更新时间倒序（最近活跃的排最前，侧边栏直接可用）
    // 【数据隔离】一律按 JWT 中的 user_id 过滤，用户之间互不可见
    const convResult = await query(`
      SELECT id, title, created_at, updated_at, token_usage, message_usages
      FROM conversations
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `, [user.id]);

    // 查询 2：该用户的所有消息，按创建时间正序（保证对话内消息顺序正确）
    // 【为什么分两次查询而不用 JOIN】
    // JOIN 会把对话元数据在每条消息行上重复，数据冗余且需要去重；
    // 分两次查询 + 内存分组更直观，对话量小时性能差异可忽略
    const msgResult = await query(`
      SELECT m.id, m.conversation_id, m.role, m.content, m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id AND c.user_id = $1
      ORDER BY m.created_at ASC
    `, [user.id]);

    // 内存中按 conversation_id 分组消息，并把数据库行映射为前端的 UIMessage 结构
    const messagesByConv = new Map<string, UIMessage[]>();
    for (const msg of msgResult.rows) {
      const convId = msg.conversation_id;
      if (!messagesByConv.has(convId)) {
        messagesByConv.set(convId, []);
      }
      // 数据库存的是 role + content(JSONB)，这里还原为 AI SDK 的 UIMessage 格式
      const uiMsg: UIMessage = {
        id: msg.id,
        role: msg.role as UIMessage['role'],
        parts: Array.isArray(msg.content) ? msg.content : msg.content.parts,
        metadata: Array.isArray(msg.content) ? undefined : msg.content.metadata,
      };
      messagesByConv.get(convId)!.push(uiMsg);
    }

    // 组装最终结果：数据库下划线命名 → 前端驼峰命名，保持前端类型一致
    const result: Conversation[] = convResult.rows.map((conv: {
      id: string;
      title: string;
      created_at: string;
      updated_at: string;
      token_usage: TokenUsage;
      message_usages: MessageUsage[];
    }) => ({
      id: conv.id,
      title: conv.title,
      messages: messagesByConv.get(conv.id) ?? [],
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      tokenUsage: conv.token_usage,
      messageUsages: conv.message_usages ?? [],
    }));

    return NextResponse.json(result);
  } catch (error) {
    // 服务端日志保留完整错误便于排查，对前端只返回通用错误信息（不泄露内部细节）
    console.error('[API] GET /api/conversations 失败:', error);
    return NextResponse.json({ success: false, error: '获取对话列表失败' }, { status: 500 });
  }
}

/**
 * POST /api/conversations
 * 创建新对话
 *
 * 【为什么 id 由前端生成而不是数据库自增】
 * 前端采用乐观更新策略：点击"新建对话"时立即在本地创建对话并切换过去，
 * 再异步写入数据库。前端生成 UUID 才能让本地对象和数据库记录用同一个 id，
 * 后续的更新/删除操作可以直接用这个 id，无需等待服务端响应。
 */
export async function POST(request: NextRequest) {
  const user = verifyAuth(request);
  if (!user) return unauthorized();

  try {
    await initConversationTables();
    const body = await request.json();
    const { id, title } = body as { id: string; title?: string };

    // 参数校验：id 是主键，缺失时直接 400，避免数据库报错信息泄露给前端
    if (!id) {
      return NextResponse.json({ success: false, error: '缺少对话 id' }, { status: 400 });
    }

    // 对话归属当前登录用户（user_id 用于数据隔离）
    await query(
      `INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)`,
      [id, user.id, title ?? '新对话'],
    );

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[API] POST /api/conversations 失败:', error);
    return NextResponse.json({ success: false, error: '创建对话失败' }, { status: 500 });
  }
}
