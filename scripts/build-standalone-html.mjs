import path from "node:path";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const buildDirectory = path.join(projectDirectory, "standalone", ".build");
const outputDirectory = path.join(projectDirectory, "standalone");
const outputFile = path.join(outputDirectory, "night-mailbox.html");
const appUpdateOutputDirectory = path.join(projectDirectory, "outputs");
const appUpdateOutputFile = path.join(appUpdateOutputDirectory, "night-mailbox-app-update.html");
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
const [javascript, stylesheet, avatar] = await Promise.all([
  readFile(resolveAsset(scriptMatch[1]), "utf8"),
  readFile(resolveAsset(styleMatch[1]), "utf8"),
  readFile(path.join(projectDirectory, "public", "og.png")),
]);

const bootstrap = [
  "window.__NIGHT_MAILBOX_STANDALONE__=true;",
  `window.__NIGHT_MAILBOX_DEFAULT_AVATAR__="data:image/png;base64,${avatar.toString("base64")}";`,
].join("");

html = html
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
await mkdir(appUpdateOutputDirectory, { recursive: true });
await mkdir(path.dirname(appBundledOutputFile), { recursive: true });
await Promise.all([
  writeFile(appUpdateOutputFile, appHtml, "utf8"),
  writeFile(appBundledOutputFile, appHtml, "utf8"),
]);
await rm(buildDirectory, { recursive: true, force: true });

console.log(`Standalone HTML created: ${outputFile}`);
console.log(`App update HTML created: ${appUpdateOutputFile}`);
console.log(`Bundled App HTML created: ${appBundledOutputFile}`);
