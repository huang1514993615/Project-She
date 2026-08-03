export const IMAGE_MODEL_FALLBACKS = Object.freeze([
  "gpt-image-2",
  "grok-imagine-image",
  "grok-imagine-image-quality",
]);

export function isGrokImageModel(model) {
  return /^grok-imagine-image(?:-|$)/i.test(String(model || "").trim());
}

export function imageModelProvider(model) {
  const value = String(model || "").trim();
  if (isGrokImageModel(value)) return "grok";
  if (/^dall-e(?:-|$)/i.test(value)) return "dall-e";
  if (/^gpt-image(?:-|$)/i.test(value)) return "openai-image";
  if (/(^|[-_.])flux(?:-|$)/i.test(value)) return "flux";
  if (/(^|[-_.])imagen(?:-|$)/i.test(value)) return "imagen";
  return "openai-compatible";
}

export function imageModelLabel(model) {
  const value = String(model || "").trim();
  if (value === "grok-imagine-image-quality") return "Grok Imagine（高质量）";
  if (value === "grok-imagine-image") return "Grok Imagine（标准）";
  if (value === "gpt-image-2") return "GPT Image 2";
  return value;
}

export function imageModelAdapterLabel(model) {
  const labels = {
    grok: "Grok 参数适配",
    "openai-image": "OpenAI Image 参数适配",
    "dall-e": "DALL·E 参数适配",
    flux: "Flux 兼容参数",
    imagen: "Imagen 兼容参数",
    "openai-compatible": "通用兼容参数",
  };
  return labels[imageModelProvider(model)];
}

export function imageModelCapabilities(model) {
  const provider = imageModelProvider(model);
  return {
    provider,
    keyChannel: provider === "grok" ? "grok" : "gpt",
    promptLimit: provider === "grok" ? 1024 : 1200,
    geometryParameter: provider === "grok" ? "aspect_ratio" : "size",
    qualityParameter: ["grok", "openai-image", "dall-e"].includes(provider),
  };
}

export function imageModelSpec(model, kind = "character") {
  const provider = imageModelProvider(model);
  if (provider === "grok") {
    return kind === "stage-background" ? "1K · 16:9 横图" : "1K · 9:16 竖图";
  }
  if (provider === "dall-e") {
    return kind === "stage-background" ? "标准 · 1792×1024 横图" : "标准 · 1024×1792 竖图";
  }
  return kind === "stage-background" ? "标准 · 1536×1024 横图" : "标准 · 1024×1536 竖图";
}

export function normalizeImagePromptForModel(prompt, model) {
  const value = String(prompt || "").trim();
  const maxLength = imageModelCapabilities(model).promptLimit;
  return Array.from(value).slice(0, maxLength).join("");
}

export function buildImageGenerationPayload({
  model,
  prompt,
  kind = "character",
  portraitSize = "1024x1536",
  landscapeSize = "1536x1024",
}) {
  const normalizedPrompt = normalizeImagePromptForModel(prompt, model);
  const provider = imageModelProvider(model);
  if (provider === "grok") {
    return {
      model,
      prompt: normalizedPrompt,
      n: 1,
      aspect_ratio: kind === "stage-background" ? "16:9" : "9:16",
      resolution: "1k",
      response_format: "url",
    };
  }
  if (provider === "dall-e") {
    return {
      model,
      prompt: normalizedPrompt,
      n: 1,
      size: kind === "stage-background" ? "1792x1024" : "1024x1792",
      quality: "standard",
      response_format: "url",
    };
  }
  if (["flux", "imagen", "openai-compatible"].includes(provider)) {
    return {
      model,
      prompt: normalizedPrompt,
      n: 1,
      size: kind === "stage-background" ? landscapeSize : portraitSize,
      response_format: "url",
    };
  }
  return {
    model,
    prompt: normalizedPrompt,
    n: 1,
    size: kind === "stage-background" ? landscapeSize : portraitSize,
    quality: "standard",
    response_format: "url",
    output_format: "png",
  };
}
