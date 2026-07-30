# 角色素材工作台

本地入口：`http://127.0.0.1:4174/studio/`

动画实验室：`http://127.0.0.1:4174/demo/`

第一阶段用于冻结角色身份和基准画布，不会调用付费生图接口。

## 当前能力

- 新建多个角色项目并自动保存。
- 角色项目可删除；整个目录会移动到 `workspace/.trash-projects/`，不立即永久清除。存在运行中生图任务时禁止删除。
- 编辑角色定位、稳定外观和基准图提示词。
- 设置统一画布尺寸与抠图背景色。
- 上传 PNG、JPEG、WebP 基准图并本地预览。
- 导入、导出包含图片的单文件 JSON 角色素材包。
- 导入始终创建副本，不覆盖已有角色。
- 全部资料保存在本项目的 `workspace/`，不使用数据库。

## 本地文件结构

```text
workspace/
└─ role-<uuid>/
   ├─ character.json
   ├─ reference/
   ├─ processed/
   ├─ poses/
   ├─ expressions/
   └─ layers/
```

`workspace/` 是用户素材目录。更新代码时不得覆盖或清空。

## 本地接口

```text
GET  /api/studio/projects
POST /api/studio/projects
GET  /api/studio/projects/:id
PUT  /api/studio/projects/:id
POST /api/studio/projects/:id/assets
GET  /api/studio/projects/:id/export
POST /api/studio/import
```

项目 JSON 使用临时文件加重命名的方式写入。图片上传限制为 24MB，支持 PNG、JPEG 和 WebP。

## 第二阶段：基准图处理

工作台现在支持：

- 按目标画布等比缩放基准图，不裁切、不拉伸人物。
- 空余区域自动使用角色设置中的绿幕颜色补齐。
- 调节绿幕识别范围和边缘柔化。
- 自动降低半透明边缘的绿色溢色。
- 输出透明 PNG 到 `processed/`，保留原始上传图片。
- 规范绿幕图和透明图分别标记为 `normalized` 与 `transparent`。
- 重复点击“规范画布”或“自动抠图”时，同类型旧结果会移动到角色 `.trash/`，素材区只保留最新结果，避免不断堆积重复图片。

## 后续任务

第三阶段已经加入：

- 独立的去绿强度，清理仍然不透明的发丝绿色溢色。
- 素材缩略图展示素材类型。
- 删除当前素材；文件移入角色 `.trash/`，不立即永久清除。
- GPT Image 2 `/images/edits` 后台任务队列。
- 队列全局同时只允许一张，避免误操作堆积付费任务。
- 每次生成前二次确认，默认提供挥手、伸手、开心和闭眼四个可编辑提示词。
- 页面关闭后 Node 任务继续执行，完成后保存到 `poses/` 或 `expressions/`。
- 第一步素材区只展示 `reference/processed`；第二步独立展示 `poses/expressions`，动作图不再与基准图和抠图结果混排。
- 服务在运行任务中重启时不会自动重试，避免重复扣费。
- 单次接口超时为10分钟。

后续任务：

1. 增加处理前后叠加对比和蒙版画笔修边。
2. 验证四张最小素材的一致性。
3. 再进入动作、表情、分层和锚点阶段。
