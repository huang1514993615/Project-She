import path from "node:path";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const buildDirectory = path.join(projectDirectory, "standalone", ".build");
const outputDirectory = path.join(projectDirectory, "standalone");
const outputFile = path.join(outputDirectory, "night-mailbox.html");
const appBundledOutputFile = path.join(projectDirectory, "uniapp", "hybrid", "html", "night-mailbox-app.html");

await build({
  configFile: path.join(projectDirectory, "vite.standalone.config.js"),
});

let html = await readFile(path.join(buildDirectory, "index.html"), "utf8");
const scriptMatch = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/i);
const styleMatch = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/i);

if (!scriptMatch || !styleMatch) {
  throw new Error("无法定位独立版构建资源");
}

const resolveAsset = (value) => path.resolve(buildDirectory, value.replace(/^\.\//, ""));
const coreAvatarFiles = {
  "woman-coral": "companion-woman-coral.jpg",
  "woman-mist": "companion-woman-mist.jpg",
  "man-sage": "companion-man-sage.jpg",
  "man-night": "companion-man-night.jpg",
  "neutral-coast": "companion-neutral-coast.jpg",
};

const [javascript, stylesheet, faviconSvg, ...coreAvatarBuffers] = await Promise.all([
  readFile(resolveAsset(scriptMatch[1]), "utf8"),
  readFile(resolveAsset(styleMatch[1]), "utf8"),
  readFile(path.join(projectDirectory, "public", "favicon.svg"), "utf8"),
  ...Object.values(coreAvatarFiles).map((filename) =>
    readFile(path.join(projectDirectory, "public", "avatars", filename))
  ),
]);

const coreAvatarData = Object.fromEntries(
  Object.keys(coreAvatarFiles).map((id, index) => [
    id,
    `data:image/jpeg;base64,${coreAvatarBuffers[index].toString("base64")}`,
  ]),
);
const faviconDataUrl = `data:image/svg+xml;base64,${Buffer.from(faviconSvg).toString("base64")}`;

const bootstrap = [
  "window.__NIGHT_MAILBOX_STANDALONE__=true;",
  `window.__NIGHT_MAILBOX_CORE_AVATARS__=${JSON.stringify(coreAvatarData)};`,
  `window.__NIGHT_MAILBOX_DEFAULT_AVATAR__=${JSON.stringify(coreAvatarData["neutral-coast"])};`,
].join("");

html = html
  .replace(/<link rel="icon"[^>]*>/i, `<link rel="icon" href="${faviconDataUrl}">`)
  .replace(
    styleMatch[0],
    () => `<style>${stylesheet.replace(/<\/style/gi, "<\\/style")}</style>`,
  )
  .replace(
    scriptMatch[0],
    () => `<script>${bootstrap}</script><script type="module">${javascript.replace(/<\/script/gi, "<\\/script")}</script>`,
  );

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, html, "utf8");
const appHtml = html.replace(
  "window.__NIGHT_MAILBOX_STANDALONE__=true;",
  "window.__NIGHT_MAILBOX_STANDALONE__=true;window.__NIGHT_MAILBOX_APP_SHELL__=true;",
);
await mkdir(path.dirname(appBundledOutputFile), { recursive: true });
await writeFile(appBundledOutputFile, appHtml, "utf8");
await rm(buildDirectory, { recursive: true, force: true });

console.log(`Standalone HTML created: ${outputFile}`);
console.log(`Bundled App HTML created: ${appBundledOutputFile}`);
