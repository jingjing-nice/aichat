import { streamText, stepCountIs, convertToModelMessages } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import path from 'path';

// 1. 初始化 LLM Provider
const friendli = createOpenAI({
    baseURL: process.env.BASE_URL,
    apiKey: process.env.API_KEY,
});

// 2. 配置基础路径 (优先环境变量，其次当前运行目录下的 aichat 文件夹)
const BASE_PATH = path.resolve(process.cwd());

// 3. System Prompt
const systemPrompt = `你是一个高效、直接的全能 AI 助手。
【最高优先级准则 - 多轮对话】
1. **只回答当前问题**: 对话历史仅作为上下文参考，你的输出必须且只针对用户最新一条消息作出回答，严禁重复或复述任何历史消息内容。
2. **不重复历史**: 不要在回答中输出之前已经回答过的内容，直接给出针对当前问题的新内容。

【最高优先级准则 - 输出风格】
1. **拒绝啰嗦**: 严禁输出”好的”、”这是一个Demo”、”以下是代码”等无意义的开场白或结束语。
2. **直接响应**: 
   - 如果用户请求代码/Demo，**直接输出代码块**，不要有任何前置解释。 
   - 如果用户请求事实/答案，**直接给出结论**，除非用户明确要求”解释原因”。
3. **聚焦当前指令**: 历史消息仅供理解上下文，当前用户指令才是本次回答的唯一目标。

【通用准则】
1. 自然交互：对于常规问答，保持简洁专业。
2. 工具使用：仅在用户明确需要读取、查看、分析或操作文件时，才调用提供的文件工具。
3. 真实性：严禁凭空捏造文件内容。所有关于文件的回答必须基于工具返回的真实数据。

【文件操作规范】
当调用文件工具时，请严格遵守以下路径规则：
1. 允许访问的基础根路径为：${BASE_PATH}。
2. 路径转换：如果用户提供相对路径（如 “README.md”），你必须将其转换为绝对路径 “${BASE_PATH}/README.md” 后再调用工具。
3. 安全限制：不要尝试访问基础路径之外的文件。`;

// ==========================================
// 4. MCP Client 全局单例管理 (核心优化)
// ==========================================
let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
let mcpTools: any = null;
let mcpInitializing: Promise<any> | null = null;

/** 重置 MCP 客户端状态 */
function resetMCPClient() {
    mcpClient = null;
    mcpTools = null;
    mcpInitializing = null;
}

/** 初始化 MCP 工具（带并发控制） */
async function initMCPTools() {
    if (mcpInitializing) {
        return mcpInitializing;
    }
    mcpInitializing = (async () => {
        console.log(`[MCP] 初始化文件系统服务，路径: ${BASE_PATH}`);
        const transport = new Experimental_StdioMCPTransport({
            command: 'npx',
            args: ["-y", "@modelcontextprotocol/server-filesystem", BASE_PATH],
        });
        mcpClient = await createMCPClient({ transport });
        mcpTools = await mcpClient.tools();
        mcpInitializing = null;
        return mcpTools;
    })();
    return mcpInitializing;
}

/** 获取 MCP 工具（带健康检查：失败时自动重建） */
async function getMCPTools() {
    if (!mcpTools) {
        return initMCPTools();
    }
    return mcpTools;
}

/** 关闭 MCP 客户端（用于优雅退出） */
const closeMCP = async () => {
    if (mcpClient) {
        console.log('[MCP] 正在关闭客户端...');
        try {
            await mcpClient.close();
        } catch (e) {
            console.error('[MCP] 关闭失败:', e);
        }
        resetMCPClient();
    }
};

// 进程退出时优雅清理 MCP 客户端，防止僵尸进程
process.on('SIGINT', async () => {
    await closeMCP();
    // 不调用 process.exit，让 Next.js 自行处理关闭流程
});
process.on('SIGTERM', async () => {
    await closeMCP();
});

// ==========================================
// 5. API Route Handler
// ==========================================
export async function POST(req: Request) {
    try {
        // 增加请求体类型断言
        const { messages, id, model = 'qwen3-max-2026-01-23' } = await req.json()
        // 获取 MCP 工具 (复用全局连接，避免每次请求都启动 npx)
        let tools: any;
        try {
            tools = await getMCPTools();
        } catch (e) {
            console.error('[MCP] 获取工具失败，尝试重建:', e);
            // 清理并重建 MCP 客户端
            await closeMCP();
            tools = await getMCPTools();
        }

        const modelMessages = await convertToModelMessages(messages)

        // 调用 LLM
        const result = streamText({
            model: friendli(model),
            system: systemPrompt,
            messages: modelMessages,
            tools,
            stopWhen: stepCountIs(6),
            maxRetries: 2,
            providerOptions: {
                openai: {
                    forceReasoning: true,
                },
            },
        });

        // 返回流式响应
        return result.toUIMessageStreamResponse({

        });
    } catch (error) {
        console.error('Chat route error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // 在开发环境下返回具体错误信息，方便调试
        return Response.json(
            {
                error: 'Failed to process request',
                details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
            },
            { status: 500 }
        );
    }
}
