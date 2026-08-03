# Android / uni-app 壳

uni-app 只负责把纯前端 H5 装进 Android WebView，不包含 Node 服务和局域网热更新。

打包前在项目根目录运行：

```bash
npm run build:app
```

该命令会更新 `uniapp/hybrid/html/night-mailbox-app.html`。随后用 HBuilderX 打开本目录并进行 Android 云打包。

角色、对话、图片与 API 配置保存在 App 自己的本地空间。升级 APK 时继续使用相同 AppID 和签名证书；清除 App 数据或卸载 App 会清除本地档案，重要数据应先在应用内导出。
