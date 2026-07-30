# Project-She 技术交接与 AI 上下文

> 最后更新：2026-07-29  
> 项目名称：夜航信箱  
> 工作目录：`C:\Users\hcq\Documents\Project-She`

本文档面向后续接手本项目的 AI 或开发者。开始修改前请先通读本文，再根据任务读取相关源码。文档不包含真实 API Key；真实密钥只能存在于 `.env.local`。

## 1. 产品目标

这是一个个人本地使用的移动端 AI 陪伴与多人互动剧情 H5，核心目标是：

1. 以用户为剧情中心，角色之间可以互动，但不能无限自行对话。
2. 对话要有具体场景、心情、动作和台词，并在每轮明确推动剧情。
3. 用户可以创建、保存、修改固定角色和临时角色。
4. 用户可以维护世界设定、长期剧情记忆和人物设定。
5. 对话和设置使用本地文件存储，不使用数据库。
6. 图片生成必须由用户主动开启和提交，后台运行，费用可控。
7. 手机和电脑访问同一个 Node 服务，并共享服务器端 JSON 数据。

## 2. 技术栈与运行结构

### 前端

- Vue 2.7，使用 `vue/dist/vue.esm.js`。
- Vue 应用主体集中在 `app/VueGirlfriend.jsx`。
- 页面样式集中在 `app/globals.css`。
- React/Vinext 只作为应用外壳和构建运行环境，实际交互界面由 Vue 2 管理。

### 服务端

- `server/local-server.mjs` 是用户真正启动的 Node 入口。
- Node 入口监听 `0.0.0.0:3000`，供本机和局域网手机访问。
- Node 会启动 Vinext 开发服务并监听 `127.0.0.1:3001`。
- 普通页面和 Vinext API 由 3000 端口反向代理到 3001。
- 本地文件、角色资料、图片任务、模型目录和 AI 出站代理由 3000 端口直接处理。

请求链路：

```text
手机/电脑浏览器
    ↓ http://主机:3000
server/local-server.mjs
    ├─ 本地文件与图片接口：直接处理
    ├─ AI bridge：调用外部模型
    └─ 页面/Vinext API：代理到 127.0.0.1:3001
                               ↓
                        app/api/* Route Handler
```

### 持久化

- 不使用数据库。
- `server/companion-store.mjs` 负责设置与聊天记录的规范化和原子写入。
- 写文件时先写临时文件，再用 `rename` 替换，降低文件损坏概率。

## 3. 关键文件地图

| 文件 | 作用 |
| --- | --- |
| `app/VueGirlfriend.jsx` | Vue 2 页面、状态、聊天、角色管理、生图工作台 |
| `app/globals.css` | 桌面端和移动端全部样式 |
| `app/api/chat/route.ts` | DeepSeek/Grok/Claude 对话请求、多人 JSON 协议和解析 |
| `app/api/suggestions/route.ts` | 每轮三条剧情推进快捷回复 |
| `app/api/summary/route.ts` | 分段总结和上下文压缩 |
| `app/api/world/route.ts` | AI 生成或完善世界设定 |
| `app/api/health/route.ts` | 模型配置健康状态 |
| `server/local-server.mjs` | Node 入口、反向代理、模型目录、角色生成、图片任务 |
| `server/companion-store.mjs` | JSON 数据结构、默认值、迁移和写入 |
| `shared/system-prompt.js` | 默认系统提示词和变量渲染 |
| `shared/loose-json.js` | 宽容解析模型返回的 JSON，兼容说明文字、代码围栏与轻微格式错误 |
| `config/ai-models.json` | 对话与图片中转地址、模型清单和默认模型 |
| `.env.local` | 真实密钥与本地代理，仅服务端读取，不可提交 |
| `.env.example` | 环境变量示例 |
| `data/settings.json` | 角色、世界、记忆和提示词 |
| `data/chat-history.json` | 聊天历史 |
| `data/image-jobs.json` | 后台生图任务 |
| `data/generated-images/` | 本地永久图片 |
| `data/server.log` | 运行日志 |
| `tests/rendered-html.test.mjs` | 页面结构、关键能力和文件存储测试 |

## 4. 启动、停止与验证

### 推荐启动方式

```powershell
cd C:\Users\hcq\Documents\Project-She
node server/local-server.mjs
```

访问：

```text
电脑：http://localhost:3000
手机：http://电脑当前IPv4:3000
```

### 端口

- 3000：公开局域网入口，必须监听 `0.0.0.0`。
- 3001：Vinext 内部入口，只监听 `127.0.0.1`。

不要把页面只启动在 3001，也不要把 3000 改成仅监听 localhost，否则手机无法访问。

### 关闭

前台启动时按 `Ctrl+C`。若由工具后台启动，必须先确认占用 3000/3001 的准确 PID，再停止对应进程，不要按进程名批量结束所有 Node 进程。

### 验证命令

```powershell
node --check server/local-server.mjs
node --check server/companion-store.mjs
node node_modules/vinext/dist/cli.js build
node --test tests/rendered-html.test.mjs
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

预期包含：

```json
{
  "chat": "configured",
  "grok": "configured",
  "image": "configured"
}
```

## 5. 配置与密钥

### `.env.local`

主要变量：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 对话、提示词整理、世界生成等 |
| `DEEPSEEK_BASE_URL` | DeepSeek 接口地址 |
| `DEEPSEEK_MODEL` | DeepSeek 模型名 |
| `DOWNSTREAM_API_KEY` | Claude/Grok 对话中转密钥 |
| `GPT_IMAGE_API_KEY` | 独立图片接口密钥 |
| `LOCAL_HTTP_PROXY` | Node 出站代理；不用代理时设为 `direct` |

兼容变量 `GROK_API_KEY`、`IMAGE_API_KEY` 仍保留，但新配置优先使用上表变量。

禁止：

- 把真实 Token 写入源码、Markdown、JSON 配置或日志说明。
- 在终端输出完整 `.env.local`。
- 把 `.env.local` 提交到 Git。

### `config/ai-models.json`

当前结构：

```json
{
  "downstream": {
    "baseUrl": "对话中转站 /v1",
    "chat": {
      "defaultModel": "默认对话模型",
      "models": ["静态候选模型"]
    },
    "image": {
      "baseUrl": "图片中转站 /v1",
      "defaultModel": "gpt-image-2",
      "models": ["gpt-image-2"],
      "endpoint": "/images/generations",
      "portraitSize": "1024x1536"
    }
  }
}
```

对话模型可从上游 `/models` 动态发现并合并到界面列表。图片模型默认关闭动态发现，以免误选不能生图的模型。

## 6. 数据模型

### Settings

`data/settings.json` 主要字段：

```text
profile                  主角色
ensemble.enabled         是否多人模式
ensemble.autoGuests      是否允许临时角色
ensemble.maxTurns        每轮最多参与角色数，范围 1–10
ensemble.friend          默认闺蜜角色
ensemble.customRoles     固定角色，最多 30
ensemble.temporaryRoles  临时角色，最多 80
systemPrompt             回复风格提示词
storySummary             长期剧情摘要
roleMemories             按角色 ID 保存的长期记忆，不因对话压缩丢失
storyClock               独立剧情时钟：日历名、天数、时段、当前位置
storyEvents              独立剧情约定，最多保留 300 条，不随聊天压缩删除
worldSetting             世界设定
autoCompress             是否自动压缩上下文
autoCompressThreshold    自动总结阈值，范围 20–120
randomRoleEnabled        是否允许合理引入新角色
randomRoleInterval       新角色引入间隔参考，范围 8–60
summaryUpdatedAt         最近总结时间
```

单个角色统一字段：

```text
id            角色 ID
name          姓名
age           成年年龄，18–80
gender        性别：女性、男性、非二元或未指定
personality   简短性格
relation      与用户或其他角色的关系
prompt        对话行为提示词
appearance    稳定外观
imagePrompt   生图提示词，只给图片模型
avatarUrl     本地生成图片路径
```

不要再为同一角色增加多套含义重叠的提示词字段。对话行为用 `prompt`，稳定外观用 `appearance`，图片专用内容用 `imagePrompt`。

生图时姓名、成年年龄、`gender` 与稳定外观优先于场景模板。旧角色没有填写 `gender` 时，服务会从关系、人物提示词和外观中的明确线索判断；没有可靠线索则保持“未指定”，不能默认生成女性。角色详情页和角色管理页均可直接修改性别。

### Chat history

`data/chat-history.json` 最多保留 1000 条规范化消息。核心字段：

```text
id, role, content, speaker, time, imageUrl, imageModel, imageQuality
```

`speaker` 用于多人回复中标识具体角色。

### 浏览器 localStorage

键名：`night-mailbox-state`。

主要保存：

- 界面和模型选择偏好。
- 图片开关与当前未提交的图片提示词。
- 快捷回复。
- 少量本地状态副本。

服务器端 JSON 是手机和电脑共享状态的主要来源；不要把完整长期数据只保存在 localStorage。

## 7. 提示词优先级

当前对话提示词优先级为：

```text
1. 世界设定
2. 人物稳定身份与基础关系
3. 每角色长期记忆
4. 已发生的剧情与最近对话
5. 回复风格
```

核心实现位于 `app/api/chat/route.ts`。

原则：

- 不要在每轮角色回复中复述规则或限制。
- 不要把所有角色设定混成一段重复提示。
- 世界设定负责全局事实。
- 剧情摘要负责已经发生的事实。
- 人物 `prompt` 只约束对应角色。
- `shared/system-prompt.js` 的默认提示词负责通用输出结构和剧情推进。
- 用户明确要求保留现有默认提示词时，不要擅自改写 `data/settings.json`。

## 8. 对话流程

### 单人模式

前端请求 `/api/chat`，响应可以流式读取。回复完成后，页面调用 `scrollToMessage` 定位到本轮回复开头，避免长回复直接停在末尾。

DeepSeek 与 Grok 单人对话均请求 OpenAI 兼容 SSE 流，并由 `/api/chat` 转成纯文本分片给前端；若中转站忽略 `stream: true`、改回普通 JSON，服务端会自动兼容读取。

### 多人模式

1. 前端发送 `responseMode: "multi"` 和 `ensemble`。
2. 模型返回结构化 JSON：

```json
{
  "scene": "共享场景",
  "turns": [
    {
      "speaker": "角色名",
      "scene": "角色所在场景",
      "mood": "心情",
      "action": "动作",
      "dialogue": "台词",
      "progression": "明确剧情推进"
    }
  ]
}
```

3. 本轮不同角色人数最多使用 `ensemble.maxTurns`，范围 1–10；总消息数最多为该人数的 4 倍，即 4–40 条。
4. 第一条承接用户，后续角色可以互相互动；相同角色允许再次回复，但所有消息必须按时间顺序承接上一条，不能为凑上限拆句或重复。
5. 只有最后一条填写 `progression`，然后暂停，给用户插话。
6. 前端按顺序播放角色消息，用户可随时暂停接话或发送消息打断。
7. 若模型 JSON 格式错误，服务会尝试修复；仍失败则降级为单角色消息。

多人模式同样以 `stream: true` 调用上游，减少长时间无数据导致的中转断开；服务端会收集完整 SSE 内容后再校验多人 JSON，因此界面仍按完整角色消息逐条播放，不会把半截 JSON 显示给用户。

人数上限不是每轮必须用满。模型应只安排当前场景真正需要的角色。

所有文本模型调用都不再传递 `response_format: {"type":"json_object"}`，而是在 system/user 消息中明确要求 JSON 并给出目标结构样例。`maxEnsembleOutputTokens` 根据参与人数动态提供 2240–11600 的输出额度；单文件 HTML 与 Node 版保持一致，避免长 JSON 被 2200 Token 截断后降级成单角色回复。图片 API 自己使用的 `response_format: "url"` 或 `"b64_json"` 不受影响。

### 剧情推进

每轮不能只一问一答。最后必须产生至少一个已发生的变化，例如：

- 开始执行计划。
- 切换地点。
- 带来新消息。
- 触发新事件。
- 角色作出决定。
- 人物关系发生变化。

快捷回复由 `/api/suggestions` 生成，也应包含具体动词、对象或地点和下一步目的。

### 长回复阅读

- 每条消息 DOM 带 `data-message-id`。
- `lastReplyStartId` 记录本轮第一条 AI 回复。
- 回复结束后调用 `scrollToMessage(lastReplyStartId)`。
- 界面提供“回到本轮开头”按钮。

不要恢复为流式每个分片都 `scrollBottom()`，否则手机会再次跳到长回复末尾。

## 9. 角色系统

角色分为：

1. 主角色 `profile`。
2. 默认固定闺蜜 `ensemble.friend`。
3. 用户创建的固定角色 `customRoles`。
4. 剧情中出现的临时角色 `temporaryRoles`。

能力：

- 点击任意聊天头像进入人物详情。
- 多人对话出现名册外的新 `speaker` 时，前端立即创建临时档案，并在本轮播放结束后按顺序调用 `/api/role`，根据首次登场片段、相关历史、世界设定、剧情摘要和该角色长期记忆自动生成基础资料、`prompt` 与 `appearance`。生成在后台进行，不阻塞用户继续聊天；失败时保留可编辑的本地初始档案。
- 人物详情提供三种 AI 操作：生成完整档案、只生成/优化人物对话提示词 `prompt`、只生成/优化稳定外观 `appearance`。所有结果都可继续手动编辑。
- 临时角色可提升为固定角色。
- 固定或临时角色都可编辑图片提示词并生成形象。
- 角色图生成成功后，Node 会把 `avatarUrl` 和最终 `imagePrompt` 保存回 `settings.json`。

随机角色只应在新一天、新地点、新任务或新剧情自然引入，不能突兀闯入。整体仍以用户和主角色为中心。

## 10. 剧情总结与上下文压缩

- 当前消息达到 `autoCompressThreshold` 后，可在下一次发送前自动总结。
- 总结通过 `/api/summary` 完成。
- 成功后先把全局剧情写入 `storySummary`，再为全部角色写入 `roleMemories`，最后才清理旧聊天上下文。
- 总结失败时必须保留原聊天记录。
- 手动总结入口位于“设定 → 长期剧情记忆”。

不要直接删除大量历史后再尝试总结；必须先确认总结成功。

### 每角色长期记忆

`roleMemories` 以稳定角色 ID 为键，主角色使用 `primary`，默认闺蜜使用 `friend`，固定和临时角色使用自身 `id`。每条记忆包含：

```text
name
stableIdentity        姓名、成年年龄、稳定性格和基础身份关系
relationshipMemory    与用户及其他角色形成的具体关系与称呼
importantEvents       亲历、得知或承诺记住的重要事件
currentStatus         当前是否在场、正在做什么或离场去向
lastKnownScene        最后出现的时间、地点和位置
commitments           任务、承诺、目标和未完成线索
updatedAt
```

压缩流程：

1. 把永久角色名册传给剧情摘要模型，名册身份高于旧摘要。
2. 生成全局剧情摘要。
3. 再调用模型，仅更新本轮出现、被提及或状态变化角色的长期记忆。
4. 没有登场的角色直接继承旧记忆，不允许模型删除。
5. 所有角色始终保留由当前人物资料生成的 `stableIdentity`。
6. 只有剧情摘要和角色记忆都成功后才清理原对话。

聊天时固定角色始终注入完整人物资料和长期记忆。暂时未登场的临时角色也会进入紧凑的“未在场角色名册”，保留身份和最后状态，但不会因此无故进入当前场景。

这能避免剧情摘要错误覆盖“小雨是闺蜜”等稳定关系，也能让长时间不登场的角色在合理回归时恢复过去经历。

## 11. 图片生成流程

### 独立工作台

当前剧情场景生图不在聊天消息区操作。移动端进入“更多 → 图片与相册”，桌面端也可从顶部入口进入 `image-studio-panel`：

1. 点击“从当前剧情整理”。
2. Node 调用对话模型，把最近剧情整理为结构化、可视化提示词。
3. 用户可以修改 1200 字以内的提示词。
4. 点击“提交后台生成”。
5. 前端调用 `/api/image`，action 为 `generate-async`。
6. Node 后台生成并把任务写入 `data/image-jobs.json`。
7. 浏览器可切回聊天或关闭页面。
8. 重新打开页面后通过轮询恢复任务状态和图片预览。
9. 图片工作台分为“场景相册”和“人物相册”，失败任务不会展示。“场景相册”只收纳 `scene`/`stage-background`，“人物相册”收纳 `character`/`visual-state`。
10. 点击成功图片可打开全屏预览，并查看独立档案。普通单文件浏览器直接预览 Data URL/HTTPS；Android App 对 `_downloads/night-mailbox/`、`file:///storage/...` 和 `/storage/...` 等本地路径先做 RelativeURL/LocalURL/绝对路径兼容转换，再通过 `plus.io.resolveLocalFileSystemURL` 打开文件并以 Data URL 交给界面。不能把 `file:` 或 `_downloads` 地址直接交给 WebView 的 `<img>`，否则新生成的图可能空白而导入的 Data URL 正常。头像、人物详情、相册缩略图、聊天场景图、动作图与舞台背景统一使用 `v-local-image` 按实际挂载的 DOM 延迟读取；同一路径共享最多 24 项的内存 Promise 缓存，不能在初始化时一次读取全部图片。新下载任务统一保存规范 `_downloads/night-mailbox/<文件名>` 路径，旧任务里已经记录的绝对路径继续兼容。预览读取失败时显示原因和“重新读取”，不能静默空白。

所有场景图和人物图共用 `shared/image-prompt-context.js` 的视觉连续性档案，资料优先级固定为：人物姓名、性别、稳定外观与不可变配饰 → 角色长期记忆、关系与图片专用偏好 → 世界设定与长期剧情摘要 → 最近对话。最近对话只负责确定当前地点、实际在场人物、服装临时状态、动作、情绪和事件，不能反过来覆盖稳定外观。前端提交整理请求时必须同时传入 `worldSetting`、`storySummary`、`roleMemories`、完整角色资料和保留真实 `speaker` 的最近对话；单文件 HTML、Android 内置页和 Node 网页均使用同一份组合规则。

场景提示词不是把最后一条对话改写成分镜。模型先从最近对话判断实际入镜人物，再为每位人物显式补回脸型、眼睛和瞳色、发型、体态、基础服装、标志配饰，最后才加入此刻姿态、人物互动、环境、灯光和镜头。输出禁止照抄对白、声音、内心旁白或连续动作过程，只冻结一个四肢、视线、接触和道具关系同时成立的瞬间；能力与环境特效不超过画面描述的 20%，避免角色形象被剧情特效淹没。

人物提示词统一按“整体、面容五官、发型、服装与标志物、姿态与表情、场景与环境、灯光与构图”组织。稳定外观必须写成完整可见的内容，不允许用“沿用设定”“同前”等省略语；最近对话只作为当前状态证据。实际年龄和外表年龄不一致时分别保留，外表明显未成年的角色只能使用符合外表年龄的非性化服装、姿态和镜头。雪纺、薄纱、雨水或漏水不是固定模板，只有与人物身份和实际剧情相符时才使用。剧情确有打湿事件时，可具体写湿发、水珠、衣料颜色加深、贴合、反光和褶皱，但不能凭空制造无关事件。

场景图片不再自动插入聊天记录，统一在图片工作台查看。

### 图片档案与 AI 摘要

每次图片任务都会在 `image-jobs.json` 中保存独立 `archive`，它不属于聊天历史，因此不会被对话总结、压缩或清空影响。

场景档案保存：

```text
title, scene, eventSummary, contextSnapshot, participants, capturedAt
```

人物档案保存：

```text
title, characterId, name, age, relation, personality,
introduction, appearance, capturedAt
```

提交任务时，前端先保留生成时的原始剧情或人物资料快照。Node 后台再调用对话模型执行 `generateImageArchiveSummary`：

- 场景图由模型整理时间地点、在场人物、事件起因、正在发生的动作和剧情进度。
- 人物图由模型整理身份关系、性格与行为特点、剧情位置和稳定外观。
- 模型结果写入该次图片任务，后续角色资料变化不会覆盖旧图片介绍。
- 摘要失败不会触发额外图片调用；原始快照仍保留，并记录 `summaryError`。
- 旧图片没有模型档案时，界面使用旧任务提示词兼容显示。

相册界面只展示 `queued`、`running` 和带本地图片的 `completed` 任务；`failed` 任务仍可在 JSON 和日志中排查，但不会污染相册。

### 图片请求

当前图片请求：

```http
POST {imageBaseUrl}/images/generations
Content-Type: application/json
Authorization: Bearer {GPT_IMAGE_API_KEY}
```

核心参数：

```json
{
  "model": "gpt-image-2",
  "prompt": "用户确认后的提示词",
  "n": 1,
  "size": "1024x1536",
  "quality": "standard",
  "response_format": "url",
  "output_format": "png"
}
```

返回临时 URL 后，Node 会立即下载并保存到 `data/generated-images/`，前端只使用本地 `/generated-images/...` 地址。

当前中转站的 `size` 参数只接受 `1024x1024`、`1536x1024`、`1024x1536`、`1k` 或 `2k`。竖图统一传 `1024x1536`；提示词里仍可写“9:16 竖版构图”作为构图意图，但不能把 `9:16` 直接作为 API 的 `size` 参数。

### 400 拒绝后的自动调整

核心实现在 `server/local-server.mjs`：

- `isRetryableImageRefusal`
- `rewriteRejectedImagePrompt`
- `generateImageWithRetry`
- `runImageJob`

规则：

1. 图片接口总调用次数最多 3 次，不是首次加三次。
2. 只有 HTTP 400 且错误文本明显属于内容/安全拒绝时才自动调整。
3. 超时、鉴权、余额、网络、5xx 和下载失败不能盲目重试，避免重复扣费。
4. 对话模型应保留人物身份、地点、动作、关系、道具、灯光和镜头。
5. 只把被拒绝的裸露、透明暴露、性化身体强调或性行为表达调整为完整成年时装、自然比例和含蓄电影表达。
6. 不直接照抄上游拒绝信息提供的替代文案。
7. 每次尝试、最终提示词、是否改写、状态和错误都写入任务记录。
8. 三次仍失败后停止，不再继续调用。

这是合规改写机制，不是审核绕过机制。

### 后台任务状态

任务状态：

```text
queued → running → completed
                   ↘ failed
```

公开字段包括：

```text
id, kind, targetId, targetName, status, createdAt, updatedAt,
imageUrl, model, quality, size, error, code,
attempt, maxAttempts, prompt, rewritten, statusMessage, archive
```

Node 服务重启时，无法确认的 `queued` 或 `running` 任务会被标记为失败，避免永久显示加载中。

## 12. 本地 Node API

由 `server/local-server.mjs` 直接处理：

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/api/storage` | GET/PUT | 加载或保存设置和聊天历史 |
| `/api/image` | GET/POST | 图片准备、后台任务、任务列表 |
| `/api/role` | POST | 根据人物历史生成角色资料 |
| `/api/models` | GET | 对话模型列表 |
| `/api/image-models` | GET | 图片模型列表 |
| `/api/_ai-bridge` | POST | Vinext Route Handler 到外部模型的本地桥接 |
| `/generated-images/:file` | GET | 返回本地生成图片 |

`/api/image` actions：

| action | 作用 |
| --- | --- |
| `prepare` | 根据当前剧情整理场景提示词 |
| `prepare-character` | 根据人物资料整理形象提示词 |
| `generate-async` | 创建后台图片任务，推荐路径 |
| `generate` | 同步生成兼容入口，也有最多三次机制 |

由 Vinext 处理：

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/api/chat` | POST | 对话 |
| `/api/suggestions` | POST | 快捷回复 |
| `/api/summary` | POST | 剧情总结 |
| `/api/world` | POST | 世界设定生成 |
| `/api/health` | GET | 配置状态 |

Grok 快捷回复使用 SSE 流式读取，最长等待 90 秒；网络中断或超时时直接返回本地三条备用选项，不再让辅助请求以 500 错误影响主对话。

## 13. 网络与手机排障

手机无法访问时依次检查：

1. `http://localhost:3000` 在电脑是否能打开。
2. `netstat -ano` 是否显示 `0.0.0.0:3000 LISTENING`。
3. `ipconfig` 查询的是当前正在使用网卡的 IPv4，不要沿用旧地址。
4. 手机和电脑是否在同一 Wi-Fi 或同一手机热点。
5. 手机或电脑是否开启 VPN。
6. Windows 防火墙是否允许 TCP 3000。
7. Wi-Fi 是否开启访客网络、AP 隔离或客户端隔离。
8. 电脑切换网络或重启后 IPv4 是否变化。

页面能开但模型调用失败时检查：

1. `/api/health`。
2. `data/server.log` 的最后几十行。
3. `.env.local` 中对应密钥是否配置。
4. `LOCAL_HTTP_PROXY` 指向的代理是否正在运行。
5. 中转站 `/models` 是否可访问。

`status_code=504` 通常表示中转站或上游生成超时，不是浏览器请求地址错误。图片超时当前为 600 秒。

## 14. 修改时必须保留的约束

1. 不使用数据库，继续使用 Node JSON 文件。
2. 不泄露或打印 `.env.local` 中的密钥。
3. 不覆盖用户已有 `data/settings.json`、`chat-history.json` 和图片。
4. 不擅自替换用户当前默认系统提示词。
5. 不把场景生图重新塞回聊天页面。
6. 场景和角色生图继续使用后台任务。
7. 400 内容拒绝最多总调用 3 次；其他错误不要盲目重试。
8. 多人上限保持可配置 1–10，含义是“本轮最多出现的不同角色人数”，不是消息条数。同一角色可以在互动后再次回复，但每条消息只能写该角色自己的动作和台词；总消息数由 `shared/ensemble-turns.js` 限制为人数的 4 倍，即最多 40 条。所有 turns 必须按时间顺序自然承接、避免重复和凑数，最后停在用户可插话的位置。
9. 每轮仍以用户为中心，最后停在用户可以插话的位置。
10. 长回复完成后定位到本轮开头，不要持续强制滚动到底部。
11. 手机入口必须继续监听 `0.0.0.0:3000`。
12. 修改数据结构时在 `companion-store.mjs` 中加入兼容迁移。
13. 人物稳定身份与基础关系必须高于剧情摘要；压缩不得删除未登场角色记忆。

## 15. 推荐修改流程

1. 阅读本文与任务相关源码。
2. 检查工作区已有改动，避免覆盖用户内容。
3. 修改最小必要文件。
4. 更新数据规范化和迁移逻辑。
5. 为关键能力补充 `tests/rendered-html.test.mjs` 断言。
6. 执行语法检查、构建和测试。
7. 只停止本项目占用 3000/3001 的准确进程。
8. 启动 `node server/local-server.mjs`。
9. 验证首页、`/api/health` 和相关只读接口。
10. 未经用户要求，不要为了测试主动触发付费图片生成。

## 16. 当前已知运行状态

截至本文更新时间：

- 本地构建通过。
- 自动测试通过。
- Node 服务可监听 `0.0.0.0:3000`。
- 默认图片模型为 `gpt-image-2`。
- 场景生图已迁移到独立页面。
- 后台任务会展示尝试次数、改写状态、最终提示词、结果和错误。
- 多人参与上限已经贯通界面、文件存储和聊天接口到 10。
- 对话长回复会定位到本轮第一条回复。
- 电脑上的全局 `npm` 命令曾出现启动脚本路径损坏；项目可直接用 Node 调用 Vinext CLI 构建，不代表项目依赖损坏。

## 17. Android / UniApp 独立版本

现有 Node 网页版必须继续保留。安卓版本位于 `uniapp/`，使用 UniApp Vue 2 作为云打包外壳，并通过本地 `<web-view>` 加载 `uniapp/hybrid/html/` 中的内置网页，不需要电脑、局域网或远程业务服务器。

同步与职责：

- `app/VueGirlfriend.jsx`、`app/globals.css`、`shared/system-prompt.js` 和 `config/ai-models.json` 是共享界面、样式、默认提示词与模型配置来源。
- `vite.mobile.config.js` 与 `mobile/web/main.jsx` 把共享内容编译到 UniApp 本地网页。
- `mobile/web/native-api.js` 拦截页面的 `/api/*` 请求，使用安卓 5+ 本地存储、原生 HTTPS 请求和 Downloader 代替 Node。
- `pnpm run build:android-web` 是同步安卓内置网页的命令。
- 电脑网页版的 Node 文件仍保存在 `server/` 与 `app/api/`，不能因为新增 App 而删除。

安卓端本地保存设置、聊天、图片任务和 API 配置。真实 Key 由首次启动时填写，不写入源码。图片下载至 `_downloads/night-mailbox/`。图片模型调用与网页端统一为 600000 毫秒（10 分钟）上限；图片下载阶段单独计时。

HBuilderX 云打包前：

1. 在项目根执行 `pnpm run build:android-web`。
2. 用 HBuilderX 打开 `uniapp/`。
3. 替换或申请 `manifest.json` 的 DCloud AppID。
4. 执行 Android 原生 App 云打包。

安卓系统彻底杀死应用进程后，纯 JavaScript 后台任务不能保证继续运行；仅退到后台时通常仍可继续。若以后要求“被系统杀死也必须继续生图”，需要新增原生 Android WorkManager 插件。

## 18. 单文件 HTML 直连版本

用户已暂停 UniApp 方案。当前免 Node 版本输出为 `standalone/night-mailbox.html`：

- 页面、Vue 2 运行时代码、CSS 和默认头像全部内嵌在一个 HTML 文件。
- 浏览器直接调用 DeepSeek、Grok/Claude 中转站和图片接口，不经过 Node。
- 设置、聊天、角色、世界、摘要、图片任务及 API 配置以 IndexedDB 为主要存储。
- API 配置保存时必须等待 IndexedDB 事务完成后再刷新，避免出现 Token 已填写但未生效。
- 单文件版和移动版不再显示右上角悬浮 API 按钮；入口位于“设定”页面最下方的低调“接口连接设置”文字按钮。首次没有配置密钥时仍会自动打开设置面板。
- 单文件版的新建/空白档案默认载入 `mobile/web/standalone-default-scenario.js` 中的“艾尔德兰神骸世界”：用户是普通穿越者哥哥，晚晚与小雨是拥有漫长实际年龄、外表固定为孩童形态的神子妹妹，关系为纯粹亲情且没有恋爱线。默认档案包含世界设定、当前剧情、两位角色完整资料、按角色长期记忆和开场消息。
- 已有 IndexedDB 档案不会被版本更新静默覆盖。“设定 → 剧情与角色长期记忆”提供“载入默认艾尔德兰档案”按钮，用户确认后才替换当前 HTML 的世界、角色、记忆与聊天记录；API Token 保持不变。
- 默认开场记录使用真实换行符。旧版本曾把 `\n` 作为可见文本写入 IndexedDB；`mobile/web/native-api.js` 的历史读取迁移会只对带【场景/心情/动作/对话/剧情推进】标签且没有真实换行的旧消息转换字面量 `\n`，不会修改普通用户消息。
- 单文件通过 `file://` 打开时，`fetch("/api/...")` 会被浏览器解析成磁盘路径；本地适配层必须优先使用原始请求字符串识别 `/api/`，否则会误报“本地文件服务暂时不可用”。
- 默认扩展对话模型为 `grok-4.5`，Claude 只作为手动备用；多人回复必须先把 `scene`、`mood`、`action`、`dialogue` 和 `progression` 合并成前端消费的 `content` 字段，不能把原始字段直接返回给聊天播放组件。
- `/api/models` 在浏览器内由适配层直连中转站 `/models`，并与 `config/ai-models.json` 静态候选合并。
- 生图请求上限仍为 10 分钟；成功图片必须下载并转成 Data URL 写入 IndexedDB。若浏览器因 CORS 无法下载，不再把有期限的上游 URL 伪装成本地图片，而是明确把任务标记为本地保存失败。
- 外部接口必须允许浏览器 CORS；单文件无法绕过上游的跨域限制。

### 18.1 独立 HTML 角色动作图库

独立 HTML 已加入“固定表情图库＋AI 指令驱动”的角色舞台，Node 网页版不显示该功能：

- 默认状态定义在 `shared/role-visual-states.js`，当前共 32 种，包含撒娇、嫌弃、坏笑、困倦、牵手、抱臂、警戒、施法等常用表情和动作。
- 每个角色的 `visualStates` 按角色 ID 保存；固定角色和临时角色都可以进入“人物详情 → 动作图库”管理。默认库按需初始化，用户可修改名称、情绪、动作、动作提示词和最终图生图提示词，上传替换图片，也可以新增或删除自定义状态。
- 动作图不再分别从文字重新设计人物。用户必须先生成、导入或从当前头像确认一张角色基底图；基础形象生成成功后会自动成为基底。每张动作图始终引用同一张基底图调用 `POST /v1/images/edits`，使用 `multipart/form-data` 的 `image` 字段，并只修改表情和姿势。不能拿上一张动作图继续生成，以免连续编辑造成外观漂移。
- 实测发现把完整人物资料再次塞进图生图提示词会诱导模型重新设计人物。动作图最终提示词保持短而明确：先写该状态动作，再写“纯白色背景”，然后强制人物形象、脸型、五官、发型、发饰、衣服、配饰、鞋子、身体比例、画风、镜头距离和构图全部不变。旧版自动生成且包含“角色资料仅用于补充”的最终提示词会在打开动作图库时清空，下一次生成自动使用新版；用户自己编辑过的其他提示词保留。
- 角色基底图以 `visualBaseSource`、`visualBaseImageUrl` 和 `visualBaseImageJobId` 保存。上传图保存在 IndexedDB；生成图只引用本地图片任务 ID，避免同一大图重复存储。基底图推荐单人全身、完整头脚、正面或微侧面和纯色简洁背景。
- 上传图片以 Data URL 写入当前设备 IndexedDB；AI 生成图存入图片任务记录，角色状态只保存 `imageJobId`，避免重复保存同一张大图。
- 批量生图会先显示张数和按每张约 0.03 元计算的估算费用，确认后才提交。Node 与单文件 HTML/App 共用“最多 6 张并发”的后台任务规则：队列有空位即同时启动，超过 6 张的部分继续排队；每张图仍独立遵守最多 3 次图片接口调用的重试上限。`mobile/web/native-api.js` 的队列和任务记录持久化到 IndexedDB；动作图使用 `kind: "visual-state"`，不会混入场景相册，也不会自动覆盖角色头像。
- 多人模型返回的每个 turn 附带 `visual.preferredStateId`、`emotion`、`action` 和 `intensity`。这些字段随聊天历史持久化；旧消息没有标签时，前端按动作文字做本地回退判断。
- 聊天页顶部角色舞台展示当前发言人、情绪、动作和对应角色图，图片使用双图层淡入淡出切换。打开角色图库时会预加载该角色已有图片，减少切换延迟。
- 舞台未设置场景背景时使用纯白底，以匹配当前动作图。舞台图片上不显示 `emotion`、`action` 等内部英文编码；这些标签仍保存在历史中供匹配。点击舞台角色图、任意角色回复气泡或该回复左侧头像，会切换到并重新播放该条回复对应的动作，已经显示同一图片时通过 `stageMotionNonce` 重启动画。
- 动作图库中只有真正生成或导入的状态图才显示缩略图；缺图卡明确显示“未生成”，不能拿角色基底图填充。点击已有动作图缩略图会打开全屏大图预览。聊天舞台匹配到尚未生成的动作时也不再用基底头像冒充：同一角色保留上一张有效动作图，不同角色则先显示空舞台，直到存在对应状态图；角色主动关闭动作图库时仍可显示普通头像。
- 舞台背景与角色立绘是两个独立图层。背景默认不存在，用户可打开“添加背景”，自行编辑提示词、从当前对话调用对话模型整理空镜提示词、导入本地背景或确认付费生成一次。背景使用 `stage-background` 任务和横图 `1536x1024`，禁止人物；生成/导入后与角色图仅在前端叠放，不再额外调用合成接口。清空背景只解除当前舞台引用，不删除历史图片任务。
- 当前立绘带轻微呼吸动画：以人物下半身为变形锚点，组合亚像素左右摇摆、约 2px 上下起伏和不超过约 1.3% 的纵向缩放，并同步改变脚下阴影。模型返回的 `visual.intensity` 会把节奏分为平静、自然和活跃三档；系统开启“减少动态效果”时动画自动停用。
- 纯 HTML 在页面继续打开时可后台排队生图；浏览器页面被完全关闭后 JavaScript 无法继续正在进行的请求。重新打开时尚未开始的 `queued` 任务继续执行，被关闭打断的 `running` 任务会标记为失败，避免重复扣费。
- `scripts/test-image-edit.mjs` 是不打印密钥的真实接口诊断脚本：不传参数时先调用文生图并下载基底图，再调用 `/images/edits`；传入一个项目内图片路径时只复用该基底图测试图生图。Node 诊断必须使用与 `undici.fetch` 配套的 `undici.FormData`，否则中转站无法解析 multipart 字段；浏览器单文件版继续使用浏览器原生 `fetch` 与 `FormData`。
- 2026-07-28 已真实验证 `gpt-image-2`：`/images/generations` 成功生成并下载 1024×1536 基底图，随后 `/images/edits` 使用该本地 PNG 成功生成 1024×1536 挥手动作图。人物脸型、发型、服装和整体比例保持稳定，只有表情与姿势发生预期变化。

## 12. 完整备份与迁移

顶部功能菜单中的“备份迁移”打开独立的备份弹窗；设置页只保留进入该弹窗的入口。弹窗提供单文件 JSON 导出与导入，不占用聊天界面，也不嵌套在手机端的长设置滚动区。备份格式标识为 `night-mailbox-backup`，当前版本为 `1`，包含：

- 世界设定、系统提示词、剧情摘要、按角色 ID 保存的长期记忆与压缩设置。
- 主角色、固定角色、临时角色、人物外观、对话提示词、图片提示词和动作图库。
- 最多 1000 条对话记录。
- 图片任务、相册档案、舞台背景、基底图、角色图、动作状态图与场景图。
- 不含 API 地址密钥；导入不能覆盖当前设备的 API Key。

图片在备份中去重存入 `assets`，资料中的图片地址替换为 `backup-asset://asset-id`。单文件 HTML/App 导入时恢复为本机 Data URL；Node 版导入时写入 `data/generated-images/` 并恢复为本地图片路径。读取文件后先在页面内显示对话、图片和角色数量，再使用页面内的确认/取消按钮二次确认；禁止使用 Android WebView 中可能无法响应的 `window.confirm`。若当前仍有排队或生成中的图片任务则拒绝导入。备份中的未完成任务导入后统一标记为失败，不自动续跑，避免重复扣费。

生成命令：

```powershell
node scripts/build-standalone-html.mjs
```

构建入口为 `vite.standalone.config.js`，临时产物位于 `standalone/.build`，最终只需分发 `standalone/night-mailbox.html`。

## 13. 性能优化与多阶段表演

- 生图工作台只在进入“生图”页时挂载，离开后卸载图片网格；相册首屏最多渲染 18 条，可手动继续加载。
- 图片任务轮询采用自适应间隔：有任务 3.5 秒，生图页空闲 12 秒，其他页面空闲 30 秒。
- 单文件版图片任务保留内存缓存并以 250ms 合并写入 IndexedDB，避免并发任务反复解析和序列化整份 Base64 相册。
- 角色动作图片只预载当前状态与默认状态，不再预解码全部动作图库。
- 单文件 HTML 会跳过无意义的 `plusready` 等待；对 408、429、500、502、503、504 及临时网络异常最多自动重试一次。
- 多人回复的 `visual` 支持 `sequence` 数组，最多 4 段。每段包含 `preferredStateId`、`emotion`、`action`、`intensity`、`durationMs`；时长限制为 700–2600ms。
- 前端收到序列后按顺序淡入切换，点击对应历史消息可重新播放完整变化过程。
- 快捷回复在主对话完成后延迟生成；用户开始下一轮时会取消尚未开始的生成，减少辅助请求与主对话争抢接口。

### 2026-07-29：停用旧动作展示界面

- 单文件 HTML 不再显示聊天页角色立绘舞台、消息动作重播入口和角色详情中的动作图库。
- 点击对话头像恢复为查看人物详情；对话气泡不再作为动作播放按钮。
- 已保存的人物、头像、已完成动作图和视觉字段不删除，完整备份仍可携带底层旧数据，便于未来接入新的动作 API。
- 未开始或被页面中断的 `visual-state`、`stage-background` 任务会停止并标记失败，且不会继续调用收费图片接口；失败任务本来就不进入相册。
- 普通人物形象生成、人物相册和场景图片功能继续保留。
- 停用的是聊天页的动作播放与动作生成编辑器，不删除用户以前已经生成的动作图片。每个角色详情固定提供“人物相册”，把该角色的 `character`、`visual-state`、头像、上传基底图和直接导入到 `visualStates` 的图片按角色 ID 聚合；旧任务缺少角色 ID 时可按角色名兼容识别。
- “图片与相册”中的场景相册独立展示对话场景与旧舞台背景；人物总相册可查看所有角色形象和旧动作图。点击任意图片可放大，并可删除该图片；聊天记录中已有 `message.imageUrl` 的旧场景图也能点击放大，但从聊天入口打开时不直接提供删除按钮。
- 删除相册图片必须同时清除图片任务记录、角色头像/动作状态/基底图中的对应引用，并在安全校验后删除 `data/generated-images` 或 Android `_downloads/night-mailbox` 下的实际文件；不得删除角色、对话、剧情摘要或其他图片。正在排队或生成的任务禁止删除。

## 14. 错误日志

- “设置 → 错误日志”用于查看模型、网络、生图、本地存储、页面脚本和未处理异步错误。
- 日志独立保存在当前设备的 `localStorage`（键名 `night-mailbox-error-logs`），最多保留最近 100 条，不写入聊天记录，也不进入完整内容备份。
- 日志支持展开查看、导出 JSON 和用户确认后主动清除。
- 导出内容包含时间、来源、当前页面、模型、浏览器信息、错误消息和堆栈；写入前必须过滤 Bearer Token、`sk-`/`key-` 密钥及常见 JSON 密钥字段。
- 模型 HTTP 错误、JSON 解析失败和空正文错误还要保存返参诊断：解析阶段、HTTP 状态、`content-type`、上游请求 ID、脱敏后的原始响应正文、`finish_reason` 与 usage。模型原始响应最多保存 100,000 字符，单条错误详情最多保存 120,000 字符，并明确记录原始长度和是否截断。

### DeepSeek 空正文恢复

- 单文件版会把已停用的 `deepseek-chat`、`deepseek-reasoner` 自动映射为当前 `deepseek-v4-flash`。
- App/单文件的“接口连接设置”提供“对话流式传输”开关，默认开启并随 API 配置持久化在当前设备的 IndexedDB；开启发送 `stream: true`，关闭发送 `stream: false`，对 DeepSeek 与 Grok 都生效。原生网络层收齐响应后统一解析，当前聊天界面仍是整轮完成后展示，不是逐字渲染。解析器同时兼容 JSON、SSE、字符串内容、内容数组、`message.refusal`、`choice.text` 和 `output_text`。
- 多人模式的 system 消息必须明确出现 `JSON` 并包含目标对象样例；输出额度由最大参与人数计算，最高 12,000 tokens，不再额外压到 6,500。
- 文本模型不使用供应商强制 JSON 模式。`shared/loose-json.js` 会依次尝试完整正文、Markdown 代码围栏和按引号/转义规则平衡提取出的对象或数组；允许 JSON 前后有解释文字，并可安全修复尾逗号、字符串中的原始换行及字符串外的全角冒号/逗号。每个调用方仍按 `turns`、`operation`、`roleMemories`、`prompt` 等必需字段选择并校验正确结果，不能只因“能解析”就接受错误对象。
- DeepSeek 或 Grok 返回 HTTP 200 但可见正文为空，或 SSE 没有 `[DONE]` 且没有 `finish_reason` 时，视为不完整响应。若原请求为流式，自动使用完全相同的 messages 和 system/user prompt 改成 `stream:false` 恢复一次；若原请求已经是非流式则原样重试。不能把只存在于 `reasoning_content` 的推理过程当作最终回复。
- 第二次仍为空时，App 返回一条本地保底消息并停止本轮，不让多人角色继续自说自话；错误日志记录两次原始响应、实际 provider/model、传输格式、SSE 是否完整、响应字段结构、内容长度、前 40 个字符码点、`finish_reason`、`completion_tokens` 和 `reasoning_tokens`。`reasoning_content` 只记录是否存在及长度，不作为最终正文。
- 多人返回先兼容 `{turns}`、嵌套 `data/result/response`、`messages/replies` 和顶层数组，并兼容 `speaker/name/character`、`dialogue/text/message` 等常见字段名。仍无法解析时使用同一个模型发起一次非流式 JSON 格式整理；整理失败返回 502 并保留诊断，不再把整段原始回复伪装成单角色消息。
# 2026-07-29：UniApp 局域网页面更新

- UniApp 原生外壳入口位于 `uniapp/pages/index/index.vue`。App 首次运行把 `_www/hybrid/html/night-mailbox-app.html` 复制到固定私有路径 `_doc/night-mailbox/index.html`，以后始终用 App 内 `web-view` 打开该固定路径，不调用外部浏览器。
- App 首页保存电脑局域网地址，可调用 `GET /app-update/manifest.json` 检查并拉取页面。服务器收到清单请求时自动执行 `scripts/build-standalone-html.mjs`，因此普通共享页面改动不要求用户手工构建。
- App 更新专用单文件为 `outputs/night-mailbox-app-update.html`。它带有 `window.__NIGHT_MAILBOX_APP_SHELL__` 标记，继续使用 Android 5+ 原生网络层；普通 `standalone/night-mailbox.html` 保持浏览器直连行为。
- 更新包先下载到 `index.update.tmp`，校验 `byteSize`，设备支持 Web Crypto 时再校验 SHA-256。校验通过后把旧文件移动为 `index.backup.html`，再原子替换 `index.html`；失败时保留或恢复旧版。
- HTML 更新只替换页面代码，不主动删除 IndexedDB、聊天、人物、图片或 API 配置。App 卸载或系统“清除数据”仍会删除 App 私有数据。
- `server/local-server.mjs` 新增只读接口 `/app-update/manifest.json` 与 `/app-update/night-mailbox.html`，只公开构建后的 HTML，不公开 `.env.local` 或 `data`。
- 普通界面、样式、提示词和移动直连接口逻辑可在 App 中直接点拉取；修改 `uniapp/pages/index/index.vue`、`manifest.json`、权限、模块、AppID 或图标后仍需重新云打包。
- `mobile/web/main.jsx` 会在 HTML 页面启动时把当前内容 WebView 切换为 `softinputMode: "adjustResize"`，并把 `visualViewport` 高度和 `plus.navigator.getSafeAreaInsets()` 的底部值写入 CSS 变量。移动端输入框必须使用这些变量预留底部安全区，不能再给 `body` 额外添加顶部 padding，否则整屏高度会把输入框挤出视口。`uniapp/pages/index/index.vue` 创建新 WebView 时也显式使用 `adjustResize`，供以后重新云打包时保持一致。
- 完整操作和排错说明见 `uniapp/LOCAL_UPDATE.md`。

## 15. 剧情时间、未来约定与移动端布局

### 独立剧情时钟

剧情时间不是手机系统时间，而是当前故事自己的时间轴。`shared/story-time.js` 是 Node、普通单文件 HTML 和 App 内置页共用的唯一实现：

- `storyClock.day`：剧情第几日，最小为 1。
- `storyClock.segment`：`dawn`、`morning`、`noon`、`afternoon`、`evening`、`night`、`late-night`，界面分别显示清晨、上午、中午、下午、傍晚、夜晚、深夜。
- `storyClock.location`：当前剧情地点，用户可在日程页直接修改。
- `storyClock.calendar`：日历名称，默认“剧情历”。

旧档案没有 `storyClock` 时从第 12 日傍晚开始；已有档案始终使用保存值。Node 保存到 `data/settings.json`；单文件 HTML/App 保存到 IndexedDB 的 settings 记录。完整备份通过 settings 自动携带时钟与日程，不包含 API Key。

聊天请求必须同时传入 `storyClock` 和 `storyEvents`。Node 的 `app/api/chat/route.ts` 与单文件版 `mobile/web/native-api.js` 会把当前时间、地点和有效约定注入模型上下文。角色必须遵守已确认日程，不得私自跳日期，也不得替用户完成“去或不去”等重大决定。

### 未来约定

用户在对话中提到“今晚”“明天下午”“三天后”“下周”“过几天”等未来计划时，前端先用 `shouldAnalyzeStoryEvent()` 做低成本候选筛选，但不能直接建立日程。候选消息发送到 `/api/event`，由当前对话模型结合最近对话、剧情时间和已有有效日程判断：

- `none`：不是明确约定，不保存。普通时间描写、假设、疑问、随口提议和未被用户接受的角色建议都必须忽略。
- `create`：建立一条新的待确认约定。
- `update`：同一约定改期、换地点、换参与者或改变内容，使用 `targetEventId` 替换原记录，不能重复新增。
- `cancel`：用户明确取消已有约定。
- `complete`：用户明确说明已经完成。

模型置信度低于 0.78 时强制视为 `none`。`shared/story-event-ai.js` 统一维护候选筛选、判定提示词和 JSON 校验；Node 使用 `app/api/event/route.ts`，单文件 HTML/App 使用 `mobile/web/native-api.js` 的 `/api/event` 本地实现。所有 create/update 结果仍先保存为 `pending-confirmation`，不能直接当成已经确定的事实；用户可以确认、修改或忽略。

每条 `storyEvents` 记录包含：

```text
id                     稳定事件 ID
title                  约定内容
day / segment          目标剧情日和时段
location               地点
participants           相关角色姓名
notes                  用户备注
sourceMessageId/Text   来源消息
status                 pending-confirmation / confirmed / accepted /
                       declined / completed / missed / cancelled
needsDateConfirmation  “过几天”等模糊日期需要再次确认
reminderCount          已提醒次数
snoozedUntil           延后提醒的剧情时间值
createdAt / updatedAt  创建和修改时间
```

到达或超过已确认约定的时间后，聊天输入框上方显示提醒卡，可选择：

- “现在去”：事件进入 `accepted`，并让模型从当前场景自然承接该事件。
- “不去了”：事件进入 `declined`，并让相关角色自然回应取消决定。
- “改时间”：打开日程编辑器。
- “稍后提醒”：推迟到下一个剧情时段再提醒。

剧情压缩只处理聊天消息、`storySummary` 与 `roleMemories`，不能删除或折叠 `storyEvents`。这样“几天后要做的事”不会因为上下文压缩而丢失。

注意：`activeScheduleEvents` 会返回标准化后的副本。所有按钮修改必须通过前端 `patchStoryEvent(id, patch)` 按 ID 更新原始 `storyEvents`；不能直接修改计算属性里的 event，否则确认、忽略、开始和稍后提醒看似点击成功但原状态不会变化。

### 时间推进

聊天页标题栏的时间按钮打开快捷时间面板，日程页提供“下一时段、今晚、明天上午、自定义跳转”。所有跳转先显示目标时间和途中经过的约定，再由用户确认：

- 默认保留途中未处理的约定，抵达后继续提醒。
- 用户关闭“保留途中未处理的约定”时，经过的有效约定标记为 `missed`。
- 可选择在聊天中写入一条时间过渡记录；过渡只表示日常时间流逝，不替用户作重大决定。
- 目标时段不能倒退。若选择同一天已经过去的时段，自动改为下一天该时段。

### 移动端信息架构

手机不再使用固定底部导航，避免长期占用聊天高度。顶部栏固定为：

- 左侧“夜”图标，点击返回聊天。
- 中央剧情时间，点击打开时间推进面板。
- 右侧设置按钮，点击打开六宫格功能菜单。

功能菜单包含返回聊天、人物管理、剧情日程、世界与设置、图片与相册、数据与诊断。旧的聊天人物/模型标题行和消息上方重复时间分隔行已经删除；对话服务和模型选择继续放在“世界与设置”页面。

手机聊天气泡字号为 16px、行高 1.78，正文最大宽度提高到 92%；快捷回复保持横向滚动。新布局的目标是优先阅读长对话，同时仍保留输入框上方的到点提醒和待确认约定。

### Android App 备份文件

App 内导出不能依赖浏览器 `<a download>`。`mobile/web/native-api.js` 暴露 `window.__NIGHT_MAILBOX_NATIVE_BACKUP__`：

- 导出时先把 JSON 写入 `_doc/night-mailbox/backups/`，作为 App 内可靠副本。
- 再尽力复制到 `_downloads/night-mailbox/backups/`，便于用户从系统文件管理器取出；外部目录写入失败不影响 App 内副本。
- 最近一次 App 内备份路径保存在 `localStorage` 的 `night-mailbox-native-last-backup`，可用“恢复 App 最近备份”直接恢复。
- “从备份文件导入”使用用户点击后主动触发的屏幕外文件输入（不能用 `display:none`），并用 `FileReader.readAsText()` 读取，兼容不支持 `File.text()` 的旧 Android WebView。读取完成后由独立备份弹窗显示数量并等待用户确认。
- 普通浏览器和 Node 网页继续使用 Blob 下载；所有备份仍不包含 API Key。

## 16. 独立角色动作素材工作台

`character-motion-engine/` 是与主聊天界面分开的本地角色动作实验项目，入口为 `http://127.0.0.1:4174/studio/`，启动命令为：

```powershell
cd C:\Users\hcq\Documents\Project-She\character-motion-engine
node scripts/serve.mjs
```

- 角色资料和图片保存在 `character-motion-engine/workspace/`，不使用数据库。
- 第一步图库只显示原始参考图、规范绿幕图和透明抠图；第二步图库只显示 GPT Image 2 生成的动作与表情图。
- `normalized` 和 `transparent` 各只保留最新结果。用户再次点击规范画布或自动抠图时，同类型旧文件移动到角色 `.trash/`，避免重复素材持续累积。
- 删除单张图片会移动到角色 `.trash/`。删除角色项目会把整个目录移动到 `workspace/.trash-projects/`，均不立即永久清除。
- 角色有运行中或排队中的图片任务时禁止删除项目。
- 图生图使用父项目 `.env.local` 和 `config/ai-models.json`，密钥不返回浏览器。请求发送到 GPT Image 2 `/images/edits`，一次只运行一张，超时十分钟。
- 工作台会明确显示“缺少规范基准图、接口未配置、正在生成某张图片、可以生成”等状态；运行中按钮锁定是重复扣费保护，不代表接口故障。

## 17. 单文件 HTML / App 本地资产、历史与长期记忆

这一节只适用于 `standalone/night-mailbox.html`、`outputs/night-mailbox-app-update.html` 和 UniApp 内置 HTML。Node 完整版仍使用原来的 JSON 文件服务，不要把这里的浏览器存储接口复制到 Node 路由。

### IndexedDB 版本与对象仓库

`mobile/web/native-api.js` 打开 `night-mailbox` 的 IndexedDB v4。`local-data` 保留旧版 settings/history/imageJobs/API 配置兼容记录，并新增：

```text
assets             图片元数据，keyPath=hash
asset-blobs        普通浏览器中的原图 Blob，key=hash
asset-thumbnails   可清除的缩略图 Blob 缓存，key=hash
messages           永久原始消息，keyPath=id
episodes           剧情章节摘要，keyPath=id
memory-facts       可检索长期事实，keyPath=id
meta               图片迁移等可恢复任务状态
```

图片业务数据统一只保存 `asset://<sha256>` 引用：

- Android App 原图写入 `_doc/night-mailbox/assets/<sha256>.<ext>`，IndexedDB 只保存元数据。
- 普通单文件 HTML 没有 App 文件系统时，原图以 Blob 保存在 `asset-blobs`。
- 相同内容以 SHA-256 去重，同一运行环境只保存一份原图。
- 相册和头像默认读取 `asset-thumbnails` 的最大 420px 缩略图；打开大图预览时才读取原图。
- 新生成图片和用户导入的基底图立即进入统一资产层，不再长期保存 Base64。

“数据与诊断”页面的“一键迁移现有图片”负责把旧 Data URL、`_downloads` 和旧文件路径转为资产引用。迁移逐张写入并核对文件大小；每张成功项立即进入替换集合，扫描完成后一次提交所有成功引用，失败项继续保留原引用。只有已成功替换且能够确认属于旧 `night-mailbox` 目录的文件才会删除。中断或部分失败时 `meta/asset-migration-v1` 记录 `partial/paused` 状态和具体错误，下次可继续。不要改成“先删后写”，也不要因单张失败回滚已经成功的图片。

如果旧版已经产生 `asset://` 引用，但对应元数据仍标记为 `backend=indexeddb`，迁移还会把原图 Blob 写入 `_doc/night-mailbox/assets/`，核对文件大小并更新元数据为 `app-file`，最后才删除 IndexedDB 原图 Blob。`migratableAssetCount` 用于在 App 中显示这部分待搬迁图片；这也是“引用已迁移但 App 文件数仍为 0”时必须执行的第二层迁移。

Android `file://` WebView 可能没有 `crypto.subtle`。SHA-256 回退实现必须使用 `shared/sha256.js` 的固定 64 字节分块算法，不能恢复为按图片总长度扩张的 `words[]`，否则较大图片会抛出 `Invalid array length`。`/api/assets` 的未捕获迁移错误必须携带 `asset-migration-unhandled` 诊断、当前图片和已完成数量，供错误日志导出。

App 文件写入后的校验只读取 `File.size`，不得为了核对大小再次把整张文件读成 Base64。`_doc/night-mailbox/assets` 目录和本轮刚创建的 `FileEntry` 会在内存中复用，减少逐张目录解析。迁移期间前端每 1.2 秒读取 `meta/asset-migration-v1`，显示完成数、总数和当前图片；轮询只读状态，不能启动第二个迁移任务。

H5+ 标准 `FileWriter.write()` 只保证写入字符串，不能把 IndexedDB 读取出的 `Blob` 直接传入；部分 Android WebView 对错误参数既不成功回调也不失败回调，会导致迁移永远停在第一张。Android App 必须先把 Blob 转成原始 Base64，再通过 `plus.android` 调用 `android.util.Base64` 和 `java.io.FileOutputStream` 写入真实字节；非 Android 环境才回退到 H5+ 的 `writeAsBinary`。Blob 转换和文件写入都必须有超时，单张失败记录错误后继续下一张。

迁移 POST 只负责创建一个进程内唯一的后台任务，并立即以 HTTP 202 返回；前端随后轮询 `/api/assets` 的迁移状态，直到 `completed`、`partial` 或 `paused`。这样长迁移不会占住一次原生网络请求，也不会因前端请求超时误判失败。App/WebView 被彻底关闭后进程内任务仍会停止，但逐项状态和已提交引用保存在 IndexedDB，重新打开后可安全继续，不得重复创建并行迁移。

### 原始对话归档

`local-data` 中的 history 只是当前聊天窗口，`messages` 才是不会因剧情压缩丢失的原始历史库。每次保存当前窗口时都按消息 ID upsert 到 `messages`，同时记录：

```text
createdAt       现实创建时间
storyDay        当时剧情日
storySegment    当时剧情时段
speakerId       user 或稳定角色 ID
episodeId       active 或所属剧情章节 ID
archivedAt      被章节总结归档的时间
```

剧情压缩成功后可以把当前窗口替换为一条“记忆已整理”提示，但不能删除 `messages` 中的原始消息。备份页提供：

- 清空当前窗口：不删除历史库。
- 按剧情日期浏览最近历史。
- 永久删除 N 天以前、且不在当前窗口中的归档消息；执行前必须二次确认。

完整备份 v1 继续兼容旧文件，同时新增 `archive.messages`、`archive.episodes` 和 `archive.memoryFacts`。导入是内容替换操作：先清理旧历史/章节/事实，再恢复备份；API Key 始终不进入备份。

### 结构化长期记忆与本地检索

`/api/summary` 不再固定调用 DeepSeek，而是沿用当前选择的对话服务和模型。模型返回带示例约束的宽松 JSON，包含：

- `storySummary`：供模型快速理解的总剧情摘要。
- `episode`：本段剧情的标题、完整事件摘要和关键词。
- `roleMemories`：按永久角色 ID 保存的关系、重要经历、状态、最后场景和承诺。
- `facts`：关系、事件、约定、物品、地点、偏好、秘密和状态等可独立检索事实。

解析失败时必须报错并保留当前窗口，不能用不完整结果覆盖旧摘要。成功后先把章节、事实和原始消息的 `episodeId` 原子写入 IndexedDB，再允许前端缩短当前窗口。未登场角色仍由永久名册基线补全，不能从 `roleMemories` 删除。

每次 `/api/chat` 调用前，本地会结合最新用户文本和提到的角色，从 `memory-facts`、最近 `episodes` 以及 `messages` 原始片段中检索相关内容；检索结果与当前 `storyClock`、有效 `storyEvents`、人物名册和剧情摘要一起注入系统上下文。因此原始对话、明确约定和未登场角色身份不再只依赖一段摘要。

## 18. 数据诊断、聊天渲染与人物派生状态

单文件 HTML 和 App 更新版使用独立的“数据与诊断”页面，不能再把迁移、备份和日志嵌入人物设置弹窗。该页面集中管理：

- App 文件 / IndexedDB 图片资产状态与逐项迁移错误；
- 完整备份导入导出；
- 当前窗口与永久原始历史；
- 对话、生图、迁移、备份和存储分类错误日志。

图片后台任务的失败项不进入相册，但 `/api/image` 的 GET 响应通过 `failedJobs` 返回最近失败任务。前端只记录一次，并把模型、任务类型、角色、尝试次数、最终提示词和上游诊断写入错误日志。

聊天 DOM 默认只渲染最后 40 条消息，顶部按钮每次加载更早 30 条并保持当前阅读位置。这个限制只影响渲染；完整当前窗口和永久原始消息仍保存在 IndexedDB。

年龄和性格不再提供独立输入框。人物提示词是身份、年龄和性格的唯一人工编辑来源；AI 人物整理结果保存到 `role.derivedProfile`：

```text
initialActualAge      锚点剧情日的实际年龄
initialApparentAge    锚点剧情日的外表年龄
agingRule             normal / fixed / long-lived / ageless / unknown
corePersonality       从人物提示词和历史提取的稳定核心性格
characterDevelopment  当前剧情造成的性格发展
anchorStoryDay        年龄计算锚点
sourcePromptHash      防止未修改提示词时重复调用模型
```

`normal` 的实际和外表年龄每 365 剧情天加一；`fixed` 和 `long-lived` 只增加实际年龄；`ageless` 均不增加。聊天系统注入“当前计算年龄”，但人物提示词的稳定身份优先级更高。旧版 `age/personality` 字段只作为迁移回退，不能重新暴露为可编辑控件。

人物生图提示词使用固定拼接结构：程序把 `appearance` 作为“稳定外观”原样拼接一次，AI 只返回当前服装状态、姿态、表情、场景、灯光和镜头 JSON。不要再让模型整段重写稳定外观，也不要直接把旧 `imagePrompt` 重复拼进最终提示词。
