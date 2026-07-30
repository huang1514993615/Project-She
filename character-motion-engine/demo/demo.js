import {
  CharacterMotionPlayer,
  createDemoManifest,
} from "../src/character-motion.js";

const manifest = createDemoManifest({
  name: "月影 · 动态原型",
  canvas: { width: 864, height: 1821 },
  assets: {
    base: {
      default: "../assets/character/transparent/violet-neutral.png",
      neutral: "../assets/character/transparent/violet-neutral.png",
      surprised: "../assets/character/transparent/violet-neutral.png",
      happy: "../assets/character/transparent/violet-wave.png",
      wave: "../assets/character/transparent/violet-wave.png",
      sad: "../assets/character/transparent/violet-reach.png",
      guard: "../assets/character/transparent/violet-neutral.png",
      magic: "../assets/character/transparent/violet-magic.png",
    },
  },
});
const player = new CharacterMotionPlayer("#characterStage", manifest, {
  fadeMs: 320,
});
const stateLabel = document.querySelector("#currentState");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const visualInput = document.querySelector("#visualInput");

const guardSequence = {
  sequence: [
    { preferredStateId: "neutral", emotion: "neutral", action: "idle", durationMs: 800 },
    { preferredStateId: "guard", emotion: "angry", action: "arms_crossed", gaze: "left", intensity: 0.72, durationMs: 1000 },
    { preferredStateId: "magic", emotion: "surprised", action: "cast_spell", gaze: "user", intensity: 0.9, durationMs: 1600 },
    { preferredStateId: "happy", emotion: "happy", action: "idle", intensity: 0.4, durationMs: 1400 },
  ],
};
visualInput.value = JSON.stringify(guardSequence, null, 2);

player.addEventListener("framechange", ({ detail }) => {
  stateLabel.textContent = `${detail.emotion} · ${detail.action} · ${detail.gaze}`;
  statusText.textContent = "正在表演";
  statusDot.classList.add("active");
});
player.addEventListener("sequenceend", () => {
  statusText.textContent = "动作完成";
  statusDot.classList.remove("active");
});

document.querySelectorAll("[data-motion]").forEach((button) => {
  button.addEventListener("click", () => player.playMotion(button.dataset.motion));
});
document.querySelector("[data-sequence='guard']").addEventListener("click", () => player.playVisual(guardSequence));
document.querySelector("#emotionSelect").addEventListener("change", (event) => player.setExpression(event.target.value));
document.querySelector("#actionSelect").addEventListener("change", (event) => player.setAction(event.target.value));
document.querySelector("#gazeSelect").addEventListener("change", (event) => player.setGaze(event.target.value));
document.querySelector("#speakButton").addEventListener("click", () => player.speak(true));
document.querySelector("#playJsonButton").addEventListener("click", () => {
  try {
    player.playVisual(JSON.parse(visualInput.value));
  } catch (error) {
    statusText.textContent = `JSON 错误：${error.message}`;
    statusDot.classList.remove("active");
  }
});
