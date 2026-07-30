# 夜航信箱 App 局域网热更新

## 目标

Android App 把夜航信箱页面保存到自己的 `_doc/night-mailbox/index.html`。页面通过 App 内置 `web-view` 打开，不调用系统浏览器。

手机与电脑在同一局域网时，App 首页可以从电脑拉取最新页面。下载过程使用临时文件，校验成功后才替换正式文件；替换失败继续使用旧页面。

聊天、角色、世界设定、图片任务、API 配置等仍由页面保存到 App 的 IndexedDB。更新流程不会主动清除 IndexedDB，也不会改写 Token。

## 首次云打包

在项目根目录依次运行：

```powershell
node node_modules/vite/bin/vite.js build --config vite.mobile.config.js
node scripts/build-standalone-html.mjs
```

然后：

1. 使用 HBuilderX 打开 `C:\Users\hcq\Documents\Project-She\uniapp`。
2. 使用当前 AppID 和原来的云证书执行 Android 云打包。
3. 安装新 APK。

`scripts/build-standalone-html.mjs` 会同时生成：

- `standalone/night-mailbox.html`：浏览器单文件版。
- `outputs/night-mailbox-app-update.html`：电脑提供给 App 拉取的更新包。
- `uniapp/hybrid/html/night-mailbox-app.html`：APK 首次启动时复制到 App 私有目录的内置版本。

## 日常更新

电脑端运行：

```powershell
cd C:\Users\hcq\Documents\Project-She
node server/local-server.mjs
```

手机端操作：

1. 手机和电脑连接同一个 Wi-Fi。
2. 打开 App 更新首页。
3. 填写电脑当前 IPv4，例如 `192.168.1.6:3000`。
4. 点击“检查并拉取最新页面”。
5. 更新完成后点击“打开夜航信箱”。

请求更新清单时，电脑会自动执行最新页面构建，不需要用户另外运行构建命令。

## 哪些修改不需要重新打 APK

以下内容编译进单文件页面，可以直接在 App 中点拉取：

- `app/VueGirlfriend.jsx`
- `app/globals.css`
- `mobile/web/` 中的页面网络、IndexedDB 和直连接口逻辑
- `shared/` 中的提示词、人物、图片和对话公共逻辑
- `config/ai-models.json` 中编译进页面的默认模型配置

## 哪些修改仍需要重新云打包

以下内容属于原生外壳，修改后必须重新用 HBuilderX 云打包：

- `uniapp/pages/index/index.vue`
- `uniapp/App.vue`
- `uniapp/main.js`
- `uniapp/manifest.json`
- Android 权限、AppID、版本号、图标、启动图
- 原生插件或 5+ 模块

## 更新接口

电脑的 `server/local-server.mjs` 提供两个只读接口：

- `GET /app-update/manifest.json`
- `GET /app-update/night-mailbox.html`

清单包含 `version`、`byteSize`、`sha256`、`updatedAt` 和下载路径。接口只公开生成后的页面文件，不公开 `.env.local`、Token、聊天记录、人物资料或本地图片。

## 安全替换与回滚

App 的替换顺序：

1. 下载到 `_doc/night-mailbox/index.update.tmp`。
2. 校验文件大小。
3. 设备支持 Web Crypto 时继续校验 SHA-256。
4. 把当前 `index.html` 移动为 `index.backup.html`。
5. 把临时文件移动为新的 `index.html`。
6. 任一步失败都不使用临时文件；正式替换失败时尝试恢复备份。

首页“恢复安装包内置页面”只恢复页面代码，不主动删除 IndexedDB 数据。

## 连接失败排查

1. 用 `ipconfig` 查看电脑当前无线网卡 IPv4，不要沿用上一次网络的旧 IP。
2. 确认电脑运行的是 `node server/local-server.mjs`，公开端口监听 `0.0.0.0:3000`。
3. Windows 防火墙需要允许 Node.js 的专用网络访问。
4. 手机和电脑必须在同一个局域网，访客 Wi-Fi 或 AP 隔离会阻止互访。
5. 暂时关闭手机 VPN、代理或“仅允许 VPN 连接”等可能隔离局域网的设置。
6. 可先在手机浏览器访问 `http://电脑IPv4:3000/app-update/manifest.json`。能看到 JSON 再回 App 拉取。

局域网更新使用 HTTP 明文连接，只适合可信的家庭网络。真正的模型 Token 不经过电脑更新接口传输，也不会被写入更新包。
