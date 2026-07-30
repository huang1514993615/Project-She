import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "src", "character-motion.js"), "utf8");
const banner = `/* @project-she/character-motion v0.1.0 | generated file */\n`;
const iife = source
  .replace(/^export\s+(class|function|const)\s+/gm, "$1 ")
  .concat(`
globalThis.CharacterMotion = {
  CharacterMotionPlayer,
  createDemoManifest,
  normalizeVisualSequence,
  parseTaggedReply,
  validateManifest
};
`);

await mkdir(path.join(root, "dist"), { recursive: true });
await Promise.all([
  writeFile(path.join(root, "dist", "character-motion.esm.js"), banner + source, "utf8"),
  writeFile(
    path.join(root, "dist", "character-motion.iife.js"),
    `${banner}(function (globalThis) {\n"use strict";\n${iife}\n})(globalThis);\n`,
    "utf8",
  ),
]);

console.log("Built dist/character-motion.esm.js and dist/character-motion.iife.js");
