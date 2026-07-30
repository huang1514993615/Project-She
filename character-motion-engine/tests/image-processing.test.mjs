import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateContainRect,
  chromaAlpha,
  parseHexColor,
  removeChromaFromPixels,
} from "../src/image-processing.js";

test("fits the uploaded portrait inside a 1024x1536 canvas without stretching", () => {
  const rect = calculateContainRect(864, 1821, 1024, 1536);
  assert.equal(rect.height, 1536);
  assert.ok(Math.abs(rect.width - 728.78) < 0.1);
  assert.ok(Math.abs(rect.x - 147.61) < 0.1);
  assert.equal(rect.y, 0);
});

test("parses chroma color and feathers pixels by color distance", () => {
  assert.deepEqual(parseHexColor("#00FF00"), [0, 255, 0]);
  assert.equal(chromaAlpha(0, 255, 0, [0, 255, 0], 42, 96), 0);
  assert.equal(chromaAlpha(100, 30, 100, [0, 255, 0], 42, 96), 1);
});

test("removes green pixels while preserving purple character pixels", () => {
  const pixels = new Uint8ClampedArray([
    0, 255, 0, 255,
    86, 35, 104, 255,
    30, 120, 42, 255,
  ]);
  const result = removeChromaFromPixels(pixels, {
    color: "#00FF00",
    threshold: 42,
    softness: 96,
  });
  assert.equal(result.transparentPixels, 1);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 255);
  assert.ok(pixels[9] < 80, "green spill on opaque hair edges should be reduced");
});
