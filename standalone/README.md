# 单文件 H5

`night-mailbox.html` 是构建产物，可直接复制到设备或静态文件空间。它不需要项目自己的服务器。

重新生成：

```bash
npm run build:standalone
```

数据和 API Key 保存在打开该文件的浏览器本地空间，不写入 HTML。模型接口必须允许浏览器 CORS；移动/重命名文件或清理浏览器数据前应先导出备份。
