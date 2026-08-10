/**
 * 初始化对话数据库表结构（可选脚本）
 * 运行方式：npx tsx scripts/init-conversation-db.ts
 *
 * 【说明】
 * 这是一个可选的手动初始化脚本。由于 API 层会在每次请求时
 * 自动调用 initConversationTables()（幂等建表），即使不运行本脚本，
 * 首次访问应用时表也会自动创建。本脚本主要用于：
 * 1. 部署前主动建表，避免首次请求时的建表延迟
 * 2. 验证 DATABASE_URL 连接串是否配置正确
 *
 * 需要在 .env.local 中配置 DATABASE_URL
 */

import 'dotenv/config';
import { initConversationTables, closePool } from '../src/lib/db';

async function main() {
  console.log('开始初始化对话表...');
  await initConversationTables();
  console.log('初始化完成！');
  // 必须关闭连接池，否则打开的 socket 会阻止 Node.js 进程退出
  await closePool();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('初始化失败:', err);
  await closePool();
  process.exit(1);
});
