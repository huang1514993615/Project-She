/* @project-she/character-motion v0.1.0 | generated file */
const STYLE_ID = "character-motion-default-styles";
const CHANNELS = ["base", "hairBack", "body", "arms", "face", "eyes", "mouth", "hairFront", "accessory", "effect"];
const Z_INDEX = {
  hairBack: 10,
  base: 20,
  body: 30,
  arms: 40,
  face: 50,
  eyes: 60,
  mouth: 70,
  hairFront: 80,
  accessory: 90,
  effect: 100,
};
const DEFAULT_FRAME = {
  state: "neutral",
  emotion: "neutral",
  action: "idle",
  gaze: "user",
  intensity: 0.45,
  durationMs: 1200,
};

const ENGINE_CSS = `
.cm-root{position:relative;display:grid;place-items:center;width:100%;height:100%;min-height:320px;overflow:hidden;isolation:isolate;background:var(--cm-background,#fff);touch-action:manipulation}
.cm-character{--cm-intensity:.45;position:relative;width:min(86%,var(--cm-width,520px));aspect-ratio:var(--cm-aspect,2/3);transform-origin:50% 86%;animation:cm-breathe calc(4.8s - var(--cm-intensity)*1.2s) ease-in-out infinite;will-change:transform}
.cm-layer{position:absolute;inset:0;pointer-events:none}
.cm-layer img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;opacity:0;transition:opacity var(--cm-fade,320ms) ease,transform var(--cm-fade,320ms) ease;will-change:opacity,transform}
.cm-layer img.cm-active{opacity:1}
.cm-layer[data-channel="hairBack"] img,.cm-layer[data-channel="hairFront"] img{animation:cm-hair 4.2s ease-in-out infinite;transform-origin:50% 20%}
.cm-layer[data-channel="accessory"] img{animation:cm-accessory 3.6s ease-in-out infinite;transform-origin:50% 35%}
.cm-placeholder{position:absolute;inset:5% 12% 0;filter:drop-shadow(0 18px 24px rgba(50,36,55,.16));transition:transform 420ms cubic-bezier(.2,.8,.2,1)}
.cm-placeholder-head{position:absolute;z-index:30;left:50%;top:9%;width:35%;aspect-ratio:.84;translate:-50% 0;border-radius:47% 47% 44% 44%;background:linear-gradient(145deg,#ffe4db,#f8c8bd);box-shadow:inset -10px -8px 18px rgba(154,91,99,.08)}
.cm-placeholder-hair{position:absolute;z-index:20;left:50%;top:3%;width:48%;height:56%;translate:-50% 0;border-radius:48% 48% 38% 38%;background:linear-gradient(160deg,#433348,#1e1925);transform-origin:50% 16%;animation:cm-hair 4.2s ease-in-out infinite}
.cm-placeholder-body{position:absolute;z-index:10;left:50%;bottom:0;width:54%;height:64%;translate:-50% 0;border-radius:42% 42% 12% 12%;background:linear-gradient(160deg,#df9fb0,#8f5b81);transform-origin:50% 100%}
.cm-placeholder-eye{position:absolute;z-index:40;top:26%;width:8%;height:3.2%;border-radius:999px;background:#3a283c;transition:all 180ms ease}
.cm-placeholder-eye.left{left:38%}.cm-placeholder-eye.right{right:38%}
.cm-placeholder-mouth{position:absolute;z-index:40;left:50%;top:37%;width:9%;height:2%;translate:-50% 0;border-bottom:3px solid #9f5362;border-radius:0 0 999px 999px;transition:all 220ms ease}
.cm-placeholder-arm{position:absolute;z-index:15;top:43%;width:15%;height:48%;border-radius:999px;background:#d895a9;transform-origin:50% 10%;transition:transform 520ms cubic-bezier(.2,.8,.2,1)}
.cm-placeholder-arm.left{left:20%;rotate:8deg}.cm-placeholder-arm.right{right:20%;rotate:-8deg}
.cm-character[data-emotion="happy"] .cm-placeholder-mouth{height:5%;width:12%;border-width:0 0 4px}
.cm-character[data-emotion="sad"] .cm-placeholder-mouth{top:39%;border-radius:999px 999px 0 0;border-width:3px 0 0}
.cm-character[data-emotion="sad"] .cm-placeholder-eye{rotate:8deg}
.cm-character[data-emotion="angry"] .cm-placeholder-eye.left{rotate:12deg}.cm-character[data-emotion="angry"] .cm-placeholder-eye.right{rotate:-12deg}
.cm-character[data-emotion="surprised"] .cm-placeholder-eye{height:5%;border-radius:50%}
.cm-character[data-emotion="surprised"] .cm-placeholder-mouth{height:6%;width:6%;border:3px solid #9f5362;border-radius:50%}
.cm-character[data-action="wave"] .cm-placeholder-arm.right{transform:rotate(-132deg) translateY(-6%)}
.cm-character[data-action="arms_crossed"] .cm-placeholder-arm.left{transform:rotate(-68deg) translate(16%,8%)}.cm-character[data-action="arms_crossed"] .cm-placeholder-arm.right{transform:rotate(68deg) translate(-16%,8%)}
.cm-character[data-action="reach"] .cm-placeholder-arm.right,.cm-character[data-action="hold_hands"] .cm-placeholder-arm.right{transform:rotate(52deg) translateY(-4%)}
.cm-character[data-action="cast_spell"] .cm-placeholder-arm.left{transform:rotate(-102deg)}.cm-character[data-action="cast_spell"] .cm-placeholder-arm.right{transform:rotate(102deg)}
.cm-character[data-action="hide"] .cm-placeholder{transform:translateY(3%) scale(.96)}
.cm-character[data-gaze="left"] .cm-placeholder-eye{translate:-14% 0}.cm-character[data-gaze="right"] .cm-placeholder-eye{translate:14% 0}
.cm-character.cm-blink .cm-placeholder-eye{height:2px;top:28%}
.cm-character.cm-speaking .cm-placeholder-mouth{animation:cm-talk .34s ease-in-out infinite alternate}
.cm-character.cm-react{animation:cm-react .48s cubic-bezier(.18,.85,.22,1),cm-breathe calc(4.8s - var(--cm-intensity)*1.2s) ease-in-out .48s infinite}
.cm-reduced-motion .cm-character,.cm-reduced-motion .cm-layer img,.cm-reduced-motion .cm-placeholder-hair{animation:none!important;transition-duration:0ms!important}
@keyframes cm-breathe{0%,100%{transform:translateY(0) scale(1)}45%{transform:translateY(calc(-2px - var(--cm-intensity)*3px)) scaleX(calc(1 + var(--cm-intensity)*.006)) scaleY(calc(1 + var(--cm-intensity)*.014))}}
@keyframes cm-hair{0%,100%{transform:rotate(-.35deg) translateX(-.2%)}50%{transform:rotate(.45deg) translateX(.35%)}}
@keyframes cm-accessory{0%,100%{transform:rotate(-.5deg)}50%{transform:rotate(.7deg)}}
@keyframes cm-talk{from{transform:scaleY(.65)}to{transform:scaleY(1.2)}}
@keyframes cm-react{0%{transform:translateY(0) scale(1)}45%{transform:translateY(-7px) scale(1.012)}100%{transform:translateY(0) scale(1)}}
`;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanToken(value, fallback = "") {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64);
}

function frameFrom(value = {}) {
  return {
    state: cleanToken(value.state || value.preferredStateId, DEFAULT_FRAME.state),
    emotion: cleanToken(value.emotion, DEFAULT_FRAME.emotion),
    action: cleanToken(value.action, DEFAULT_FRAME.action),
    gaze: cleanToken(value.gaze, DEFAULT_FRAME.gaze),
    intensity: clamp(value.intensity, 0, 1, DEFAULT_FRAME.intensity),
    durationMs: clamp(value.durationMs, 400, 8000, DEFAULT_FRAME.durationMs),
  };
}

export function normalizeVisualSequence(visual = {}) {
  const raw = Array.isArray(visual.sequence) && visual.sequence.length
    ? visual.sequence
    : [visual];
  return raw.slice(0, 8).map(frameFrom);
}

export function parseTaggedReply(text = "") {
  const read = (name) => {
    const match = String(text).match(new RegExp(`\\[${name}:([^\\]]+)\\]`, "i"));
    return match?.[1]?.trim() || "";
  };
  return {
    emotion: cleanToken(read("Emotion"), "neutral"),
    action: cleanToken(read("Action"), "idle"),
    gaze: cleanToken(read("Gaze"), "user"),
    cleanText: String(text).replace(/\[(?:Emotion|Action|Gaze):[^\]]+\]\s*/gi, "").trim(),
  };
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") errors.push("manifest 必须是对象");
  if (!String(manifest?.id || "").trim()) errors.push("缺少角色 id");
  if (!String(manifest?.name || "").trim()) errors.push("缺少角色 name");
  if (manifest?.assets && typeof manifest.assets !== "object") errors.push("assets 必须是对象");
  if (manifest?.states && typeof manifest.states !== "object") errors.push("states 必须是对象");
  return { valid: errors.length === 0, errors };
}

export function createDemoManifest(overrides = {}) {
  return {
    id: "demo-character",
    name: "示例角色",
    canvas: { width: 1024, height: 1536 },
    assets: {},
    states: {
      neutral: { emotion: "neutral", action: "idle", gaze: "user" },
      happy: { emotion: "happy", action: "idle", gaze: "user" },
      sad: { emotion: "sad", action: "idle", gaze: "down" },
      surprised: { emotion: "surprised", action: "idle", gaze: "user" },
      wave: { emotion: "happy", action: "wave", gaze: "user" },
      guard: { emotion: "angry", action: "arms_crossed", gaze: "user" },
      magic: { emotion: "focused", action: "cast_spell", gaze: "user" },
    },
    motions: {
      comforted: [
        { state: "neutral", emotion: "neutral", action: "idle", durationMs: 850 },
        { state: "sad", emotion: "sad", action: "idle", gaze: "down", durationMs: 1250 },
        { state: "sad", emotion: "sad", action: "reach", gaze: "user", durationMs: 1050 },
        { state: "happy", emotion: "happy", action: "hold_hands", gaze: "user", durationMs: 1700 },
      ],
      greeting: [
        { state: "surprised", emotion: "surprised", action: "idle", durationMs: 650 },
        { state: "wave", emotion: "happy", action: "wave", durationMs: 1700 },
        { state: "happy", emotion: "happy", action: "idle", durationMs: 1200 },
      ],
    },
    ...overrides,
  };
}

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = ENGINE_CSS;
  document.head.append(style);
}

class LayerChannel {
  constructor(root, channel, fadeMs) {
    this.channel = channel;
    this.root = document.createElement("div");
    this.root.className = "cm-layer";
    this.root.dataset.channel = channel;
    this.root.style.zIndex = String(Z_INDEX[channel] || 1);
    this.root.style.setProperty("--cm-fade", `${fadeMs}ms`);
    this.slots = [new Image(), new Image()];
    this.slots.forEach((image) => {
      image.alt = "";
      image.decoding = "async";
      this.root.append(image);
    });
    this.active = 0;
    this.url = "";
    root.append(this.root);
  }

  async set(url) {
    const nextUrl = String(url || "");
    if (nextUrl === this.url) return;
    if (!nextUrl) {
      this.slots.forEach((image) => image.classList.remove("cm-active"));
      this.url = "";
      return;
    }
    const incoming = this.active === 0 ? 1 : 0;
    this.slots[incoming].src = nextUrl;
    try { await this.slots[incoming].decode?.(); } catch {}
    this.slots[incoming].classList.add("cm-active");
    this.slots[this.active].classList.remove("cm-active");
    this.active = incoming;
    this.url = nextUrl;
  }

  destroy() {
    this.slots.forEach((image) => { image.src = ""; });
    this.root.remove();
  }
}

export class CharacterMotionPlayer extends EventTarget {
  constructor(container, manifest, options = {}) {
    super();
    const target = typeof container === "string" ? document.querySelector(container) : container;
    if (!target) throw new Error("CharacterMotionPlayer 找不到挂载容器");
    const validation = validateManifest(manifest);
    if (!validation.valid) throw new Error(validation.errors.join("；"));
    injectStyles();
    this.container = target;
    this.manifest = manifest;
    this.options = {
      fadeMs: clamp(options.fadeMs, 80, 1200, 320),
      blinkMinMs: clamp(options.blinkMinMs, 1200, 12000, 2600),
      blinkMaxMs: clamp(options.blinkMaxMs, 1600, 18000, 5800),
      reducedMotion: options.reducedMotion === true
        || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    };
    this.root = document.createElement("div");
    this.root.className = `cm-root${this.options.reducedMotion ? " cm-reduced-motion" : ""}`;
    this.character = document.createElement("div");
    this.character.className = "cm-character";
    const canvas = manifest.canvas || {};
    this.character.style.setProperty("--cm-aspect", `${canvas.width || 1024}/${canvas.height || 1536}`);
    this.root.append(this.character);
    target.replaceChildren(this.root);
    this.layers = Object.fromEntries(CHANNELS.map((channel) => [
      channel,
      new LayerChannel(this.character, channel, this.options.fadeMs),
    ]));
    this.placeholder = this.createPlaceholder();
    this.character.append(this.placeholder);
    this.current = { ...DEFAULT_FRAME };
    this.sequenceToken = 0;
    this.sequenceTimer = null;
    this.blinkTimer = null;
    this.speechTimer = null;
    this.destroyed = false;
    this.applyFrame(this.current, { react: false });
    this.scheduleBlink();
  }

  createPlaceholder() {
    const placeholder = document.createElement("div");
    placeholder.className = "cm-placeholder";
    placeholder.innerHTML = `
      <i class="cm-placeholder-hair"></i>
      <i class="cm-placeholder-body"></i>
      <i class="cm-placeholder-arm left"></i>
      <i class="cm-placeholder-arm right"></i>
      <i class="cm-placeholder-head"></i>
      <i class="cm-placeholder-eye left"></i>
      <i class="cm-placeholder-eye right"></i>
      <i class="cm-placeholder-mouth"></i>`;
    return placeholder;
  }

  resolveState(frame) {
    const state = this.manifest.states?.[frame.state] || {};
    return { ...frame, ...state, emotion: frame.emotion || state.emotion, action: frame.action || state.action };
  }

  resolveAssets(frame) {
    const assets = this.manifest.assets || {};
    const stateAssets = this.manifest.states?.[frame.state]?.assets || {};
    return Object.fromEntries(CHANNELS.map((channel) => {
      const collection = assets[channel];
      const key = channel === "eyes"
        ? frame.emotion
        : channel === "mouth"
          ? frame.emotion
          : channel === "arms"
            ? frame.action
            : frame.state;
      const url = stateAssets[channel]
        || (collection && typeof collection === "object" ? collection[key] || collection.default : collection)
        || "";
      return [channel, url];
    }));
  }

  async applyFrame(value, options = {}) {
    if (this.destroyed) return;
    const frame = this.resolveState(frameFrom(value));
    this.current = frame;
    this.character.dataset.state = frame.state;
    this.character.dataset.emotion = frame.emotion;
    this.character.dataset.action = frame.action;
    this.character.dataset.gaze = frame.gaze;
    this.character.style.setProperty("--cm-intensity", String(frame.intensity));
    const assets = this.resolveAssets(frame);
    const hasAssets = Object.values(assets).some(Boolean);
    this.placeholder.hidden = hasAssets;
    await Promise.all(Object.entries(assets).map(([channel, url]) => this.layers[channel].set(url)));
    if (options.react !== false && !this.options.reducedMotion) {
      this.character.classList.remove("cm-react");
      void this.character.offsetWidth;
      this.character.classList.add("cm-react");
    }
    this.dispatchEvent(new CustomEvent("framechange", { detail: frame }));
  }

  async play(sequence, options = {}) {
    const frames = Array.isArray(sequence)
      ? sequence.slice(0, 8).map(frameFrom)
      : normalizeVisualSequence(sequence);
    if (!frames.length) return;
    this.stop();
    const token = ++this.sequenceToken;
    const loop = options.loop === true;
    do {
      for (const frame of frames) {
        if (this.destroyed || token !== this.sequenceToken) return;
        await this.applyFrame(frame);
        await new Promise((resolve) => {
          this.sequenceTimer = globalThis.setTimeout(resolve, frame.durationMs);
        });
      }
    } while (loop && token === this.sequenceToken && !this.destroyed);
    this.dispatchEvent(new CustomEvent("sequenceend", { detail: { frames } }));
  }

  playMotion(name, options = {}) {
    const motion = this.manifest.motions?.[name];
    if (!Array.isArray(motion)) throw new Error(`未找到动作时间线：${name}`);
    return this.play(motion, options);
  }

  playVisual(visual) {
    return this.play(normalizeVisualSequence(visual));
  }

  setExpression(emotion, intensity = this.current.intensity) {
    return this.applyFrame({ ...this.current, emotion, intensity });
  }

  setAction(action, intensity = this.current.intensity) {
    return this.applyFrame({ ...this.current, action, intensity });
  }

  setGaze(gaze) {
    return this.applyFrame({ ...this.current, gaze }, { react: false });
  }

  speak(active = true) {
    globalThis.clearTimeout(this.speechTimer);
    this.character.classList.toggle("cm-speaking", Boolean(active));
    if (active) this.speechTimer = globalThis.setTimeout(() => this.speak(false), 5000);
  }

  scheduleBlink() {
    globalThis.clearTimeout(this.blinkTimer);
    if (this.destroyed || this.options.reducedMotion) return;
    const delay = this.options.blinkMinMs
      + Math.random() * Math.max(0, this.options.blinkMaxMs - this.options.blinkMinMs);
    this.blinkTimer = globalThis.setTimeout(() => {
      this.character.classList.add("cm-blink");
      globalThis.setTimeout(() => this.character?.classList.remove("cm-blink"), 130);
      this.scheduleBlink();
    }, delay);
  }

  setBackground(value) {
    this.root.style.setProperty("--cm-background", String(value || "#fff"));
  }

  stop() {
    this.sequenceToken += 1;
    globalThis.clearTimeout(this.sequenceTimer);
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    globalThis.clearTimeout(this.blinkTimer);
    globalThis.clearTimeout(this.speechTimer);
    Object.values(this.layers).forEach((layer) => layer.destroy());
    this.root.remove();
  }
}
