import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemoManifest,
  normalizeVisualSequence,
  parseTaggedReply,
  validateManifest,
} from "../src/character-motion.js";

test("normalizes a multi-stage AI visual timeline", () => {
  const frames = normalizeVisualSequence({
    sequence: [
      { preferredStateId: "idle_neutral", emotion: "neutral", durationMs: 100 },
      { preferredStateId: "happy_wave", emotion: "happy", action: "wave", durationMs: 99999 },
    ],
  });
  assert.equal(frames.length, 2);
  assert.equal(frames[0].durationMs, 400);
  assert.equal(frames[1].durationMs, 8000);
  assert.equal(frames[1].action, "wave");
});

test("parses legacy emotion and action tags", () => {
  const parsed = parseTaggedReply("[Emotion:Happy][Action:Wave][Gaze:Left]你好");
  assert.deepEqual(
    { emotion: parsed.emotion, action: parsed.action, gaze: parsed.gaze, cleanText: parsed.cleanText },
    { emotion: "happy", action: "wave", gaze: "left", cleanText: "你好" },
  );
});

test("validates a character manifest", () => {
  assert.equal(validateManifest(createDemoManifest()).valid, true);
  assert.equal(validateManifest({}).valid, false);
});
