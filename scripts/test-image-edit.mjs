import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fetch as undiciFetch, FormData as UndiciFormData, ProxyAgent } from "undici";
import modelConfig from "../config/ai-models.json" with { type: "json" };

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(path.join(projectRoot, ".env.local"));

const imageConfig = modelConfig.downstream?.image || {};
const apiKey = process.env.GPT_IMAGE_API_KEY || process.env.IMAGE_API_KEY || "";
const baseUrl = String(process.env.GPT_IMAGE_BASE_URL || imageConfig.baseUrl || "").replace(/\/$/, "");
const model = imageConfig.defaultModel || "gpt-image-2";
const size = imageConfig.portraitSize || "1024x1536";
const proxyUrl = String(process.env.LOCAL_HTTP_PROXY || "").trim();
const dispatcher = proxyUrl && proxyUrl.toLowerCase() !== "direct"
  ? new ProxyAgent(proxyUrl)
  : undefined;

if (!apiKey) throw new Error("没有读取到 GPT_IMAGE_API_KEY 或 IMAGE_API_KEY");
if (!baseUrl) throw new Error("没有配置图片接口地址");

const request = (url, init) => undiciFetch(url, {
  ...init,
  ...(dispatcher ? { dispatcher } : {}),
  signal: AbortSignal.timeout(10 * 60 * 1000),
});

async function readJsonResponse(response, phase) {
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`${phase}返回非 JSON（${response.status}）：${text.slice(0, 400)}`);
  }
  if (!response.ok) {
    throw new Error(`${phase}失败（${response.status}）：${JSON.stringify(result).slice(0, 600)}`);
  }
  const url = result?.data?.[0]?.url;
  if (!url) throw new Error(`${phase}没有返回图片 URL`);
  return { result, url };
}

async function downloadImage(url, outputPath) {
  const response = await request(url, {});
  if (!response.ok) throw new Error(`下载图片失败（${response.status}）`);
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!contentType.startsWith("image/") || buffer.length < 1024) {
    throw new Error(`下载结果不是有效图片：${contentType || "unknown"}，${buffer.length} bytes`);
  }
  await writeFile(outputPath, buffer);
  return { buffer, contentType };
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDirectory = path.join(projectRoot, "data", "generated-images");
await mkdir(outputDirectory, { recursive: true });
const suppliedBasePath = process.argv[2] ? path.resolve(projectRoot, process.argv[2]) : "";
const basePath = suppliedBasePath || path.join(outputDirectory, `edit-test-base-${timestamp}.png`);
const editedPath = path.join(outputDirectory, `edit-test-action-${timestamp}.png`);

const basePrompt = `一位24岁成年女性角色的标准基础立绘，黑色及肩长发，深棕色眼睛，五官自然清晰，穿深蓝色长袖上衣、浅灰色长裤和白色平底鞋。单人，正面全身自然站立，双手放松垂落，完整显示头顶到脚部，人物居中，身体比例自然，镜头与人物视线平齐。纯浅灰色简洁背景，均匀柔光，写实电影人物概念设计，高清细节。不要文字、水印、边框、道具或其他人物。`;

let baseResult = { result: { data: [{}] } };
let baseDownload;
if (suppliedBasePath) {
  const buffer = await readFile(suppliedBasePath);
  baseDownload = { buffer, contentType: "image/png" };
  console.log(`phase=base-generation status=reused bytes=${buffer.length}`);
} else {
  console.log("phase=base-generation status=requesting");
  const baseResponse = await request(`${baseUrl}${imageConfig.endpoint || "/images/generations"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: basePrompt,
      n: 1,
      size,
      quality: "standard",
      response_format: "url",
      output_format: "png",
    }),
  });
  baseResult = await readJsonResponse(baseResponse, "基础图生成");
  baseDownload = await downloadImage(baseResult.url, basePath);
  console.log(`phase=base-generation status=completed bytes=${baseDownload.buffer.length}`);
}

const editPrompt = `图片1是唯一角色基底图。必须保持图片1中的同一个成年人物，脸型、五官、发型、发色、瞳色、体态、服装颜色、材质和鞋子完全一致，不得重新设计人物。只改变表情和动作：她露出温柔开心的微笑，右手自然挥手问候，左手放松垂落，身体重心轻微向一侧移动。保持单人、正面全身、完整头脚、人物居中、同一镜头高度、同一身体比例和写实电影人物概念设计风格。背景改为干净纯浅灰色，不要环境、家具、道具、文字、水印、边框或额外人物。`;
const formData = new UndiciFormData();
formData.append("model", model);
formData.append("prompt", editPrompt);
formData.append("size", size);
formData.append("quality", "standard");
formData.append("response_format", "url");
formData.append("output_format", "png");
formData.append("image", new Blob([baseDownload.buffer], { type: baseDownload.contentType }), "character-base.png");

console.log("phase=image-edit status=requesting endpoint=/images/edits");
const editResponse = await request(`${baseUrl}/images/edits`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
  body: formData,
});
const editResult = await readJsonResponse(editResponse, "图生图");
const editDownload = await downloadImage(editResult.url, editedPath);
console.log(`phase=image-edit status=completed bytes=${editDownload.buffer.length}`);
console.log(JSON.stringify({
  ok: true,
  model,
  size,
  basePath,
  editedPath,
  baseResponseDimensions: {
    width: baseResult.result?.data?.[0]?.width || null,
    height: baseResult.result?.data?.[0]?.height || null,
  },
  editedResponseDimensions: {
    width: editResult.result?.data?.[0]?.width || null,
    height: editResult.result?.data?.[0]?.height || null,
  },
}, null, 2));

await dispatcher?.close();
