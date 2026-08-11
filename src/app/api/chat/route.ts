import { streamText, stepCountIs, convertToModelMessages } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import { extractLastUserText, buildRagContext } from '@/lib/rag';
import path from 'path';

// 1. 初始化 LLM Provider
const friendli = createOpenAI({
    baseURL: process.env.BASE_URL,
    apiKey: process.env.API_KEY,
});

// 2. 配置基础路径 (优先环境变量，其次当前运行目录下的 aichat 文件夹)
const BASE_PATH = path.resolve(process.cwd());

// 判断是否运行在 Serverless 环境（Vercel / Cloudflare 不支持 MCP 文件系统）
const isServerless = !!(process.env.VERCEL || process.env.CF_PAGES || process.env.CF_WORKER);

// 3. System Prompt
const systemPrompt = `你是一个高效、直接的全能 AI 助手。

【最高优先级准则 - 多轮对话（严格遵守）】
1. 你的回答必须且仅针对用户最新一条消息。
2. 严禁在回答中复述、引用、总结或重述任何历史消息的内容（包括用户之前的问题和你之前的回答）。
3. 对话历史仅用于理解上下文（如指代关系、前后关联），不得出现在你的输出中。
4. 如需引用之前的结论，用代词或简短指代（如"上面那个"），不要重新输出原文。

【输出风格】
1. 直接输出答案，禁止无意义的开场白（如"好的"、"当然可以"、"以下是"）。
2. 用户请求代码时，直接输出代码块，不要前置解释。
3. 用户请求事实/答案时，直接给出结论。

【通用准则】
1. 自然交互：保持简洁专业。
2. 工具使用：仅在用户明确需要读取、查看、分析或操作文件时才调用文件工具。
3. 真实性：严禁凭空捏造文件内容，所有关于文件的回答必须基于工具返回的真实数据。

【文件操作规范】
1. 允许访问的基础根路径为：${BASE_PATH}。
2. 相对路径（如 "README.md"）必须转换为绝对路径 "${BASE_PATH}/README.md"。
3. 不要尝试访问基础路径之外的文件。`;

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

/** 获取 MCP 工具（Serverless 环境下跳过） */
async function getMCPTools() {
    if (isServerless) return null;
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
// 6. API Route Handler
// ==========================================
export async function POST(req: Request) {
    try {
        const { messages, model = 'qwen3-max-2026-01-23' } = await req.json();
        
        // 获取 MCP 工具 (复用全局连接，Serverless 环境跳过)
        let tools: any = null;
        if (!isServerless) {
            try {
                tools = await getMCPTools();
            } catch (e) {
                console.error('[MCP] 获取工具失败，尝试重建:', e);
                await closeMCP();
                tools = await getMCPTools();
            }
        }

        const modelMessages = await convertToModelMessages(messages);

        // RAG：检索知识库中与用户问题相关的资料，拼入 system prompt
        // 失败不阻断聊天（降级为普通对话）
        let ragContext = '';
        try {
            const userText = extractLastUserText(messages);
            ragContext = await buildRagContext(userText);
        } catch (e) {
            console.error('[RAG] 检索失败，已降级为普通对话:', e);
        }

        // 调用 LLM
        const result = streamText({
            model: friendli(model),
            system: systemPrompt + ragContext,
            messages: modelMessages,
            ...(tools ? { tools } : {}),
            stopWhen: stepCountIs(6),
            maxRetries: 2,
            providerOptions: {
                openai: {
                    forceReasoning: true,
                },
            },
        });

        // 返回流式响应
        return result.toUIMessageStreamResponse({});
    } catch (error) {
        console.error('Chat route error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return Response.json(
            {
                error: 'Failed to process request',
                details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
            },
            { status: 500 }
        );
    }
}
