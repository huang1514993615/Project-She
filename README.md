# 夜航信箱

一个本地运行、面向手机使用的 Vue 2 多角色 AI 陪伴与互动剧情 H5。页面由 Vue 2 渲染，Node.js 负责本地文件存储、模型转发、后台生图和图片落盘，不使用数据库。

详细的代码结构、接口、数据格式和维护注意事项见 [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)。

## 当前功能

- DeepSeek、Claude、Grok 等对话模型切换。
- 单人或多人剧情回复，参与人数可设置为 1–10。
- 主角色、闺蜜、固定角色和临时角色管理。
- Grok 与 DeepSeek 主对话支持流式读取；多人回复会在服务端收集完整结构后再依次播放。
- 点击聊天头像查看人物资料、修改提示词和生成角色形象。
- 每个角色可明确设置女性、男性、非二元或未指定；生图会保持角色性别与稳定外观，不再默认生成女性。
- 世界设定、长期剧情记忆、人物设定和回复风格分层管理。
- 已发送的用户消息可编辑，并从该位置重新生成后续剧情。
- 每轮回复包含场景、心情、动作、对话和明确剧情推进。
- 自动生成三条可推动剧情的快捷回复。
- 对话达到阈值后可自动总结并压缩上下文。
- 压缩时为每位角色单独保存长期记忆；暂时离场的角色不会被遗忘。
- 对话记录与设置写入本地 JSON 文件。
- 独立“生图”工作台：从当前剧情整理提示词、手动编辑、后台生成和本地预览。
- 场景和人物提示词按实际剧情整理，以姿态、视线、服装材质、受光和镜头关系增强画面张力，不套用固定人物或服装模板。
- 场景相册与人物相册分开管理，失败任务不会出现在相册。
- 点击图片可全屏预览；场景事件摘要和人物介绍由对话模型生成并永久保存。
- 图片任务在 Node 服务后台运行，关闭浏览器页面不会中断。
- 生图失败不自动重试：每次提交只调用一次图片接口，失败即标记任务并给出错误提示。

## 环境要求

- Windows 10/11
- Node.js 22.13 或更高版本
- 已安装项目依赖

## 快速启动

在 PowerShell 中执行：

```powershell
cd C:\Users\hcq\Documents\Project-She
node server/local-server.mjs
```

启动后访问：

- 本机：http://localhost:3000
- 手机：`http://电脑局域网IPv4地址:3000`

服务会同时启动：

- `0.0.0.0:3000`：手机和电脑访问的 Node 入口。
- `127.0.0.1:3001`：仅供 Node 入口代理的 Vinext 页面服务。

关闭服务可在启动窗口按 `Ctrl+C`。

如果希望使用项目脚本，也可以运行 `npm run dev`。若电脑上的全局 npm 启动脚本损坏，直接使用上面的 `node server/local-server.mjs` 即可。

## 首次配置

复制 `.env.example` 为 `.env.local`，只在 `.env.local` 中填写真实密钥：

```dotenv
DEEPSEEK_API_KEY=...
DOWNSTREAM_API_KEY=...
GPT_IMAGE_API_KEY=...
```

常用配置：

```dotenv
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash

# 使用本地代理时填写代理地址；不使用代理时填写 direct
LOCAL_HTTP_PROXY=http://127.0.0.1:7897
```

注意：

- 不要把真实密钥写进 `README.md`、源码或 `config/ai-models.json`。
- 不要提交 `.env.local`。
- `LOCAL_HTTP_PROXY` 配置错误或代理未启动时，模型请求可能出现 `fetch failed`、超时或 502。

## 模型配置

模型地址和模型名称统一放在：

```text
config/ai-models.json
```

当前默认配置：

- 对话中转地址：`https://test1122.up.railway.app/v1`
- 默认扩展对话模型：`grok-4.5`
- 备选扩展对话模型：`claude-haiku-4-5-20251001`
- 图片地址：`https://downstream.jbbtoken.cn/v1`
- 图片模型：`gpt-image-2`
- 图片接口：`POST /v1/images/generations`
- 图片尺寸：`1024x1536`（竖图，接近 2:3）

网页会通过 `/models` 发现可用对话模型，但图片模型默认只使用 JSON 中明确配置的列表。

## 本地数据

所有持久数据都在 `data` 目录中，不使用数据库：

| 文件或目录 | 用途 |
| --- | --- |
| `data/settings.json` | 主角色、多人角色、世界设定、系统提示词、剧情摘要、每角色长期记忆和阈值 |
| `data/chat-history.json` | 完整聊天记录 |
| `data/image-jobs.json` | 后台图片任务、最终提示词、场景事件档案和人物介绍快照 |
| `data/generated-images/` | 已下载到本机的角色图与场景图 |
| `data/server.log` | Node 和页面服务日志 |
| `mobile/web/` | 安卓内置网页入口与手机本地 API 适配器 |
| `uniapp/` | 可由 HBuilderX 云打包的 UniApp Android 外壳 |

前端还会使用浏览器 `localStorage` 保存少量界面偏好和临时副本。后端 JSON 文件是手机和电脑共享数据的主要来源。

升级或排查问题前，建议备份整个 `data` 目录。不要随意覆盖用户现有的 `settings.json` 和 `chat-history.json`。

## Android 独立版

项目保留现有 Node 网页版，同时提供 `uniapp/` 安卓版本。安卓端把网页打包进 APK，使用手机本地存储和 5+ 原生网络请求，不需要电脑或局域网。运行 `pnpm run build:android-web` 可把共享页面、样式、提示词和模型配置同步到 `uniapp/hybrid/html/`，随后使用 HBuilderX 云打包。

安卓端 API Key 由用户首次打开 App 时填写，只存于应用本地。图片请求最长等待 10 分钟。详细步骤见 `uniapp/README.md`。

## 手机访问排查

1. 确认电脑和手机处于同一局域网。
2. 在电脑运行 `ipconfig`，找到当前网卡的 IPv4 地址。
3. 手机访问 `http://IPv4地址:3000`，不要使用 `localhost`。
4. 确认服务正在监听 `0.0.0.0:3000`。
5. 关闭手机或电脑 VPN 后重试。
6. 检查 Windows 防火墙是否允许 TCP 3000。
7. 检查路由器是否开启“AP 隔离”“访客网络隔离”或设备隔离。
8. 电脑切换 Wi-Fi、手机热点或重启后，IPv4 地址可能发生变化，需要重新查询。

## 构建与测试

```powershell
node node_modules/vinext/dist/cli.js build
node --test tests/rendered-html.test.mjs
node --check server/local-server.mjs
node --check server/companion-store.mjs
```

正常情况下，构建应成功，自动测试应全部通过。

## 安全说明

- 密钥只由 Node 服务读取，不应发送到浏览器。
- 图片模型和对话模型仍可能执行各自的内容审核。
- 自动改写只用于把被拒绝的提示词调整为可正常生成的成年时装或电影摄影表达，不应尝试绕过上游安全系统。
- 本项目是本地个人工具，不包含账号系统、云数据库或互联网公开部署能力。
