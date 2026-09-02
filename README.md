# AI Chat

基于 Next.js App Router 的全栈 AI 聊天应用，支持流式对话、MCP 工具调用、RAG 个人知识库与多用户体系。

- **项目地址**：<https://github.com/jingjing-nice/aichat.git>
- **在线体验**：<https://jing-aichat.xyz>

## 核心功能

- **流式 AI 对话**：基于 Vercel AI SDK（`streamText` + `useChat`），对接 OpenAI 兼容接口（阿里云百炼 DashScope），支持多轮对话与推理过程展示
- **MCP 工具调用**：通过 stdio 接入 `@modelcontextprotocol/server-filesystem`，AI 可读写本地文件（Serverless 环境自动降级关闭）
- **RAG 个人知识库**：文档上传 → 递归分块（带重叠）→ Embedding 入库（pgvector，1024 维）→ 向量相似度检索 → 注入对话上下文
- **用户体系**：注册 / 登录，bcrypt 密码哈希 + JWT + HttpOnly Cookie 鉴权，基于 `user_id` 外键实现多用户数据隔离
- **对话持久化**：会话与消息存储于 PostgreSQL（Neon），支持历史会话恢复、重命名与删除
- **富文本渲染**：Markdown 渲染（GFM）、代码高亮、推理块与工具调用块可视化

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 框架 | Next.js 16（App Router + Route Handler 作为 BFF） |
| 前端 | React 18 + TypeScript + Ant Design 5 + Tailwind CSS 4 + Sass |
| AI | Vercel AI SDK 6、`@ai-sdk/openai`、`@ai-sdk/mcp` |
| 数据库 | PostgreSQL（Neon）+ pgvector |
| 鉴权 | bcryptjs + jsonwebtoken（HttpOnly Cookie） |

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── chat/              # 流式对话（LLM + MCP 工具 + RAG 上下文）
│   │   ├── auth/              # 登录 / 注册
│   │   ├── conversations/     # 会话 CRUD
│   │   └── documents/         # 知识库文档管理
│   ├── login/  register/      # 认证页面
│   └── page.tsx               # 主聊天页
├── components/                # ChatView / ChatInput / MessageBubble / Sidebar 等
├── hooks/                     # useConversationStore 会话状态管理
└── lib/
    ├── auth.ts                # JWT 鉴权与 Cookie 处理
    ├── db.ts                  # PostgreSQL 连接池与建表
    ├── rag.ts                 # 分块 / 向量化 / 检索 / 上下文构建
    └── types.ts               # 类型定义
scripts/
└── init-conversation-db.ts    # 数据库表初始化脚本
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env.local`：

```bash
# LLM 与 Embedding（OpenAI 兼容接口）
BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
API_KEY=你的 API Key
EMBEDDING_MODEL=text-embedding-v4

# 数据库（Neon PostgreSQL，需已启用 pgvector 扩展）
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require

# JWT 密钥（生产环境务必配置独立密钥）
JWT_SECRET_KEY=你的随机密钥
```

### 3. 初始化数据库

```bash
npx tsx scripts/init-conversation-db.ts
```

### 4. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

> 注意：MCP 文件工具通过 `npx` 拉起本地 filesystem server，仅支持本地 / 长驻进程环境；部署到 Vercel 等 Serverless 平台时会自动跳过工具注册。

## 部署

支持一键部署到 Vercel（记得在 Vercel 控制台配置上述环境变量）：

```bash
npm run build
```

## 许可证

本项目已开源至 [GitHub](https://github.com/jingjing-nice/aichat)，开源协议详见仓库。
