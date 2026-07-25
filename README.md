# 夜航信箱

基于 Vue 2 的移动端 AI 陪伴页面，服务端使用 Node.js 兼容的 Next.js Route Handler。

## 功能

- DeepSeek 多轮流式对话
- 角色名字、成年年龄、性格和关系设定
- 可勾选的共同任务、积分与本地记忆
- 根据最近对话生成场景提示词，再调用兼容图片接口出图
- 未配置密钥时自动进入可交互演示模式

## 本地运行

1. 复制 `.env.example` 为 `.env.local`
2. 填写 `DEEPSEEK_API_KEY`
3. 如需实时出图，再填写 `IMAGE_API_KEY` 和对应图片接口配置
4. 执行 `pnpm install`，再执行 `pnpm dev`

密钥只在服务端读取，不会发送到浏览器。DeepSeek 接口默认使用
`https://api.deepseek.com/chat/completions`。
