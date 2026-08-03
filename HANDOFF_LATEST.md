# 最新交接

日期：2026-08-03

## 当前状态

项目已从混合 Next/Vinext/Node/Vue 架构改为纯前端 Vue 2 + Vite。线上只需托管 `dist/`，用户在自己的设备配置 API 地址、Key 和模型。

已完成：

- 新增统一入口 `index.html` + `src/main.js`。
- 主组件拆为模板、状态、计算属性、方法和生命周期装配。
- API 配置改为一个对话连接和一个图片连接；图片 Key 可复用对话 Key。
- 模型目录查询后必须由用户明确选择，不自动选第一项。
- API 配置结构、模型目录、初始化、头像分别拆入 feature 模块。
- 角色工作台和相册样式从主样式中拆出。
- 默认发行档案为空，不包含私人世界或固定人物。
- 移除 Next/Vinext API、Node 本地服务器、数据库、D1 示例和 Worker 产品代码。
- 云静态构建、单文件 H5 构建和 10 条纯前端测试已通过。
- 修复组件拆分后遗漏 `storyMomentValue` 导入导致的单文件 H5 白屏。
- 图片模型目录优先使用 `/models`，仅在其中没有图片模型时尝试供应商扩展目录。
- 单文件 H5 已内联 favicon，不再依赖同目录外部资源。

## 下一步定位

开发者先阅读 `ARCHITECTURE.md` 的“修改位置索引”。大多数界面修改只需要读取：

- 布局：`src/app/template.js`
- 状态：`src/app/create-state.js`
- 角色样式：`src/styles/features/characters.css`
- 相册样式：`src/styles/features/albums.css`
- API 设置：`src/features/connections/`

不要编辑 `standalone/night-mailbox.html` 或 `uniapp/hybrid/html/night-mailbox-app.html`，它们由构建脚本生成。
