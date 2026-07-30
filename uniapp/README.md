# 夜航信箱 Android / UniApp

这是保留现有电脑网页版后新增的安卓独立版本。UniApp 只负责 APK 外壳，实际界面是打包在应用内部的本地 Vue 2 页面，不需要服务器、电脑或同一 Wi-Fi。

## 数据与网络

- 设置、聊天、角色、剧情摘要、图片任务和 API 配置保存在安卓应用本地。
- Grok、Claude、DeepSeek 和图片接口由手机直接通过 HTTPS 调用，不经过电脑 Node 服务。
- 生成图片下载到手机应用的 `_downloads/night-mailbox/` 目录。
- 图片生成请求最长等待 10 分钟；下载阶段另行处理。
- 卸载应用或在系统设置中“清除数据”会清除应用配置与本地记录，重要内容请自行备份。

## 同步网页界面

在项目根目录运行：

```powershell
pnpm run build:android-web
```

它会把当前 `app/VueGirlfriend.jsx`、`app/globals.css`、`shared/system-prompt.js` 和模型 JSON 配置编译到 `uniapp/hybrid/html/`。因此页面、样式、默认提示词和模型目录修改一次后，可重新执行该命令同步到安卓版本。

安卓专属网络、存储和图片下载逻辑位于 `mobile/web/native-api.js`。Node 服务端专属逻辑仍位于 `server/` 与 `app/api/`，不会被安卓 App 使用。

## HBuilderX 云打包

1. 使用 HBuilderX 打开本目录 `uniapp`。
2. 在 `manifest.json` 中获取或替换自己的 DCloud AppID。
3. 选择“发行 → 原生 App-云打包”。
4. 选择 Android；公共测试证书已经下线，没有自有证书时直接选择“使用云证书”，由 DCloud 按当前 AppID 生成签名证书。
5. 安装 APK，首次打开后点击右上角 `API`，填写自己的模型 Key 与地址。

打包前必须先在项目根目录执行一次 `pnpm run build:android-web`。

云证书会绑定当前 DCloud AppID。后续更新 APK 时必须继续使用同一个 AppID 和同一份证书，否则安卓无法覆盖安装旧版本。请在 DCloud 开发者中心妥善保管并下载备份该证书。

## 当前限制

- 安卓杀死应用进程后，正在进行的图片生成任务无法继续；仅切换到后台时通常可以继续。
- App 直接保存 Key 适合个人自用，不适合公开分发给其他人。
- H5 浏览器预览可能受到跨域限制，真机 App 使用 5+ 原生网络请求，不受浏览器 CORS 限制。
