# Character Motion Engine

一个为普通 HTML、H5 和本地 App 壳设计的零依赖分层角色动画引擎。它把角色表现拆为持续微动作、独立表情/动作通道和 AI 时间线，避免整张立绘硬切。

## 当前能力

- 自动呼吸、随机眨眼、头发和饰品微摆。
- 表情、动作、视线独立组合。
- 1–8 段动作时间线，支持起势、主动作和收势。
- 分层图片双缓冲淡入，缺少素材时使用程序化占位角色。
- 支持模型 `visual.sequence` JSON 和旧式 `[Emotion:][Action:]` 标签。
- 零运行时依赖，同时输出 ESM 和可直接用 `<script>` 引入的 IIFE 包。
- 尊重系统“减少动态效果”设置。

## 内置演示素材

`assets/character/transparent/` 包含一套由同一基底图派生并完成透明背景处理的角色动作图：

- `violet-neutral.png`：自然站立。
- `violet-wave.png`：开心挥手。
- `violet-reach.png`：伤心后伸手寻求安慰。
- `violet-magic.png`：双手施法准备姿势。

`assets/character/source/` 保留对应的绿色键色源图，便于后续重新抠图。演示版暂时把完整人物图放在 `base` 状态通道中，因此已经能看到真实人物随时间线切换和持续呼吸；下一阶段再将眼睛、嘴型、头发和手臂拆成真正的独立透明图层。

## 快速开始

```bash
npm run build
```

直接在普通 HTML 中使用：

```html
<div id="character" style="width:420px;height:640px"></div>
<script src="./dist/character-motion.iife.js"></script>
<script>
  const manifest = CharacterMotion.createDemoManifest({
    id: "wanwan",
    name: "晚晚"
  });
  const player = new CharacterMotion.CharacterMotionPlayer("#character", manifest);

  player.playVisual({
    sequence: [
      { emotion: "neutral", action: "idle", durationMs: 800 },
      { emotion: "sad", action: "reach", durationMs: 1200 },
      { emotion: "happy", action: "hold_hands", durationMs: 1600 }
    ]
  });
</script>
```

ESM：

```js
import { CharacterMotionPlayer } from "./dist/character-motion.esm.js";
```

## 素材清单

每个角色使用一个 manifest。所有透明图应采用相同画布、人物位置、缩放和脚底基线。

```js
const manifest = {
  id: "wanwan",
  name: "晚晚",
  canvas: { width: 1024, height: 1536 },
  assets: {
    hairBack: "/wanwan/hair-back.webp",
    body: "/wanwan/body.webp",
    eyes: {
      default: "/wanwan/eyes-neutral.webp",
      happy: "/wanwan/eyes-happy.webp",
      sad: "/wanwan/eyes-sad.webp"
    },
    mouth: {
      default: "/wanwan/mouth-neutral.webp",
      happy: "/wanwan/mouth-smile.webp"
    },
    arms: {
      default: "/wanwan/arms-idle.webp",
      wave: "/wanwan/arms-wave.webp",
      hold_hands: "/wanwan/arms-hold-hands.webp"
    },
    hairFront: "/wanwan/hair-front.webp",
    accessory: "/wanwan/accessory.webp"
  },
  states: {
    neutral: { emotion: "neutral", action: "idle", gaze: "user" },
    greeting: { emotion: "happy", action: "wave", gaze: "user" }
  }
};
```

推荐 WebP 透明图；每层只保留该部位，避免不同图片重复覆盖整个人物。

## 与夜航信箱的后续接入点

现有多人回复已经保存 `visual.sequence`，可以直接交给：

```js
player.playVisual(message.visual);
```

角色切换时销毁旧播放器或切换 manifest；背景继续由夜航信箱独立管理。第一阶段可保留原整张动作图作为 `base`，以后逐步替换眼睛、嘴型、手臂等分层资源。
