/**
 * 开发用 App 内置页静态拉取服务。
 * 服务 uniapp/hybrid/html/（含最新的 night-mailbox-app.html），并暴露
 * /app-update/manifest.json 供 App 端校验版本、SHA-256 与字节数后拉取。
 * 仅本地开发使用，不是产品服务器。Node.js 只用于构建与开发，不进发行包。
 *
 * 用法：node scripts/serve-app-html.mjs [--port 3000] [--host 0.0.0.0]
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "uniapp", "hybrid", "html");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 3000;
const host = args[args.indexOf("--host") + 1] || "0.0.0.0";
const HTML_FILE = "night-mailbox-app.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function htmlManifest() {
  const filePath = join(root, HTML_FILE);
  const [content, info] = await Promise.all([readFile(filePath), stat(filePath)]);
  const sha256 = createHash("sha256").update(content).digest("hex");
  return {
    format: "night-mailbox-app-update",
    version: `night-mailbox-${new Date(info.mtimeMs).toISOString().replace(/[:.]/g, "-")}`,
    path: `/${HTML_FILE}`,
    sha256,
    byteSize: info.size,
    updatedAt: new Date(info.mtimeMs).toISOString(),
  };
}

async function sendHtml(res, filePath) {
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  try {
    if (urlPath === "/app-update/manifest.json") {
      const manifest = await htmlManifest();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(manifest));
      return;
    }
    if (urlPath === "/" || urlPath === "/index.html" || urlPath === `/${HTML_FILE}`) {
      await sendHtml(res, join(root, HTML_FILE));
      return;
    }
    const target = normalize(join(root, urlPath));
    if (!target.startsWith(normalize(root) + sep) && target !== normalize(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": MIME[extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not Found");
  }
}).listen(port, host, () => {
  console.log(`App HTML server: http://${host}:${port}/  (manifest: /app-update/manifest.json)`);
});
