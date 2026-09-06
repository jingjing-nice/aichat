# AI Chat

基于 Next.js App Router 的全栈 AI 聊天应用，支持流式对话、MCP 工具调用、RAG 个人知识库与多用户体系。

- **项目地址**：<https://github.com/jingjing-nice/aichat.git>
- **在线体验**：<https://jing-aichat.xyz>

## 核心功能

- **流式 AI 对话**：基于 Vercel AI SDK（`streamText` + `useChat`），对接 OpenAI 兼容接口（阿里云百炼 DashScope），支持多轮对话与推理过程展示
- **MCP 工具调用**：通过 stdio 接入 `@modelcontextprotocol/server-filesystem`，默认关闭；显式启用后，只读访问项目之外的用户独立资料目录（Serverless 环境自动关闭）
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
└── document-worker.ts        # 文档解析与向量化后台任务
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

# 本地对象存储（文档上传必需）
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=ai-chat-documents
MINIO_USE_SSL=false

# 文档处理队列
REDIS_URL=redis://127.0.0.1:6379

# 可选只读文件工具，公开演示保持关闭
MCP_ENABLED=false
# MCP_WORKSPACE_ROOT=/absolute/path/outside-project/user-files
```

### 3. 启动 MinIO（文档上传必需）

项目提供了本地开发用的 MinIO 服务：

```bash
docker compose up -d minio redis
```

MinIO API 运行在 `http://127.0.0.1:9000`，管理控制台在 `http://127.0.0.1:9001`。首次上传时应用会自动创建 `MINIO_BUCKET` 指定的 bucket。

### 4. 数据库自动初始化

配置好 `DATABASE_URL` 后，登录/注册接口会自动创建用户表，对话接口会创建对话表，文档上传和检索入口会创建 RAG 表。无需运行单独的建表脚本。首次使用请先登录或注册，再上传文档；Worker 启动时也会初始化文档表和用户表。新增分块外键使用 NOT VALID 兼容旧数据，新写入受外键约束，删除元数据会级联清除分块。历史孤儿数据需要另行审计后清理。

### 5. 启动开发服务器

```bash
npm run dev
```

开发和构建脚本使用 Webpack，以避开当前 Next.js/Turbopack 在上级目录存在其他锁文件时可能出现的项目根路径识别错误。

在另一终端启动文档 Worker（负责 PDF/Word/Excel/文本解析、异步切块与向量化）：

```bash
npm run worker:documents
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

> 可选 MCP：管理员先创建项目之外的资料根目录，再设置 `MCP_ENABLED=true` 和绝对路径 `MCP_WORKSPACE_ROOT`。每个用户使用 `<根目录>/<用户ID>`，每次请求创建独立只读客户端；资料目录不能与项目目录重叠，用户目录不能是符号链接。文件工具通过 `npx` 启动，仅支持常驻环境。

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

回归测试使用数据库/队列替身，不需要 API Key，也不修改真实数据库；覆盖切块边界、归属校验、事务回滚、Worker 中断状态恢复。GitHub Actions 执行相同检查。真实基础设施的故障恢复仍需按 [验收说明](docs/reliability-checklist.md) 验证。

## 部署

完整功能需要以下独立服务，单独发布 Next.js 不能完成文档索引：

| 服务 | 部署职责 |
| --- | --- |
| Web | `npm run build` 后 `npm start`，也可部署至 Vercel；配置数据库、模型、Redis 和对象存储连接 |
| Worker | 在同一版本代码的常驻 Node.js 主机运行 `npm run worker:documents`，配置与 Web 相同的数据库、Redis、MinIO 和 Embedding 模型 |
| PostgreSQL | 启用 pgvector；初始化账号需要建表、索引和扩展权限 |
| Redis | Web 和 Worker 可达，启用持久化 |
| MinIO / 兼容对象存储 | Web 和 Worker 可达，持久化原文件 |

生产环境必须设置独立 `JWT_SECRET_KEY`，缺少密钥或使用默认开发密钥时构建/启动会报错。公网 Web 应使用 HTTPS；登录 Cookie 会根据请求协议或反向代理的 `X-Forwarded-Proto` 自动启用 Secure。Compose 中的默认账号仅用于本地开发。

Vercel 上必须填写远程可达的 Redis / MinIO 地址，不能沿用 `127.0.0.1`。MCP 保持关闭。Worker 不运行在 Vercel Route Handler 内。

## 许可证

本项目已开源至 [GitHub](https://github.com/jingjing-nice/aichat)，开源协议详见仓库。
