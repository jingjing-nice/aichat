/**
 * 单个对话详情 API（Next.js 动态路由）
 * 提供单个对话的查询（GET）、更新（PUT）、删除（DELETE）
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, initConversationTables } from '@/lib/db';
import type { UIMessage } from 'ai';
import type { MessageUsage, TokenUsage } from '@/lib/types';

// Next.js 15+ 的动态路由参数是 Promise，需要 await 获取
type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/conversations/[id]
 * 获取单个对话详情（含消息）
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await initConversationTables();
    const { id } = await context.params;

    // 获取对话信息
    const convResult = await query(
      `SELECT id, title, created_at, updated_at, token_usage, message_usages
       FROM conversations WHERE id = $1`,
      [id],
    );

    if (convResult.rows.length === 0) {
      return NextResponse.json({ error: '对话不存在' }, { status: 404 });
    }

    const conv = convResult.rows[0];

    // 获取消息
    const msgResult = await query(
      `SELECT id, role, content, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id],
    );

    const messages: UIMessage[] = msgResult.rows.map((msg: { id: string; role: string; content: unknown }) => ({
      id: msg.id,
      role: msg.role as UIMessage['role'],
      parts: msg.content as UIMessage['parts'],
    }));

    return NextResponse.json({
      id: conv.id,
      title: conv.title,
      messages,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      tokenUsage: conv.token_usage,
      messageUsages: conv.message_usages ?? [],
    });
  } catch (error) {
    console.error('[API] GET /api/conversations/[id] 失败:', error);
    return NextResponse.json({ error: '获取对话详情失败' }, { status: 500 });
  }
}

/**
 * PUT /api/conversations/[id]
 * 更新对话（标题、消息、token用量等）
 *
 * 【为什么消息采用"全量替换"而不是增量同步】
 * 消息存在编辑、截断、重新生成等操作，增量 diff 逻辑复杂且容易出错
 * （需要追踪每条消息的新增/修改/删除）。全量替换逻辑简单、结果确定，
 * 单个对话的消息量通常只有几十条，全量重写的成本完全可接受。
 *
 * 【为什么支持部分字段更新】
 * 前端不同场景只需更新不同字段（改标题、同步消息、记录 token），
 * 未传的字段用 COALESCE 保留原值，避免调用方必须先读后写。
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    await initConversationTables();
    const { id } = await context.params;
    const body = await request.json();
    const {
      title,
      messages,
      tokenUsage,
      messageUsages,
    } = body as {
      title?: string;
      messages?: UIMessage[];
      tokenUsage?: TokenUsage;
      messageUsages?: MessageUsage[];
    };

    // 先检查对话是否存在，对不存在的 id 返回 404 而不是静默成功
    const existing = await query(`SELECT id FROM conversations WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: '对话不存在' }, { status: 404 });
    }

    // 更新对话元数据：COALESCE(新值, 旧值) 实现"传了才更新，没传保留"
    if (title !== undefined || tokenUsage !== undefined || messageUsages !== undefined) {
      await query(
        `UPDATE conversations SET
          title = COALESCE($1, title),
          token_usage = COALESCE($2::jsonb, token_usage),
          message_usages = COALESCE($3::jsonb, message_usages),
          updated_at = NOW()
        WHERE id = $4`,
        [
          title ?? null,
          // JSONB 字段需要序列化为字符串后显式转型 ::jsonb
          tokenUsage ? JSON.stringify(tokenUsage) : null,
          messageUsages ? JSON.stringify(messageUsages) : null,
          id,
        ],
      );
    }

    // 更新消息：全量替换策略 = 先清空旧消息，再重新插入
    if (messages !== undefined) {
      await query(`DELETE FROM messages WHERE conversation_id = $1`, [id]);

      if (messages.length > 0) {
        // 逐条插入：单对话消息量小，逐条写简单可靠；
        // 若未来消息量大可优化为多行 VALUES 批量插入
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          await query(
            `INSERT INTO messages (id, conversation_id, role, content)
             VALUES ($1, $2, $3, $4::jsonb)`,
            // 兼容无 id 的消息：用"对话id+序号"生成兑底 id，保证主键非空
            [msg.id || `msg-${id}-${i}`, id, msg.role, JSON.stringify(msg.parts)],
          );
        }
      }

      // 有新消息说明对话活跃，刷新 updated_at（侧边栏按此字段排序和分组）
      await query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [id]);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] PUT /api/conversations/[id] 失败:', error);
    return NextResponse.json({ error: '更新对话失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/conversations/[id]
 * 删除对话
 *
 * 【为什么只需删除 conversations 一条记录】
 * messages 表的外键定义了 ON DELETE CASCADE，数据库会自动
 * 级联删除该对话的所有消息，应用层无需手动清理，也不会留下孤儿数据。
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await initConversationTables();
    const { id } = await context.params;

    // 先确认存在再删，给前端明确的 404 语义（而非"删除 0 行"的静默成功）
    const existing = await query(`SELECT id FROM conversations WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: '对话不存在' }, { status: 404 });
    }

    await query(`DELETE FROM conversations WHERE id = $1`, [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] DELETE /api/conversations/[id] 失败:', error);
    return NextResponse.json({ error: '删除对话失败' }, { status: 500 });
  }
}
