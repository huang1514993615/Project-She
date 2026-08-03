# 项目架构与文件职责

本文的目标是让后续开发者只读取与任务有关的少量文件。不要从 `src/app/methods.js` 或 `src/runtime/browser-api.js` 开始全量阅读；先用下面的“修改位置索引”定位。

## 1. 运行结构

```text
index.html
  └─ src/main.js
      ├─ src/runtime/browser-api.js    浏览器本地 API 路由与任务运行时
      ├─ src/app/CompanionApp.js       Vue 组件装配和生命周期
      │   ├─ create-state.js           状态默认值
      │   ├─ computed.js               派生状态
      │   ├─ methods.js                跨功能业务编排
      │   └─ template.js               页面模板
      └─ src/styles/*                  页面样式
```

应用仍使用 `/api/...` 形式调用功能，但这些请求会被 `browser-api.js` 在浏览器内拦截并处理，不会发给项目自己的服务器。只有最终的模型请求会发往用户填写的 API 地址。

## 2. 文件职责

### 根目录与构建

| 文件 | 职责 | 什么时候修改 |
|---|---|---|
| `index.html` | 所有发行版本的 HTML 入口和静态元信息 | 修改标题、图标、SEO 元信息 |
| `package.json` | 最小依赖和开发/构建/测试命令 | 增减依赖或命令 |
| `vite.config.ts` | 云部署静态构建，输出 `dist/` | 调整云端构建参数 |
| `vite.standalone.config.js` | 单文件 H5 的中间构建 | 调整单文件兼容目标 |
| `postcss.config.mjs` | Tailwind/PostCSS 处理 | 更换 CSS 工具链 |
| `tsconfig.json` | Vite 配置与构建插件的类型检查范围 | 修改 TypeScript 构建文件 |
| `.openai/hosting.json` | Sites 静态托管项目元数据 | 更换 Sites 项目时 |
| `build/sites-vite-plugin.ts` | 构建完成后复制托管元数据 | 改变 Sites 输出结构 |

### `src/app`：界面装配

| 文件 | 职责 | 什么时候修改 |
|---|---|---|
| `CompanionApp.js` | 组合模板、状态、计算属性、方法；加载/保存生命周期 | 启动顺序或全局生命周期 |
| `create-state.js` | 所有 Vue 响应式状态默认值 | 新增页面状态、弹窗状态、加载状态 |
| `computed.js` | 相册列表、角色列表、连接状态等派生值 | 只读展示逻辑 |
| `methods.js` | 聊天、记忆、日程、相册等跨功能编排 | 尚未独立成 feature 的业务行为 |
| `template.js` | 页面 DOM 模板 | 调整布局、文案和组件位置 |

### `src/features`：高频独立功能

| 文件 | 职责 |
|---|---|
| `connections/api-settings.js` | API 设置弹窗的创建、校验提示与保存 |
| `connections/config-schema.js` | 当前 API 配置结构、旧字段迁移、规范化保存 |
| `connections/model-catalog.js` | 解析 `/models` 返回值，区分对话/图片模型 |
| `connections/component-methods.js` | 查询模型、显式选择模型、连接状态更新 |
| `onboarding/component-methods.js` | 世界优先的首次初始化流程 |
| `characters/avatar-methods.js` | 头像预设、上传、裁切结果保存和角色头像迁移 |

新增独立功能时优先建立 `src/features/<功能名>/`，不要继续扩大 `methods.js`。

### `src/runtime`、`platform` 与 `domain`

| 文件 | 职责 |
|---|---|
| `runtime/browser-api.js` | IndexedDB、资源文件、备份、聊天请求、图片后台任务和浏览器内 `/api` 路由。它是运行时兼容层，不放页面 DOM |
| `platform/viewport.js` | 手机软键盘、视觉视口和安全区处理 |
| `platform/local-images.js` | `asset://` 本地图片在 Vue 中的显示指令 |
| `domain/roles/derived-state.js` | 角色年龄与派生档案的纯函数 |
| `config/default-settings.js` | 新用户空白档案；禁止加入作者的私人世界观 |
| `config/avatar-presets.js` | 男女与中性预设头像清单 |
| `utils/text-hash.js` | 小文本指纹，用于检测世界设定变化 |

### 样式

| 文件 | 职责 |
|---|---|
| `styles/app.css` | 主框架、聊天、设置与响应式基础样式 |
| `styles/features/characters.css` | 角色列表、角色编辑器与多人工作台 |
| `styles/features/albums.css` | 场景/角色相册与图片查看器 |
| `styles/runtime.css` | API 弹窗、App/WebView 和运行时覆盖样式 |

新样式尽量放到对应 feature 文件。只有全局变量、重置和主布局放 `app.css`。

### `shared`：无浏览器副作用的规则

| 文件 | 职责 |
|---|---|
| `ensemble-turns.js` | 多人回复人数和消息/token 上限 |
| `image-models.js` | GPT Image、Grok、Flux 等图片模型参数适配 |
| `image-prompt-context.js` | 从角色、记忆和对话构造稳定生图上下文 |
| `loose-json.js` | 修复并解析模型常见的非严格 JSON |
| `role-visual-states.js` | 角色表情/动作视觉状态默认库 |
| `story-event-ai.js` | 日程识别提示与模型结果解析 |
| `story-time.js` | 剧情时钟、未来事件和到期判断 |
| `system-prompt.js` / `.d.ts` | 通用系统提示词及类型 |
| `sha256.js` | 浏览器可用的哈希实现 |

`shared` 模块应保持纯函数，方便在 Node 测试中直接导入。

### 发布、测试与保留目录

| 路径 | 职责 |
|---|---|
| `scripts/build-standalone-html.mjs` | 把 JS、CSS 和预设头像内联成单一 HTML |
| `scripts/check-syntax.mjs` | 检查 `src/`、`shared/`、`scripts/` 的 JS 语法 |
| `tests/rendered-html.test.mjs` | 核心规则、纯前端边界、云产物与单文件产物测试 |
| `public/avatars/` | 可发行的中性/男女角色头像预设 |
| `standalone/` | 单文件 H5 发布产物；不要手工编辑 HTML |
| `uniapp/` | 极简 App 壳和内置网页产物，不包含局域网更新服务 |
| `data/` | 旧版个人记录，仅保留，不被纯前端运行时读取，不要删除或打包公开 |
| `character-motion-engine/` | 独立实验子项目，不属于当前 H5 主链路 |

### `uniapp`：可选 Android 外壳

| 文件 | 职责 |
|---|---|
| `App.vue` | App 全局页面背景与生命周期入口 |
| `main.js` | 创建 uni-app Vue 实例 |
| `manifest.json` | AppID、Android 权限、版本和打包配置 |
| `pages.json` | 注册唯一的 App 壳页面 |
| `pages/index/index.vue` | 加载 `night-mailbox-app.html` 的极简 WebView |
| `uni.scss` | uni-app 全局样式变量 |
| `README.md` | HBuilderX 打包说明 |
| `hybrid/html/night-mailbox-app.html` | `build:standalone` 自动生成的内置 H5，不手工编辑 |

### 文档与静态资源

| 文件或目录 | 职责 |
|---|---|
| `README.md` | 面向新用户的安装、配置和部署步骤 |
| `PROJECT_CONTEXT.md` | 每次开发前必须阅读的当前约束 |
| `AGENTS.md` | 自动化开发代理的最小工作规则 |
| `HANDOFF_LATEST.md` | 最近一次架构迁移交接摘要 |
| `ARCHITECTURE.md` | 本文件：职责地图与修改索引 |
| `public/favicon.svg`、`public/og.png` | 网站图标和默认分享/占位图 |
| `public/avatars/` | 可发行的男女与中性头像预设 |

## 3. 修改位置索引

| 想修改的内容 | 先读这些文件 |
|---|---|
| API 地址/Key 字段 | `connections/config-schema.js`、`connections/api-settings.js` |
| 模型查询和选择 | `connections/model-catalog.js`、`connections/component-methods.js`、`browser-api.js` 中 `routeMobileRequest` |
| 新增图片模型适配 | `shared/image-models.js`，必要时再改 `browser-api.js` 的图片请求 |
| 初始化步骤 | `onboarding/component-methods.js`、`create-state.js`、`template.js` |
| 角色编辑和头像 | `characters/avatar-methods.js`、`template.js`、`characters.css` |
| 相册和图片放大 | `computed.js`、`methods.js` 中 gallery/lightbox 方法、`albums.css` |
| 对话和多人回复 | `methods.js`、`shared/ensemble-turns.js`、`browser-api.js` 中聊天处理 |
| 长期记忆/摘要 | `methods.js`、`browser-api.js` 中 summary/memory 处理 |
| 剧情日程 | `shared/story-time.js`、`shared/story-event-ai.js`、`methods.js` |
| 页面布局/文案 | `template.js` 与对应样式文件 |
| 本地数据/备份 | `browser-api.js` 的 storage、asset、backup 分区 |

## 4. 必须保持的边界

- 发行版不包含固定私人世界、私人角色或个人聊天记录。
- 用户必须先验证连接并明确选择模型，不能静默选择目录第一项。
- 图片生成是后台任务；每个任务只调用一次图片接口，失败不自动重试。
- 多人回复上限为 1–10，完成一轮后停下让用户输入。
- 压缩对话时同时维护 `storySummary` 与按角色 ID 保存的 `roleMemories`；未登场角色不得因压缩被删除。
- AI 优化用户内容必须先展示差异预览，确认后才写入。
- API Key 只保存在用户当前设备，不写入源码、文档或构建产物。
