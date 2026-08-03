# Project-She 当前上下文

最后更新：2026-08-03。当前产品是纯前端 Vue 2 + Vite H5；旧 Next/Vinext、Node API、数据库和 Worker 产品链路已经移除。

## 开始工作前

1. 先读本文件。
2. 用 [ARCHITECTURE.md](./ARCHITECTURE.md) 的“修改位置索引”选择必要文件，不要默认读取整个运行时或所有样式。
3. `data/` 和 `character-motion-engine/workspace/` 包含用户或实验资料，不删除、不覆盖、不加入公开发行包。

## 当前入口与构建

- 开发入口：`index.html` → `src/main.js`。
- 本地开发：`npm run dev`，监听 `0.0.0.0:3000`。
- 云端静态构建：`npm run build`，输出 `dist/`。
- 单文件 H5：`npm run build:standalone`，输出 `standalone/night-mailbox.html`。
- App 网页：`npm run build:app` 或 `npm run build:app-update`。
- Node.js 只用于开发构建；部署后的产品不运行 Node。

## API 与模型

- 对话配置：`chatBaseUrl`、`chatApiKey`、`chatStream`。
- 图片配置：`imageBaseUrl`、`imageApiKey`；图片 Key 为空时保存为对话 Key。
- 配置规范在 `src/features/connections/config-schema.js`。
- 用户保存连接后查询模型目录；对话和图片都必须由用户明确选择，不允许自动选择第一项。
- 图片模型差异集中在 `shared/image-models.js`；新增供应商优先增加适配器，不在页面散落模型判断。
- 静态 H5 直连依赖 API 的浏览器 CORS 支持。

## 本地数据

- 设置、历史、图片任务和 API 配置由 `src/runtime/browser-api.js` 保存在 IndexedDB/localStorage。
- 不使用数据库。
- Key 不进入构建文件；但纯前端无法提供服务器级密钥保护，页面必须如实提示用户。
- 清理浏览器站点数据会删除本地档案，重要数据先导出备份。

## 产品约束

- 世界优先初始化：先配置并选择对话模型，再定义用户和世界，再生成/编辑角色，最后生成首条剧情。
- 发行版默认档案为空，不打包作者个人世界观或私人角色。
- 性别只决定用户明确要求的称谓/角色性别，不推断性格、职业或关系。
- 每个角色有独立相册和头像；支持用户上传头像。
- AI 生成/优化内容在覆盖前展示当前值与新值，用户确认后写入。
- 图片长任务显示状态和错误；每个图片任务只请求一次图片接口，失败不自动重试。
- 多人回复以用户为中心，人数上限 1–10；一轮结束必须停下让用户插话。
- 对话压缩同时维护 `storySummary` 和按角色 ID 的 `roleMemories`。稳定身份与基础关系优先于剧情摘要，未登场角色不得删除。
- 快捷灵感由用户主动点击生成，不在每轮自动出现。

## 验证要求

修改后至少运行：

```bash
npm run check:syntax
npm run build
npm run build:standalone
node --test tests/rendered-html.test.mjs
```

可直接运行 `npm test` 完成上述检查。若只改文档，可省略构建，但交接中要说明。

## 已知架构债务

- `src/app/methods.js` 仍包含多个低频功能，新增大功能时应继续拆到 `src/features/`。
- `src/runtime/browser-api.js` 集中维护存储、资源、备份、聊天和图片任务，因为它们共享 IndexedDB/App WebView 能力；修改时按函数名和分区检索，不要全文件加载。
- `src/styles/app.css` 仍较大；角色与相册样式已经拆出，后续按功能继续渐进拆分。
