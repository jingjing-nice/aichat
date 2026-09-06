// AI SDK：将模型结果以流式方式返回、限制工具调用轮数、转换前端消息格式。
import { streamText, stepCountIs, convertToModelMessages } from 'ai';
// UIMessage 是前端 useChat 发送来的消息类型，仅用于 TypeScript 类型校验。
import type { UIMessage } from 'ai';
// OpenAI 兼容 Provider 工厂；本项目通过 BASE_URL 指向实际的模型服务。
import { createOpenAI } from '@ai-sdk/openai';
// Next.js Route Handler 的请求类型，用于读取请求体和鉴权信息。
import { NextRequest } from 'next/server';
// 校验登录身份；unauthorized 统一生成 401 响应。
import { verifyAuth, unauthorized } from '@/lib/auth';
import { openUserFileTools } from '@/lib/mcp';
import { extractLastUserText, buildRagContext, type RagSource } from '@/lib/rag';

/**
 * 聊天接口在原有 LLM/MCP 能力外接入 RAG：先从当前用户知识库检索，再把命中片段
 * 拼接到 system prompt。检索并不替代模型，作用是给模型提供本次回答可依据的资料。
 */

// 1. 初始化 LLM Provider：不在请求中重复创建，所有请求复用相同 Provider 配置。
const friendli = createOpenAI({
    // 模型服务的 OpenAI 兼容地址，例如代理地址或第三方服务地址。
    baseURL: process.env.BASE_URL,
    // 模型服务密钥，仅从服务端环境变量读取，绝不暴露给浏览器。
    apiKey: process.env.API_KEY,
});

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

文件工具只允许读取当前用户独立目录内的资料，工具不可用时请如实说明。`;

export async function POST(req: NextRequest) {
    // 鉴权：未登录或登录过期直接返回 401，禁止未授权调用 LLM
    const user = verifyAuth(req);
    if (!user) return unauthorized();

    let fileTools: Awaited<ReturnType<typeof openUserFileTools>> = null;
    const closeTools = async () => { await fileTools?.close(); };
    try {
        // 解析前端提交的完整对话和可选模型名；未传模型时使用默认模型。
        const { messages, model = 'qwen3-max-2026-01-23' } = (await req.json()) as {
            messages: UIMessage[];
            model?: string;
        };

        try {
            fileTools = await openUserFileTools(user.id);
        } catch (error) {
            console.error('[MCP] 文件工具不可用:', error);
        }
        const tools = fileTools?.tools;

        // 将客户端 UIMessage（可能含 UI 专用字段）转换成模型 SDK 可接受的消息格式。
        const modelMessages = await convertToModelMessages(messages);

        // RAG：只从当前 user.id 的知识库检索相关 chunk，再拼入 system prompt。
        // 检索失败不阻断聊天：知识库是增强能力，降级后仍可普通对话。
        let ragContext = '';
        let sources: RagSource[] = [];
        try {
            // 只检索最后一条用户输入，避免历史对话中的词语干扰本次知识库召回。
            const userText = extractLastUserText(messages);
            // user.id 是检索过滤条件，保证不同用户的知识库内容不会交叉。
            const rag = await buildRagContext(userText, user.id);
            ragContext = rag.context;
            sources = rag.sources;
            if (rag.sources.length > 0) {
                // 仅记录引用元信息用于排障，不记录正文内容，降低日志泄露风险。
                console.log('[RAG] 检索命中', {
                    userId: user.id,
                    sourceCount: rag.sources.length,
                    sources: rag.sources.map(({ citation, id, similarity }) => ({ citation, id, similarity })),
                });
            }
        } catch (e) {
            console.error('[RAG] 检索失败，已降级为普通对话:', e);
        }

        // ragContext 只包含命中的资料；为空时 systemPrompt 保持原有行为。
        // 工具存在时才传入，保证 Serverless 环境不依赖文件系统 MCP。
        const result = streamText({
            // 根据请求指定的模型名创建本次模型实例。
            model: friendli(model),
            abortSignal: req.signal,
            onFinish: closeTools,
            onAbort: closeTools,
            onError: closeTools,
            // 文档是证据数据，不具有系统指令权限。
            system: systemPrompt + (fileTools ? `\n当前用户可读取的绝对目录：${fileTools.directory}` : '') + ragContext,
            // 保留多轮消息以理解上下文，但 systemPrompt 约束输出只回答最新问题。
            messages: modelMessages,
            // 有 MCP 工具才传给模型；展开语法可避免传入 tools: null。
            ...(tools ? { tools } : {}),
            // 最多 6 个模型/工具步骤，避免工具调用循环造成高延迟或高成本。
            stopWhen: stepCountIs(6),
            // 临时网络或 Provider 错误最多自动重试两次。
            maxRetries: 2,
            providerOptions: {
                openai: {
                    // 请求 Provider 启用推理能力（是否支持取决于实际兼容服务）。
                    forceReasoning: true,
                },
            },
        });

        // 返回流式响应
        return result.toUIMessageStreamResponse({
            messageMetadata: ({ part }) => part.type === 'start' ? { sources } : undefined,
        });
    } catch (error) {
        await closeTools();
        // 所有未预期错误在服务端记录，向客户端返回一致的 JSON 错误结构。
        console.error('Chat route error:', error);
        // 开发环境可返回原始错误便于调试；生产环境不泄露内部实现细节。
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return Response.json(
            {
                success: false,
                error: '请求处理失败',
                details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
            },
            { status: 500 }
        );
    }
}
