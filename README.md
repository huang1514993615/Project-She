# 夜航信箱 · Night Mailbox · AI 剧情陪伴互动小说

> 纯前端、本地优先的 AI 陪伴互动剧情 H5。角色、对话、相册与配置全部保存在访问者自己的设备上，无服务器、无数据库、无云函数，隐私安全。

**在线体验**：<https://huang1514993615.github.io/Project-She/>

![Vue](https://img.shields.io/badge/Vue-2.7-4FC08D?logo=vuedotjs)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-green)

## 特性

- **本地优先**：所有角色、对话、相册、剧情记忆与 API 配置均存于浏览器 IndexedDB/localStorage，不经过任何服务器。
- **自带 Key 直连**：访问者填写自己的 API 地址与 Key，对话与图片模型由用户明确选择，系统不会自动选第一个。
- **世界与剧情系统**：世界设定、剧情日程、长期记忆压缩（`storySummary` + 按角色 `roleMemories`）、多人对话（1–10 人，以用户为中心）。
- **角色与生图**：角色档案、稳定外观、人物相册、场景工作台；生图后台任务，失败不自动重试、每次只调用一次接口。
- **多发行版**：云端静态站点、单文件 H5（`standalone/night-mailbox.html`）、uni-app 内置网页共用同一入口，行为一致。
- **无泄漏**：`.env*`、`data/` 个人数据与 `character-motion-engine/workspace/` 个人工作区不进入构建产物与仓库。

## 新人启动

1. 安装当前 LTS 版 Node.js。Node 只用于开发和打包，不是线上运行环境。
2. 在项目目录运行 `npm install`。
3. 运行 `npm run dev`。
4. 打开 `http://localhost:3000`。
5. 首次进入按顺序完成：连接对话 API → 查询并选择对话模型 → 设置世界 → 创建角色 → 开始剧情。

常用命令：

```bash
npm run dev              # 本地开发，监听 0.0.0.0:3000
npm run build            # 生成可部署的 dist/
npm run build:standalone # 生成单文件 standalone/night-mailbox.html
npm run build:app        # 更新 uni-app 内置网页
npm test                 # 语法、两类构建和自动化测试
```

## API 配置规则

- 对话连接：一个 API 地址、一个 Key。保存后查询 `/models`，用户明确选择模型，系统不会自动选第一个。
- 图片连接：一个 API 地址、一个 Key；图片 Key 留空时复用对话 Key。查询模型后由用户选择。
- 配置会记忆在当前设备，不会写进源码或构建产物。
- 纯前端直连要求 API 服务允许浏览器跨域请求（CORS）。不支持 CORS 的服务不能被静态 H5 直接调用。
- 公开网页无法像服务器那样保管密钥。用户应只填写自己的 Key，并避免在公共设备上长期保存。

## 部署

运行 `npm run build` 后，将整个 `dist/` 上传到任意静态托管服务即可，例如 Sites、Cloudflare Pages、Netlify、Vercel 静态站点、GitHub Pages 或对象存储静态网站。

部署时不需要上传 `.env.local`、`data/`、`node_modules/` 或个人图片目录。

## 数据与备份

浏览器使用 IndexedDB/localStorage 保存数据。清理站点数据、无痕模式结束或更换浏览器可能导致本地数据丢失，请先使用应用内的导出备份功能。单文件 H5 与云端页面的数据空间彼此独立。

开发者先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md) 和 [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)。前者是文件职责与修改索引，后者记录不可破坏的产品约束。
