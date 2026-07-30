import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const SCHEMA = "character-motion-studio";
const VERSION = 1;
const IMAGE_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);
const ASSET_GROUPS = ["reference", "processed", "poses", "expressions", "layers"];
const DEFAULT_PROMPT = `一位成年女性角色，正面全身角色设定图，自然站立，轻微 A-Pose，双臂与身体之间保留清晰间隙，双手和双脚完整可见。人物居中，身体正对镜头，镜头高度固定，人物比例自然。

稳定外观：请在这里填写角色的脸型、眼睛、头发、服装和发饰。

纯色高饱和绿色背景，背景颜色 #00FF00，背景平整均匀，没有阴影，没有地面反射，没有环境元素，没有文字。角色边缘清晰，均匀棚拍光线，高清细节，1024x1536 竖图。`;

function cleanText(value, maxLength = 20000) {
  return String(value ?? "").replace(/\0/g, "").slice(0, maxLength);
}

function safeId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9-]{7,80}$/i.test(id)) {
    throw new Error("无效的角色项目 ID");
  }
  return id;
}

function emptyAssets() {
  return Object.fromEntries(ASSET_GROUPS.map((group) => [group, []]));
}

function normalizeAsset(asset, group) {
  if (!asset || typeof asset !== "object") return null;
  const id = cleanText(asset.id, 100);
  const filename = path.basename(cleanText(asset.filename, 180));
  if (!id || !filename) return null;
  return {
    id,
    group,
    variant: cleanText(asset.variant, 40),
    name: cleanText(asset.name || filename, 180),
    filename,
    mimeType: IMAGE_TYPES.has(asset.mimeType) ? asset.mimeType : "image/png",
    size: Math.max(0, Number(asset.size) || 0),
    width: Math.max(0, Number(asset.width) || 0),
    height: Math.max(0, Number(asset.height) || 0),
    createdAt: cleanText(asset.createdAt, 80) || new Date().toISOString(),
    url: `/studio-assets/${cleanText(asset.projectId, 100)}/${group}/${encodeURIComponent(filename)}`,
  };
}

function normalizeProject(input, previous = null, { touch = true } = {}) {
  const now = new Date().toISOString();
  const id = safeId(previous?.id || input?.id || `role-${randomUUID()}`);
  const sourceAssets = input?.assets && typeof input.assets === "object" ? input.assets : {};
  const assets = emptyAssets();
  for (const group of ASSET_GROUPS) {
    const previousGroup = previous?.assets?.[group] || [];
    const requestedGroup = Array.isArray(sourceAssets[group]) ? sourceAssets[group] : previousGroup;
    assets[group] = requestedGroup
      .map((asset) => normalizeAsset({ ...asset, projectId: id }, group))
      .filter(Boolean)
      .slice(-120);
  }
  return {
    schema: SCHEMA,
    version: VERSION,
    id,
    name: cleanText(input?.name ?? previous?.name ?? "未命名角色", 80) || "未命名角色",
    summary: cleanText(input?.summary ?? previous?.summary ?? "", 500),
    appearance: cleanText(input?.appearance ?? previous?.appearance ?? ""),
    basePrompt: cleanText(input?.basePrompt ?? previous?.basePrompt ?? DEFAULT_PROMPT),
    canvas: {
      width: Math.max(512, Math.min(4096, Number(input?.canvas?.width ?? previous?.canvas?.width) || 1024)),
      height: Math.max(512, Math.min(4096, Number(input?.canvas?.height ?? previous?.canvas?.height) || 1536)),
      background: /^#[0-9a-f]{6}$/i.test(input?.canvas?.background ?? previous?.canvas?.background)
        ? String(input?.canvas?.background ?? previous?.canvas?.background).toUpperCase()
        : "#00FF00",
    },
    processing: {
      chromaColor: /^#[0-9a-f]{6}$/i.test(input?.processing?.chromaColor ?? previous?.processing?.chromaColor)
        ? String(input?.processing?.chromaColor ?? previous?.processing?.chromaColor).toUpperCase()
        : "#00FF00",
      threshold: Math.max(0, Math.min(255, Number(input?.processing?.threshold ?? previous?.processing?.threshold) || 42)),
      softness: Math.max(1, Math.min(255, Number(input?.processing?.softness ?? previous?.processing?.softness) || 96)),
      despill: Math.max(0, Math.min(1, Number(input?.processing?.despill ?? previous?.processing?.despill) || 0.9)),
    },
    status: cleanText(input?.status ?? previous?.status ?? "draft", 40) || "draft",
    assets,
    createdAt: previous?.createdAt || cleanText(input?.createdAt, 80) || now,
    updatedAt: touch ? now : cleanText(input?.updatedAt ?? previous?.updatedAt, 80) || now,
  };
}

async function readJson(filename, fallback = null) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filename);
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ""));
  if (!match || !IMAGE_TYPES.has(match[1].toLowerCase())) {
    throw new Error("仅支持 PNG、JPEG 或 WebP 图片");
  }
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > 24 * 1024 * 1024) {
    throw new Error("图片大小必须在 24MB 以内");
  }
  return { mimeType: match[1].toLowerCase(), bytes };
}

export function createStudioStore({ rootDir }) {
  const workspaceRoot = path.resolve(rootDir);

  function projectRoot(id) {
    return path.join(workspaceRoot, safeId(id));
  }

  function projectFile(id) {
    return path.join(projectRoot(id), "character.json");
  }

  async function ensure() {
    await mkdir(workspaceRoot, { recursive: true });
  }

  async function getProject(id) {
    const project = await readJson(projectFile(id));
    if (!project) return null;
    return normalizeProject(project, project, { touch: false });
  }

  async function listProjects() {
    await ensure();
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const project = await getProject(entry.name);
        if (!project) continue;
        const thumbnail = [...project.assets.processed, ...project.assets.reference].at(-1)?.url || "";
        projects.push({
          id: project.id,
          name: project.name,
          summary: project.summary,
          status: project.status,
          thumbnail,
          assetCount: ASSET_GROUPS.reduce((count, group) => count + project.assets[group].length, 0),
          updatedAt: project.updatedAt,
        });
      } catch {
        // Ignore unrelated or malformed directories instead of blocking valid projects.
      }
    }
    return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function createProject(input = {}) {
    await ensure();
    const project = normalizeProject(input);
    await mkdir(projectRoot(project.id), { recursive: true });
    await atomicWriteJson(projectFile(project.id), project);
    return project;
  }

  async function updateProject(id, input = {}) {
    const previous = await getProject(id);
    if (!previous) return null;
    const project = normalizeProject(input, previous);
    await atomicWriteJson(projectFile(id), project);
    return project;
  }

  async function deleteProject(id) {
    const project = await getProject(id);
    if (!project) return null;
    const trashRoot = path.join(workspaceRoot, ".trash-projects");
    await mkdir(trashRoot, { recursive: true });
    const trashName = `${Date.now()}-${safeId(id)}`;
    await rename(projectRoot(id), path.join(trashRoot, trashName));
    return {
      project: {
        id: project.id,
        name: project.name,
      },
      trashName,
    };
  }

  async function addAsset(id, input = {}) {
    const { mimeType, bytes } = parseDataUrl(input.dataUrl);
    return addAssetBytes(id, { ...input, mimeType, bytes });
  }

  async function addAssetBytes(id, input = {}) {
    const project = await getProject(id);
    if (!project) return null;
    const group = ASSET_GROUPS.includes(input.group) ? input.group : "reference";
    const mimeType = IMAGE_TYPES.has(input.mimeType) ? input.mimeType : "image/png";
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes || []);
    if (!bytes.length || bytes.length > 24 * 1024 * 1024) {
      throw new Error("图片大小必须在 24MB 以内");
    }
    const assetId = `asset-${randomUUID()}`;
    const filename = `${assetId}${IMAGE_TYPES.get(mimeType)}`;
    const directory = path.join(projectRoot(id), group);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), bytes);
    const asset = normalizeAsset({
      id: assetId,
      projectId: id,
      filename,
      name: cleanText(input.name || filename, 180),
      variant: cleanText(input.variant, 40),
      mimeType,
      size: bytes.length,
      width: input.width,
      height: input.height,
      createdAt: new Date().toISOString(),
    }, group);
    if (input.replaceVariant && asset.variant) {
      const replaced = project.assets[group].filter((item) => item.variant === asset.variant);
      for (const previous of replaced) {
        const previousFile = path.join(projectRoot(id), group, path.basename(previous.filename));
        if (!await stat(previousFile).then((info) => info.isFile()).catch(() => false)) continue;
        const trashDirectory = path.join(projectRoot(id), ".trash");
        await mkdir(trashDirectory, { recursive: true });
        await rename(previousFile, path.join(trashDirectory, `${Date.now()}-${previous.filename}`));
      }
      project.assets[group] = project.assets[group].filter((item) => item.variant !== asset.variant);
    }
    project.assets[group].push(asset);
    const updated = normalizeProject(project, project);
    await atomicWriteJson(projectFile(id), updated);
    return { project: updated, asset };
  }

  async function deleteAsset(id, assetId) {
    const project = await getProject(id);
    if (!project) return null;
    let match = null;
    for (const group of ASSET_GROUPS) {
      const index = project.assets[group].findIndex((asset) => asset.id === assetId);
      if (index < 0) continue;
      match = { group, index, asset: project.assets[group][index] };
      break;
    }
    if (!match) return { project, asset: null };
    const source = path.join(projectRoot(id), match.group, path.basename(match.asset.filename));
    if (await stat(source).then((info) => info.isFile()).catch(() => false)) {
      const trashDirectory = path.join(projectRoot(id), ".trash");
      await mkdir(trashDirectory, { recursive: true });
      const trashName = `${Date.now()}-${match.asset.filename}`;
      await rename(source, path.join(trashDirectory, trashName));
    }
    project.assets[match.group].splice(match.index, 1);
    const updated = normalizeProject(project, project);
    await atomicWriteJson(projectFile(id), updated);
    return { project: updated, asset: match.asset };
  }

  function findAsset(project, assetId) {
    for (const group of ASSET_GROUPS) {
      const asset = project?.assets?.[group]?.find((item) => item.id === assetId);
      if (asset) return asset;
    }
    return null;
  }

  async function exportProject(id) {
    const project = await getProject(id);
    if (!project) return null;
    const assets = [];
    for (const group of ASSET_GROUPS) {
      for (const asset of project.assets[group]) {
        const filename = path.join(projectRoot(id), group, path.basename(asset.filename));
        const info = await stat(filename);
        if (!info.isFile()) continue;
        const bytes = await readFile(filename);
        assets.push({
          group,
          variant: asset.variant,
          name: asset.name,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          dataUrl: `data:${asset.mimeType};base64,${bytes.toString("base64")}`,
        });
      }
    }
    return {
      schema: `${SCHEMA}-bundle`,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      project: {
        name: project.name,
        summary: project.summary,
        appearance: project.appearance,
        basePrompt: project.basePrompt,
        canvas: project.canvas,
        processing: project.processing,
        status: project.status,
      },
      assets,
    };
  }

  async function importProject(bundle) {
    if (bundle?.schema !== `${SCHEMA}-bundle` || Number(bundle.version) !== VERSION) {
      throw new Error("不是有效的角色素材工作台文件");
    }
    const project = await createProject({
      ...bundle.project,
      name: `${cleanText(bundle.project?.name || "导入角色", 70)} · 导入`,
    });
    let current = project;
    for (const asset of Array.isArray(bundle.assets) ? bundle.assets.slice(0, 240) : []) {
      const result = await addAsset(project.id, asset);
      if (result) current = result.project;
    }
    return current;
  }

  function resolveAsset(id, group, filename) {
    if (!ASSET_GROUPS.includes(group)) return null;
    const resolved = path.resolve(projectRoot(id), group, path.basename(filename));
    const expectedRoot = `${path.resolve(projectRoot(id), group)}${path.sep}`;
    return resolved.startsWith(expectedRoot) ? resolved : null;
  }

  return {
    addAsset,
    addAssetBytes,
    createProject,
    deleteAsset,
    deleteProject,
    exportProject,
    getProject,
    importProject,
    findAsset,
    listProjects,
    resolveAsset,
    updateProject,
  };
}

export const STUDIO_DEFAULT_PROMPT = DEFAULT_PROMPT;
export const STUDIO_SCHEMA = SCHEMA;
