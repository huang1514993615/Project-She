# Project-She agent notes

开始处理本项目之前，完整阅读 [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)，再按 [ARCHITECTURE.md](./ARCHITECTURE.md) 的修改索引只读取相关文件。

关键要求：

- 当前产品是纯前端 H5。Node.js 仅用于 Vite 构建，不得重新引入产品服务器、Next/Vinext、数据库或云函数依赖。
- API Key 只保存于用户当前浏览器/App 设备，不写入源码、文档和构建产物，也不要读取或输出 `.env.local`。
- 不覆盖或删除 `data/`、个人图片、聊天记录及 `character-motion-engine/workspace/`。
- 本地开发端口保持 `0.0.0.0:3000`。
- 场景与角色生图使用后台任务；失败不自动重试，每个任务只调用一次图片接口。
- 多人回复以用户为中心，上限 1–10，完成一轮后停下让用户插话。
- 对话压缩同时维护 `storySummary` 与按角色 ID 保存的 `roleMemories`；未登场角色不能被删除，稳定身份和基础关系高于剧情摘要。
- 发行版不得预装作者的个人世界设定、私人角色或个人记录。
- 修改后至少运行语法检查、Vite 静态构建、单文件 H5 构建和 `tests/rendered-html.test.mjs`。
