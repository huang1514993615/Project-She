# Project-She agent notes

开始处理本项目之前，先完整阅读 [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)。它记录了当前架构、接口、数据结构、启动方式、生图重试机制和必须保留的产品约束。

关键要求：

- 真实密钥只在 `.env.local`，不要读取后输出、复制到文档或提交。
- 不使用数据库，不覆盖 `data` 中的个人记录和图片。
- 本地完整入口是 `node server/local-server.mjs`，公开端口必须保持 `0.0.0.0:3000`。
- 场景与角色生图使用后台任务；明确的 400 内容拒绝才允许自动合规改写，图片接口总调用最多 3 次。
- 多人回复以用户为中心，上限可设 1–10，完成一轮后必须停下让用户插话。
- 对话压缩必须同时维护 `storySummary` 与按角色 ID 保存的 `roleMemories`；未登场角色不能被删除，人物稳定身份和基础关系高于剧情摘要。
- 修改后至少运行语法检查、Vinext 构建和 `tests/rendered-html.test.mjs`。
