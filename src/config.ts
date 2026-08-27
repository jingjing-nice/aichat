// JWT 密钥从环境变量读取（.env.local 中的 JWT_SECRET_KEY）
// 未配置时降级为开发用固定值，生产环境务必配置独立密钥，否则重启后所有 token 失效且存在泄露风险
export const jwtSecretKey = process.env.JWT_SECRET_KEY || 'dev_only_insecure_secret';