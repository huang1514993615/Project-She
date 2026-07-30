# 夜航信箱单文件版

直接把 `night-mailbox.html` 复制到手机并使用浏览器打开。它不需要 Node、电脑、UniApp 或 APK。

## 数据保存

- 设置、聊天记录、人物、世界设定、剧情摘要、图片任务和 API 配置保存在当前浏览器的 IndexedDB。
- API Key 不会写进 HTML 文件。
- 请始终用同一个浏览器打开同一份文件。移动或重命名 HTML、清除浏览器数据、卸载浏览器，均可能导致浏览器把它视为新的存储空间或删除原数据。
- 图片接口返回临时 URL 后，页面会尝试下载并转为 Data URL 保存进 IndexedDB；若图片地址不允许跨域下载，则只能保留临时 URL。

## 直连接口要求

页面会直接请求 DeepSeek、Grok/Claude 中转站和图片中转站。接口必须允许浏览器 CORS 预检，并允许 `Authorization` 与 `Content-Type` 请求头；否则浏览器会拦截请求，此问题无法由单文件页面绕过。

## 重新生成

在项目根目录执行：

```powershell
node scripts/build-standalone-html.mjs
```

输出文件始终为 `standalone/night-mailbox.html`。
