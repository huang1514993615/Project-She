# Character Motion Engine 项目上下文

> 独立项目目录：`C:\Users\hcq\Documents\Project-She\character-motion-engine`

## 目标

把 AI 角色从“整张图片轮播”升级为可组合的分层表演系统，并最终作为一个 JS 包被夜航信箱单文件 HTML、Node H5 或其他网页调用。

本项目必须保持独立，不直接修改夜航信箱的数据文件、人物记录或图片。

## 当前结构

- `src/character-motion.js`：零依赖核心引擎。
- `demo/index.html`：独立演示入口。
- `demo/demo.js`：演示时间线和控件。
- `demo/demo.css`：演示页面样式。
- `scripts/build.mjs`：输出 ESM 与 IIFE 包。
- `tests/engine.test.mjs`：协议和解析测试。
- `dist/character-motion.esm.js`：模块化网页使用。
- `dist/character-motion.iife.js`：普通 HTML 通过 `<script>` 直接使用。
- `assets/character/source/`：四张绿色键色生成源图。
- `assets/character/transparent/`：自然、挥手、伸手和施法四张透明动作图。

## 核心概念

1. 持续动作层：呼吸、随机眨眼、头发/饰品摆动。
2. 表演通道：表情、动作、视线和说话分别控制。
3. 时间线：AI 的 `visual.sequence` 包含 1–8 个阶段，每段有状态、情绪、动作、视线、强度和持续时间。
4. 分层素材：推荐透明 WebP，所有层必须使用相同画布、缩放、人物位置和脚底基线。
5. 降级策略：没有图片时显示程序化占位角色；早期也可把现有整张动作图放入 `base` 通道。

## 后续优先事项

1. 增加角色素材编辑器和画布对齐工具。
2. 增加眼睛、嘴型等局部图层遮罩与自动裁切。
3. 增加动作片段混合和可中断的优先级队列。
4. 增加资源按需预载、WebP 尺寸检查和手机内存预算。
5. 最后再接入夜航信箱：直接调用 `player.playVisual(message.visual)`。

当前演示已经用四张统一人物形象替换程序化占位角色，但仍属于“完整人物状态图”。持续呼吸、眨眼调度和时间线由引擎负责；眼睛、嘴型、头发和手臂真正拆层仍是下一阶段工作。

## 验证

```powershell
node --check src/character-motion.js
node --check demo/demo.js
node scripts/build.mjs
node --test tests/*.test.mjs
```

## 角色素材工作台

本项目现在包含独立的 `/studio/` 角色素材工作台。根地址 `/` 默认跳转到工作台，原动画实验室保留在 `/demo/`。

第一阶段已经实现角色项目创建、自动保存、基准资料编辑、统一画布、图片上传预览，以及包含图片内容的单文件 JSON 导入导出。本阶段不会调用付费图片接口。

关键文件：

- `studio/index.html`：素材工作台页面。
- `studio/studio.js`：项目编辑、自动保存、图片上传和角色包迁移。
- `studio/studio.css`：桌面端和移动端样式。
- `server/studio-store.mjs`：本地 JSON 与图片持久化。
- `workspace/`：用户角色资料和图片；禁止覆盖或清空。
- `STUDIO.md`：工作台使用和接口说明。

本地接口：

```text
GET  /api/studio/projects
POST /api/studio/projects
GET  /api/studio/projects/:id
PUT  /api/studio/projects/:id
POST /api/studio/projects/:id/assets
GET  /api/studio/projects/:id/export
POST /api/studio/import
```

每个角色保存在 `workspace/<角色ID>/character.json`，图片按 `reference`、`processed`、`poses`、`expressions` 和 `layers` 分组。JSON 使用临时文件加重命名写入；导入默认创建副本，不覆盖已有角色。

第二阶段增加 `src/image-processing.js`：浏览器端把任意尺寸基准图等比包含到项目目标画布，空余区域使用 `canvas.background` 补齐，再按 `processing.chromaColor`、`threshold`、`softness` 和 `despill` 生成透明 PNG。处理结果写入 `processed/`，`variant` 分为 `normalized` 和 `transparent`；原始 `reference` 永远保留。图片处理完全在本机完成，不调用付费接口。

第三阶段增强了发丝去绿：除了透明度距离，还会根据绿色通道相对红蓝通道的优势值清理不透明边缘溢色，工作台提供独立的“去绿强度”滑块。

素材缩略图可以删除。`DELETE /api/studio/projects/:id/assets/:assetId` 会先把图片移动到角色目录的 `.trash/`，再从 `character.json` 移除，不做不可恢复删除。

`server/studio-image-jobs.mjs` 负责 GPT Image 2 图生图后台队列，接口为：

```text
GET  /api/studio/image-status
GET  /api/studio/projects/:id/image-jobs
POST /api/studio/projects/:id/image-jobs
```

任务使用父项目 `.env.local` 的 `GPT_IMAGE_API_KEY` 和 `config/ai-models.json` 的图片地址，不输出或保存密钥。上游固定调用 `/images/edits`，超时10分钟，同时只运行或排队一张。用户必须在工作台逐张二次确认。结果下载后保存到角色 `poses/` 或 `expressions/`。运行中若本地服务重启，该任务标记失败且不自动重试，避免重复扣费。
