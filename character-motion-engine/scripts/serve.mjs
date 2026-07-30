import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioImageJobs } from "../server/studio-image-jobs.mjs";
import { createStudioStore } from "../server/studio-store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 4174;
const workspaceRoot = path.join(root, "workspace");
const studioStore = createStudioStore({ rootDir: workspaceRoot });
const studioImageJobs = await createStudioImageJobs({
  workspaceRoot,
  projectRoot: root,
  studioStore,
});
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
};

function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request, maxBytes = 36 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleStudioApi(request, response, pathname) {
  if (pathname === "/api/studio/image-status" && request.method === "GET") {
    json(response, 200, studioImageJobs.getStatus());
    return true;
  }
  if (pathname === "/api/studio/projects" && request.method === "GET") {
    json(response, 200, { projects: await studioStore.listProjects() });
    return true;
  }
  if (pathname === "/api/studio/projects" && request.method === "POST") {
    json(response, 201, { project: await studioStore.createProject(await readJsonBody(request)) });
    return true;
  }
  if (pathname === "/api/studio/import" && request.method === "POST") {
    json(response, 201, { project: await studioStore.importProject(await readJsonBody(request)) });
    return true;
  }
  const assetDeleteMatch = /^\/api\/studio\/projects\/([a-z0-9-]+)\/assets\/(asset-[a-z0-9-]+)$/i.exec(pathname);
  if (assetDeleteMatch && request.method === "DELETE") {
    const result = await studioStore.deleteAsset(assetDeleteMatch[1], assetDeleteMatch[2]);
    json(response, result ? 200 : 404, result || { error: "没有找到该角色项目" });
    return true;
  }
  const jobsMatch = /^\/api\/studio\/projects\/([a-z0-9-]+)\/image-jobs$/i.exec(pathname);
  if (jobsMatch && request.method === "GET") {
    json(response, 200, { jobs: studioImageJobs.listJobs(jobsMatch[1]) });
    return true;
  }
  if (jobsMatch && request.method === "POST") {
    const job = await studioImageJobs.createJob(jobsMatch[1], await readJsonBody(request, 128 * 1024));
    json(response, job ? 202 : 404, job ? { job } : { error: "没有找到该角色项目" });
    return true;
  }
  const projectMatch = /^\/api\/studio\/projects\/([a-z0-9-]+)(?:\/(assets|export))?$/i.exec(pathname);
  if (!projectMatch) return false;
  const [, id, operation] = projectMatch;
  if (!operation && request.method === "GET") {
    const project = await studioStore.getProject(id);
    json(response, project ? 200 : 404, project ? { project } : { error: "没有找到该角色项目" });
    return true;
  }
  if (!operation && request.method === "PUT") {
    const project = await studioStore.updateProject(id, await readJsonBody(request));
    json(response, project ? 200 : 404, project ? { project } : { error: "没有找到该角色项目" });
    return true;
  }
  if (!operation && request.method === "DELETE") {
    if (studioImageJobs.hasActiveJob(id)) {
      throw new Error("该角色仍有图片正在生成，请等待任务完成后再删除项目");
    }
    const result = await studioStore.deleteProject(id);
    json(response, result ? 200 : 404, result || { error: "没有找到该角色项目" });
    return true;
  }
  if (operation === "assets" && request.method === "POST") {
    const result = await studioStore.addAsset(id, await readJsonBody(request));
    json(response, result ? 201 : 404, result || { error: "没有找到该角色项目" });
    return true;
  }
  if (operation === "export" && request.method === "GET") {
    const bundle = await studioStore.exportProject(id);
    json(response, bundle ? 200 : 404, bundle || { error: "没有找到该角色项目" });
    return true;
  }
  return false;
}

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  try {
    if (pathname.startsWith("/api/studio/") && await handleStudioApi(request, response, pathname)) return;
    if (pathname.startsWith("/studio-assets/")) {
      const match = /^\/studio-assets\/([a-z0-9-]+)\/(reference|processed|poses|expressions|layers)\/([^/]+)$/i.exec(pathname);
      const asset = match ? studioStore.resolveAsset(match[1], match[2], match[3]) : null;
      if (!asset || !existsSync(asset) || !statSync(asset).isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[path.extname(asset)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      createReadStream(asset).pipe(response);
      return;
    }
  } catch (error) {
    json(response, 400, { error: error?.message || "工作台请求失败" });
    return;
  }
  if (pathname === "/") {
    response.writeHead(302, { Location: "/studio/" });
    response.end();
    return;
  }
  const requested = pathname === "/demo/"
    ? "/demo/index.html"
    : pathname === "/studio/" || pathname === "/studio"
      ? "/studio/index.html"
      : pathname;
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": types[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Character Motion demo: http://127.0.0.1:${port}/`);
});
