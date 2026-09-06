import path from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';

const readOnlyTools = new Set([
  'list_allowed_directories', 'read_file', 'read_text_file', 'read_multiple_files', 'list_directory',
  'list_directory_with_sizes', 'directory_tree', 'search_files', 'get_file_info',
]);

/** 默认禁用；每次请求建立独立客户端，避免跨用户复用目录权限。 */
export async function openUserFileTools(userId: number) {
  if (process.env.MCP_ENABLED !== 'true' || process.env.VERCEL || process.env.CF_PAGES || process.env.CF_WORKER) return null;
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('无效用户');
  const configuredRoot = process.env.MCP_WORKSPACE_ROOT;
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) throw new Error('MCP_WORKSPACE_ROOT 必须是项目之外的绝对路径');
  // 部署管理员预先建立根目录，禁止将源码目录或其父目录作为资料根目录。
  const root = await realpath(configuredRoot);
  const project = await realpath(process.cwd());
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  if (contains(root, project) || contains(project, root)) throw new Error('MCP 资料目录不能与项目目录重叠');
  const directory = path.join(root, String(userId));
  await mkdir(directory, { recursive: true });
  if (await realpath(directory) !== directory) throw new Error('用户资料目录不允许符号链接');
  const transport = new Experimental_StdioMCPTransport({
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', directory],
  });
  const client = await createMCPClient({ transport });
  try {
    const available = await client.tools();
    const tools = Object.fromEntries(Object.entries(available).filter(([name]) => readOnlyTools.has(name)));
    let closed = false;
    return { tools, directory, close: async () => {
      if (closed) return;
      closed = true;
      try { await client.close(); } catch (error) { console.error('[MCP] 关闭失败', error); }
    } };
  } catch (error) {
    await client.close();
    throw error;
  }
}
