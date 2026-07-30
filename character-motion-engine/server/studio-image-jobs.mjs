import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetch as undiciFetch, FormData as UndiciFormData, ProxyAgent } from "undici";

const MAX_JOBS = 200;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const ALLOWED_GROUPS = new Set(["poses", "expressions"]);

function cleanText(value, maxLength = 5000) {
  return String(value ?? "").replace(/\0/g, "").slice(0, maxLength);
}

async function readJson(filename, fallback) {
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

function normalizeJob(job) {
  return {
    id: cleanText(job.id, 100),
    projectId: cleanText(job.projectId, 100),
    referenceAssetId: cleanText(job.referenceAssetId, 100),
    group: ALLOWED_GROUPS.has(job.group) ? job.group : "poses",
    variant: cleanText(job.variant, 60),
    title: cleanText(job.title, 100),
    prompt: cleanText(job.prompt),
    model: cleanText(job.model, 100),
    size: cleanText(job.size, 40),
    status: ["queued", "running", "completed", "failed"].includes(job.status) ? job.status : "queued",
    error: cleanText(job.error, 1200),
    resultAssetId: cleanText(job.resultAssetId, 100),
    createdAt: cleanText(job.createdAt, 80),
    startedAt: cleanText(job.startedAt, 80),
    completedAt: cleanText(job.completedAt, 80),
  };
}

function buildEditPrompt(project, instruction) {
  return `图片1是唯一的人物身份、脸部、发型、发饰、身体比例、服装结构和配色基准。必须保持同一个成年角色，不得重新设计人物，不得改变脸型、五官、瞳色、发色、服装、饰品、身体比例、人物尺寸、镜头距离和脚底基线。

稳定外观：
${cleanText(project.appearance, 3000)}

本次只允许进行以下变化：
${cleanText(instruction, 1800)}

保持单人、正面全身、从头顶到鞋底完整可见、人物居中、双手结构清楚。保持与图片1相同的精致幻想游戏角色立绘和二次元厚涂质感。背景必须保持纯色高饱和绿色 #00FF00，平整均匀，没有阴影、环境、家具、道具、文字、水印、边框或额外人物。`;
}

export async function createStudioImageJobs({
  workspaceRoot,
  projectRoot,
  studioStore,
}) {
  const jobsFile = path.join(workspaceRoot, "image-jobs.json");
  const configFile = path.resolve(projectRoot, "..", "config", "ai-models.json");
  const envFile = path.resolve(projectRoot, "..", ".env.local");
  try {
    process.loadEnvFile(envFile);
  } catch {
    // The status endpoint reports missing configuration without exposing secrets.
  }
  const modelConfig = await readJson(configFile, {});
  const imageConfig = modelConfig.downstream?.image || {};
  const apiKey = process.env.GPT_IMAGE_API_KEY || process.env.IMAGE_API_KEY || "";
  const baseUrl = String(process.env.GPT_IMAGE_BASE_URL || imageConfig.baseUrl || "").replace(/\/$/, "");
  const model = imageConfig.defaultModel || "gpt-image-2";
  const size = imageConfig.portraitSize || "1024x1536";
  const proxyUrl = String(process.env.LOCAL_HTTP_PROXY || "").trim();
  const dispatcher = proxyUrl && proxyUrl.toLowerCase() !== "direct"
    ? new ProxyAgent(proxyUrl)
    : undefined;
  let jobs = (await readJson(jobsFile, [])).map(normalizeJob);
  let running = false;
  for (const job of jobs) {
    if (job.status === "running") {
      job.status = "failed";
      job.error = "本地服务曾在生成过程中重启；为避免重复扣费，此任务没有自动重试。";
      job.completedAt = new Date().toISOString();
    }
  }
  await atomicWriteJson(jobsFile, jobs);

  const request = (url, init = {}) => undiciFetch(url, {
    ...init,
    ...(dispatcher ? { dispatcher } : {}),
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
  });

  async function persist() {
    jobs = jobs.slice(-MAX_JOBS);
    await atomicWriteJson(jobsFile, jobs);
  }

  function publicJob(job) {
    const normalized = normalizeJob(job);
    delete normalized.prompt;
    return normalized;
  }

  function getStatus() {
    return {
      configured: Boolean(apiKey && baseUrl),
      model,
      size,
      running: jobs.some((job) => job.status === "running"),
      queued: jobs.filter((job) => job.status === "queued").length,
    };
  }

  function listJobs(projectId) {
    return jobs
      .filter((job) => job.projectId === projectId)
      .slice(-40)
      .reverse()
      .map(publicJob);
  }

  function hasActiveJob(projectId) {
    return jobs.some((job) =>
      job.projectId === projectId
      && (job.status === "queued" || job.status === "running"));
  }

  async function createJob(projectId, input = {}) {
    if (!apiKey || !baseUrl) throw new Error("没有配置 GPT Image 2 图片接口");
    if (jobs.some((job) => job.status === "queued" || job.status === "running")) {
      throw new Error("已有一张图片正在生成，请等待当前任务完成");
    }
    const project = await studioStore.getProject(projectId);
    if (!project) return null;
    const instruction = cleanText(input.prompt, 1800).trim();
    if (instruction.length < 8) throw new Error("动作提示词过短");
    const group = ALLOWED_GROUPS.has(input.group) ? input.group : "poses";
    const reference = input.referenceAssetId
      ? studioStore.findAsset(project, input.referenceAssetId)
      : [...project.assets.processed].reverse().find((asset) => asset.variant === "normalized")
        || project.assets.reference.at(-1);
    if (!reference) throw new Error("请先生成规范画布绿幕图");
    const referencePath = studioStore.resolveAsset(projectId, reference.group, reference.filename);
    if (!referencePath) throw new Error("无法读取图生图基准素材");
    const job = normalizeJob({
      id: `job-${randomUUID()}`,
      projectId,
      referenceAssetId: reference.id,
      group,
      variant: cleanText(input.variant, 60) || "custom",
      title: cleanText(input.title, 100) || "图生图任务",
      prompt: buildEditPrompt(project, instruction),
      model,
      size,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    jobs.push(job);
    await persist();
    void runQueue();
    return publicJob(job);
  }

  async function runJob(job) {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.error = "";
    await persist();
    try {
      const project = await studioStore.getProject(job.projectId);
      if (!project) throw new Error("角色项目不存在");
      const reference = studioStore.findAsset(project, job.referenceAssetId);
      if (!reference) throw new Error("图生图基准素材已被删除");
      const referencePath = studioStore.resolveAsset(job.projectId, reference.group, reference.filename);
      const referenceBytes = await readFile(referencePath);
      const formData = new UndiciFormData();
      formData.append("model", model);
      formData.append("prompt", job.prompt);
      formData.append("size", size);
      formData.append("quality", "standard");
      formData.append("response_format", "url");
      formData.append("output_format", "png");
      formData.append("image", new Blob([referenceBytes], { type: reference.mimeType }), reference.filename);
      const response = await request(`${baseUrl}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(`图片接口返回非 JSON（${response.status}）`);
      }
      if (!response.ok) {
        const detail = result?.error?.message || result?.error || JSON.stringify(result);
        throw new Error(`图片接口 ${response.status}：${cleanText(detail, 700)}`);
      }
      const data = result?.data?.[0] || {};
      let bytes;
      let mimeType = "image/png";
      if (data.b64_json) {
        bytes = Buffer.from(data.b64_json, "base64");
      } else if (data.url) {
        const download = await request(data.url);
        if (!download.ok) throw new Error(`下载生成图片失败（${download.status}）`);
        mimeType = (download.headers.get("content-type") || "image/png").split(";")[0];
        bytes = Buffer.from(await download.arrayBuffer());
      } else {
        throw new Error("图片接口没有返回图片 URL 或图片数据");
      }
      const saved = await studioStore.addAssetBytes(job.projectId, {
        group: job.group,
        variant: job.variant,
        name: `${job.title}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
        mimeType,
        bytes,
        width: data.width || 1024,
        height: data.height || 1536,
      });
      if (!saved) throw new Error("生成图片保存失败");
      job.status = "completed";
      job.resultAssetId = saved.asset.id;
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.error = cleanText(error?.message || "图生图失败", 1200);
      job.completedAt = new Date().toISOString();
    }
    await persist();
  }

  async function runQueue() {
    if (running) return;
    running = true;
    try {
      let job = jobs.find((item) => item.status === "queued");
      while (job) {
        await runJob(job);
        job = jobs.find((item) => item.status === "queued");
      }
    } finally {
      running = false;
    }
  }

  void runQueue();
  return {
    createJob,
    getStatus,
    hasActiveJob,
    listJobs,
  };
}
