import {
  calculateContainRect,
  removeChromaFromPixels,
} from "../src/image-processing.js";

const state = {
  projects: [],
  current: null,
  activeAssetUrl: "",
  activeGeneratedAssetUrl: "",
  imageStatus: null,
  imageJobs: [],
  jobPollTimer: null,
  saveTimer: null,
  toastTimer: null,
};

const elements = Object.fromEntries([
  "saveState", "projectList", "newProjectButton", "emptyCreateButton", "emptyState",
  "editorContent", "projectName", "projectSummary", "projectAppearance", "canvasWidth",
  "canvasHeight", "canvasBackground", "canvasBackgroundText", "basePrompt",
  "promptLength", "progressValue", "progressBar", "progressHint", "assetCount",
  "referenceInput", "referencePreview", "uploadPlaceholder", "uploadStage", "assetStrip",
  "canvasMeta", "backgroundMeta", "backgroundDot", "copyPromptButton", "exportButton",
  "importButton", "importInput", "toast", "normalizeButton", "removeChromaButton",
  "processingStatus", "chromaThreshold", "chromaSoftness", "thresholdValue", "softnessValue",
  "chromaDespill", "despillValue", "deleteAssetButton", "imageApiStatus", "imageJobList",
  "deleteProjectButton", "generationAvailability", "generatedPreview", "generatedPlaceholder",
  "generatedAssetStrip", "deleteGeneratedAssetButton",
].map((id) => [id, document.getElementById(id)]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function showToast(message, type = "success") {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show${type === "error" ? " error" : ""}`;
  state.toastTimer = setTimeout(() => {
    elements.toast.className = "toast";
  }, 2600);
}

function setSaveState(mode, label) {
  elements.saveState.className = `save-state ${mode}`;
  elements.saveState.lastChild.textContent = label;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderProjectList() {
  elements.projectList.replaceChildren();
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-item${project.id === state.current?.id ? " active" : ""}`;
    button.dataset.projectId = project.id;
    const thumb = document.createElement("span");
    thumb.className = "project-thumb";
    if (project.thumbnail) {
      const image = document.createElement("img");
      image.src = project.thumbnail;
      image.alt = "";
      thumb.append(image);
    } else {
      thumb.textContent = project.name.trim().slice(0, 1) || "角";
    }
    const copy = document.createElement("span");
    copy.className = "project-copy";
    const name = document.createElement("strong");
    name.textContent = project.name;
    const meta = document.createElement("small");
    meta.textContent = `${project.assetCount} 张素材 · ${formatDate(project.updatedAt)}`;
    copy.append(name, meta);
    button.append(thumb, copy);
    button.addEventListener("click", () => selectProject(project.id));
    elements.projectList.append(button);
  }
}

function basePreviewAssets(project) {
  const assets = project?.assets || {};
  return [
    ...(assets.processed || []),
    ...(assets.reference || []),
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function generatedPreviewAssets(project) {
  const assets = project?.assets || {};
  return [
    ...(assets.expressions || []),
    ...(assets.poses || []),
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function latestReference(project) {
  return project?.assets?.reference?.at(-1) || null;
}

function latestProcessed(project, variant) {
  return [...(project?.assets?.processed || [])].reverse()
    .find((asset) => !variant || asset.variant === variant) || null;
}

function activeAsset(project = state.current) {
  return basePreviewAssets(project).find((asset) => asset.url === state.activeAssetUrl) || null;
}

function activeGeneratedAsset(project = state.current) {
  return generatedPreviewAssets(project)
    .find((asset) => asset.url === state.activeGeneratedAssetUrl) || null;
}

function updatePreview(project) {
  const assets = basePreviewAssets(project);
  if (!state.activeAssetUrl || !assets.some((asset) => asset.url === state.activeAssetUrl)) {
    state.activeAssetUrl = assets[0]?.url || "";
  }
  elements.referencePreview.hidden = !state.activeAssetUrl;
  elements.uploadPlaceholder.hidden = Boolean(state.activeAssetUrl);
  if (state.activeAssetUrl) elements.referencePreview.src = state.activeAssetUrl;
  elements.deleteAssetButton.disabled = !activeAsset(project);
  elements.assetStrip.replaceChildren();
  for (const asset of assets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `asset-thumb${asset.url === state.activeAssetUrl ? " active" : ""}`;
    button.title = asset.name;
    const image = document.createElement("img");
    image.src = asset.url;
    image.alt = asset.name;
    const badge = document.createElement("span");
    badge.textContent = asset.variant || asset.group;
    button.append(image, badge);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      state.activeAssetUrl = asset.url;
      updatePreview(state.current);
    });
    elements.assetStrip.append(button);
  }
}

function updateGeneratedPreview(project) {
  const assets = generatedPreviewAssets(project);
  if (!state.activeGeneratedAssetUrl
    || !assets.some((asset) => asset.url === state.activeGeneratedAssetUrl)) {
    state.activeGeneratedAssetUrl = assets[0]?.url || "";
  }
  elements.generatedPreview.hidden = !state.activeGeneratedAssetUrl;
  elements.generatedPlaceholder.hidden = Boolean(state.activeGeneratedAssetUrl);
  if (state.activeGeneratedAssetUrl) elements.generatedPreview.src = state.activeGeneratedAssetUrl;
  elements.deleteGeneratedAssetButton.disabled = !activeGeneratedAsset(project);
  elements.generatedAssetStrip.replaceChildren();
  for (const asset of assets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `asset-thumb${asset.url === state.activeGeneratedAssetUrl ? " active" : ""}`;
    button.title = asset.name;
    const image = document.createElement("img");
    image.src = asset.url;
    image.alt = asset.name;
    const badge = document.createElement("span");
    badge.textContent = asset.variant || asset.group;
    button.append(image, badge);
    button.addEventListener("click", () => {
      state.activeGeneratedAssetUrl = asset.url;
      updateGeneratedPreview(state.current);
    });
    elements.generatedAssetStrip.append(button);
  }
}

function completion(project) {
  const checks = [
    Boolean(project.name.trim()),
    Boolean(project.summary.trim()),
    project.appearance.trim().length >= 30,
    project.basePrompt.trim().length >= 80,
    (project.assets.reference || []).length > 0,
    Boolean(latestProcessed(project, "transparent")),
  ];
  const score = Math.round(checks.filter(Boolean).length / checks.length * 100);
  const hint = !checks[2]
    ? "等待填写稳定外观"
    : !checks[4]
      ? "等待上传角色基准图"
      : !checks[5]
        ? "等待生成透明基准图"
      : score === 100
        ? "第一阶段资料已完整"
        : "继续补全人物资料";
  return { score, hint };
}

function renderCurrent() {
  const project = state.current;
  elements.emptyState.hidden = Boolean(project);
  elements.editorContent.hidden = !project;
  elements.exportButton.disabled = !project;
  if (!project) {
    renderProjectList();
    return;
  }
  elements.projectName.value = project.name;
  elements.projectSummary.value = project.summary;
  elements.projectAppearance.value = project.appearance;
  elements.canvasWidth.value = String(project.canvas.width);
  elements.canvasHeight.value = String(project.canvas.height);
  elements.canvasBackground.value = project.canvas.background.toLowerCase();
  elements.canvasBackgroundText.value = project.canvas.background;
  elements.basePrompt.value = project.basePrompt;
  elements.promptLength.textContent = `${project.basePrompt.length} 字`;
  elements.canvasMeta.textContent = `${project.canvas.width} × ${project.canvas.height}`;
  elements.backgroundMeta.textContent = project.canvas.background;
  elements.backgroundDot.style.background = project.canvas.background;
  const baseTotal = basePreviewAssets(project).length;
  elements.assetCount.textContent = `${baseTotal} 张基准素材`;
  const progress = completion(project);
  elements.progressValue.textContent = `${progress.score}%`;
  elements.progressBar.style.width = `${progress.score}%`;
  elements.progressHint.textContent = progress.hint;
  updatePreview(project);
  updateGeneratedPreview(project);
  const hasReference = Boolean(latestReference(project));
  elements.normalizeButton.disabled = !hasReference;
  elements.removeChromaButton.disabled = !hasReference;
  elements.chromaThreshold.value = String(project.processing?.threshold ?? 42);
  elements.chromaSoftness.value = String(project.processing?.softness ?? 96);
  elements.chromaDespill.value = String(Math.round((project.processing?.despill ?? 0.9) * 100));
  elements.thresholdValue.textContent = elements.chromaThreshold.value;
  elements.softnessValue.textContent = elements.chromaSoftness.value;
  elements.despillValue.textContent = `${elements.chromaDespill.value}%`;
  elements.processingStatus.textContent = latestProcessed(project, "transparent")
    ? "透明基准图已生成"
    : latestProcessed(project, "normalized")
      ? "画布已规范"
      : hasReference
        ? "可以开始处理"
        : "等待基准图";
  renderImageStatus();
  renderImageJobs();
  renderProjectList();
}

function readFormIntoProject() {
  if (!state.current) return;
  state.current.name = elements.projectName.value || "未命名角色";
  state.current.summary = elements.projectSummary.value;
  state.current.appearance = elements.projectAppearance.value;
  state.current.basePrompt = elements.basePrompt.value;
  state.current.canvas = {
    width: Number(elements.canvasWidth.value) || 1024,
    height: Number(elements.canvasHeight.value) || 1536,
    background: elements.canvasBackgroundText.value.toUpperCase(),
  };
  state.current.processing = {
    chromaColor: elements.canvasBackgroundText.value.toUpperCase(),
    threshold: Number(elements.chromaThreshold.value) || 42,
    softness: Number(elements.chromaSoftness.value) || 96,
    despill: Number(elements.chromaDespill.value) / 100,
  };
  elements.promptLength.textContent = `${state.current.basePrompt.length} 字`;
  elements.canvasMeta.textContent = `${state.current.canvas.width} × ${state.current.canvas.height}`;
  elements.backgroundMeta.textContent = state.current.canvas.background;
  elements.backgroundDot.style.background = state.current.canvas.background;
  const progress = completion(state.current);
  elements.progressValue.textContent = `${progress.score}%`;
  elements.progressBar.style.width = `${progress.score}%`;
  elements.progressHint.textContent = progress.hint;
}

function scheduleSave() {
  if (!state.current) return;
  readFormIntoProject();
  clearTimeout(state.saveTimer);
  setSaveState("saving", "等待保存");
  state.saveTimer = setTimeout(saveCurrent, 520);
}

async function saveCurrent() {
  if (!state.current) return;
  clearTimeout(state.saveTimer);
  readFormIntoProject();
  setSaveState("saving", "正在保存");
  try {
    const payload = await api(`/api/studio/projects/${state.current.id}`, {
      method: "PUT",
      body: JSON.stringify(state.current),
    });
    state.current = payload.project;
    await refreshProjects(false);
    renderProjectList();
    setSaveState("saved", "已保存到本地");
  } catch (error) {
    setSaveState("", "保存失败");
    showToast(error.message, "error");
  }
}

async function refreshProjects(render = true) {
  const payload = await api("/api/studio/projects");
  state.projects = payload.projects;
  if (render) renderProjectList();
}

async function selectProject(id) {
  if (state.current && state.current.id !== id) await saveCurrent();
  clearTimeout(state.jobPollTimer);
  const payload = await api(`/api/studio/projects/${id}`);
  state.current = payload.project;
  state.activeAssetUrl = "";
  state.activeGeneratedAssetUrl = "";
  state.imageJobs = [];
  renderCurrent();
  await Promise.all([
    refreshImageStatus(),
    refreshImageJobs({ refreshAssets: false }),
  ]);
  setSaveState("saved", "已保存到本地");
}

async function createProject() {
  try {
    setSaveState("saving", "正在创建");
    const payload = await api("/api/studio/projects", {
      method: "POST",
      body: JSON.stringify({ name: "新角色" }),
    });
    await refreshProjects(false);
    state.current = payload.project;
    state.activeAssetUrl = "";
    state.activeGeneratedAssetUrl = "";
    renderCurrent();
    setSaveState("saved", "已保存到本地");
    elements.projectName.focus();
    elements.projectName.select();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      reject(new Error("仅支持 PNG、JPEG 或 WebP 图片"));
      return;
    }
    if (file.size > 24 * 1024 * 1024) {
      reject(new Error("图片不能超过 24MB"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("无法识别图片尺寸"));
      image.onload = () => resolve({
        dataUrl: reader.result,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadReference(file) {
  if (!state.current || !file) return;
  setSaveState("saving", "正在保存图片");
  try {
    const image = await readImage(file);
    const payload = await api(`/api/studio/projects/${state.current.id}/assets`, {
      method: "POST",
      body: JSON.stringify({
        group: "reference",
        name: file.name,
        dataUrl: image.dataUrl,
        width: image.width,
        height: image.height,
      }),
    });
    state.current = payload.project;
    state.activeAssetUrl = payload.asset.url;
    await refreshProjects(false);
    renderCurrent();
    setSaveState("saved", "图片已保存");
    showToast(`已保存基准图：${file.name}`);
  } catch (error) {
    setSaveState("", "图片保存失败");
    showToast(error.message, "error");
  } finally {
    elements.referenceInput.value = "";
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取基准图片"));
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("生成 PNG 失败"));
    }, "image/png");
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取处理结果失败"));
    reader.readAsDataURL(blob);
  });
}

async function createNormalizedCanvas() {
  const source = latestReference(state.current);
  if (!source) throw new Error("请先上传角色基准图");
  const image = await loadImage(source.url);
  const width = state.current.canvas.width;
  const height = state.current.canvas.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = state.current.canvas.background;
  context.fillRect(0, 0, width, height);
  const rect = calculateContainRect(image.naturalWidth, image.naturalHeight, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  return { canvas, rect, source };
}

async function saveProcessedCanvas(canvas, variant, name) {
  const blob = await canvasToBlob(canvas);
  const payload = await api(`/api/studio/projects/${state.current.id}/assets`, {
    method: "POST",
    body: JSON.stringify({
      group: "processed",
      variant,
      name,
      replaceVariant: true,
      dataUrl: await blobToDataUrl(blob),
      width: canvas.width,
      height: canvas.height,
    }),
  });
  state.current = payload.project;
  state.activeAssetUrl = payload.asset.url;
  await refreshProjects(false);
  renderCurrent();
  return payload.asset;
}

async function runProcessing(label, task) {
  elements.normalizeButton.disabled = true;
  elements.removeChromaButton.disabled = true;
  elements.processingStatus.textContent = label;
  setSaveState("saving", label);
  try {
    await saveCurrent();
    await task();
    setSaveState("saved", "处理结果已保存");
  } catch (error) {
    setSaveState("", "图片处理失败");
    showToast(error.message, "error");
    renderCurrent();
  }
}

async function normalizeReference() {
  await runProcessing("正在规范画布", async () => {
    const { canvas, rect, source } = await createNormalizedCanvas();
    await saveProcessedCanvas(
      canvas,
      "normalized",
      `${source.name.replace(/\.[^.]+$/, "")}-${canvas.width}x${canvas.height}-绿幕.png`,
    );
    showToast(`画布已等比缩放，左右补边约 ${Math.round(rect.x)}px`);
  });
}

async function removeGreenScreen() {
  await runProcessing("正在抠除绿幕", async () => {
    const { canvas, source } = await createNormalizedCanvas();
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = removeChromaFromPixels(imageData.data, {
      color: state.current.processing.chromaColor,
      threshold: state.current.processing.threshold,
      softness: state.current.processing.softness,
      despill: state.current.processing.despill,
    });
    context.putImageData(imageData, 0, 0);
    await saveProcessedCanvas(canvas, "transparent", `${source.name.replace(/\.[^.]+$/, "")}-透明基准图.png`);
    showToast(`透明图已生成，移除 ${result.transparentPixels.toLocaleString()} 个背景像素`);
  });
}

function findAssetById(project, assetId) {
  return Object.values(project?.assets || {})
    .flatMap((items) => Array.isArray(items) ? items : [])
    .find((asset) => asset.id === assetId) || null;
}

async function deleteAsset(asset, target) {
  if (!state.current || !asset) return;
  const confirmed = window.confirm(`确定删除“${asset.name}”吗？\n\n文件会移入该角色的 .trash 回收目录，不会立即永久清除。`);
  if (!confirmed) return;
  try {
    const payload = await api(`/api/studio/projects/${state.current.id}/assets/${asset.id}`, {
      method: "DELETE",
    });
    state.current = payload.project;
    if (target === "generated") state.activeGeneratedAssetUrl = "";
    else state.activeAssetUrl = "";
    await refreshProjects(false);
    renderCurrent();
    showToast("素材已移入本地回收目录");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteCurrentAsset() {
  await deleteAsset(activeAsset(), "base");
}

async function deleteCurrentGeneratedAsset() {
  await deleteAsset(activeGeneratedAsset(), "generated");
}

async function deleteCurrentProject() {
  if (!state.current) return;
  const project = state.current;
  const confirmed = window.confirm(`确定删除角色项目“${project.name}”吗？\n\n整个项目会移入 workspace/.trash-projects，可以手动恢复。正在生成图片的角色暂时不能删除。`);
  if (!confirmed) return;
  try {
    await api(`/api/studio/projects/${project.id}`, { method: "DELETE" });
    clearTimeout(state.jobPollTimer);
    state.current = null;
    state.activeAssetUrl = "";
    state.activeGeneratedAssetUrl = "";
    state.imageJobs = [];
    await refreshProjects(false);
    if (state.projects.length) await selectProject(state.projects[0].id);
    else renderCurrent();
    showToast(`角色项目“${project.name}”已移入项目回收目录`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderImageStatus() {
  const status = state.imageStatus;
  if (!status) {
    elements.imageApiStatus.textContent = "正在检查图片接口";
    elements.imageApiStatus.className = "api-state";
    elements.generationAvailability.textContent = "正在检查图片接口与基准素材";
    elements.generationAvailability.className = "generation-availability";
    return;
  }
  elements.imageApiStatus.textContent = status.configured
    ? `${status.model} · 已配置`
    : "图片接口未配置";
  elements.imageApiStatus.className = `api-state${status.configured ? " configured" : " error"}`;
  const hasNormalized = Boolean(latestProcessed(state.current, "normalized"));
  const activeJob = state.imageJobs.find((job) => job.status === "queued" || job.status === "running");
  const hasActiveJob = Boolean(activeJob);
  if (!status.configured) {
    elements.generationAvailability.textContent = "图片接口尚未配置，暂时不能提交图生图任务";
    elements.generationAvailability.className = "generation-availability error";
  } else if (!hasNormalized) {
    elements.generationAvailability.textContent = "请先在第一步点击“规范画布”，生成动作所需的绿色基准图";
    elements.generationAvailability.className = "generation-availability waiting";
  } else if (activeJob) {
    elements.generationAvailability.textContent = `正在后台生成“${activeJob.title}”；完成前暂停新任务，避免重复扣费`;
    elements.generationAvailability.className = "generation-availability running";
  } else {
    elements.generationAvailability.textContent = "基准图和接口均已就绪，可以选择一个动作或表情生成";
    elements.generationAvailability.className = "generation-availability ready";
  }
  document.querySelectorAll("[data-generate]").forEach((button) => {
    button.disabled = !status.configured || !hasNormalized || hasActiveJob;
    button.textContent = hasActiveJob ? `正在生成：${activeJob.title}` : "确认生成1张";
  });
}

function renderImageJobs() {
  elements.imageJobList.replaceChildren();
  if (!state.imageJobs.length) {
    const empty = document.createElement("span");
    empty.textContent = "还没有图生图任务";
    elements.imageJobList.append(empty);
    renderImageStatus();
    return;
  }
  const labels = {
    queued: "等待处理",
    running: "生成中",
    completed: "已完成",
    failed: "失败",
  };
  for (const job of state.imageJobs.slice(0, 8)) {
    const item = document.createElement("article");
    item.className = `job-item ${job.status}`;
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = job.title;
    const detail = document.createElement("small");
    detail.textContent = job.error || `${job.model} · ${job.size}`;
    copy.append(title, detail);
    const status = document.createElement("span");
    status.textContent = labels[job.status] || job.status;
    item.append(copy, status);
    elements.imageJobList.append(item);
  }
  renderImageStatus();
}

async function refreshImageStatus() {
  try {
    state.imageStatus = await api("/api/studio/image-status");
  } catch {
    state.imageStatus = { configured: false };
  }
  renderImageStatus();
}

async function refreshImageJobs({ refreshAssets = true } = {}) {
  clearTimeout(state.jobPollTimer);
  if (!state.current) return;
  try {
    const payload = await api(`/api/studio/projects/${state.current.id}/image-jobs`);
    state.imageJobs = payload.jobs;
    const missingCompletedAsset = refreshAssets && state.imageJobs.find((job) =>
      job.status === "completed"
      && job.resultAssetId
      && !findAssetById(state.current, job.resultAssetId));
    if (missingCompletedAsset) {
      const projectPayload = await api(`/api/studio/projects/${state.current.id}`);
      state.current = projectPayload.project;
      state.activeGeneratedAssetUrl = findAssetById(
        state.current,
        missingCompletedAsset.resultAssetId,
      )?.url || state.activeGeneratedAssetUrl;
      await refreshProjects(false);
      renderCurrent();
    } else {
      renderImageJobs();
    }
    if (state.imageJobs.some((job) => job.status === "queued" || job.status === "running")) {
      state.jobPollTimer = setTimeout(() => refreshImageJobs(), 4000);
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function generateFromCard(button) {
  if (!state.current) return;
  const card = button.closest(".generation-card");
  const normalized = latestProcessed(state.current, "normalized");
  if (!normalized) {
    showToast("请先点击“规范画布”，生成图生图基准素材", "error");
    return;
  }
  const title = card.querySelector("strong").textContent.trim();
  const prompt = card.querySelector("textarea").value.trim();
  const confirmed = window.confirm(`将调用 ${state.imageStatus?.model || "GPT Image 2"} 生成1张“${title}”图片。\n\n该请求会产生费用，是否确认提交？`);
  if (!confirmed) return;
  button.disabled = true;
  button.textContent = "正在提交";
  try {
    await saveCurrent();
    await api(`/api/studio/projects/${state.current.id}/image-jobs`, {
      method: "POST",
      body: JSON.stringify({
        title,
        variant: card.dataset.variant,
        group: card.dataset.group,
        prompt,
        referenceAssetId: normalized.id,
      }),
    });
    showToast(`${title}任务已进入后台队列`);
    await refreshImageStatus();
    await refreshImageJobs({ refreshAssets: false });
  } catch (error) {
    showToast(error.message, "error");
    renderImageStatus();
  }
}

async function exportCurrent() {
  if (!state.current) return;
  try {
    await saveCurrent();
    const bundle = await api(`/api/studio/projects/${state.current.id}/export`);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.current.name.replace(/[\\/:*?"<>|]+/g, "-") || "character"}-素材包.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("角色素材包已导出");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function importBundle(file) {
  if (!file) return;
  try {
    const bundle = JSON.parse(await file.text());
    const payload = await api("/api/studio/import", {
      method: "POST",
      body: JSON.stringify(bundle),
    });
    await refreshProjects(false);
    state.current = payload.project;
    state.activeAssetUrl = "";
    state.activeGeneratedAssetUrl = "";
    renderCurrent();
    setSaveState("saved", "导入内容已保存");
    showToast("角色素材包已导入为新项目");
  } catch (error) {
    showToast(error.message || "导入失败", "error");
  } finally {
    elements.importInput.value = "";
  }
}

function syncColorFromPicker() {
  elements.canvasBackgroundText.value = elements.canvasBackground.value.toUpperCase();
  scheduleSave();
}

function syncColorFromText() {
  const value = elements.canvasBackgroundText.value.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    elements.canvasBackground.value = value;
    scheduleSave();
  }
}

function bindEvents() {
  elements.newProjectButton.addEventListener("click", createProject);
  elements.emptyCreateButton.addEventListener("click", createProject);
  elements.exportButton.addEventListener("click", exportCurrent);
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", () => importBundle(elements.importInput.files[0]));
  elements.referenceInput.addEventListener("change", () => uploadReference(elements.referenceInput.files[0]));
  for (const field of [
    elements.projectName,
    elements.projectSummary,
    elements.projectAppearance,
    elements.canvasWidth,
    elements.canvasHeight,
    elements.basePrompt,
  ]) {
    field.addEventListener("input", scheduleSave);
    field.addEventListener("change", scheduleSave);
  }
  elements.canvasBackground.addEventListener("input", syncColorFromPicker);
  elements.canvasBackgroundText.addEventListener("input", syncColorFromText);
  elements.chromaThreshold.addEventListener("input", () => {
    elements.thresholdValue.textContent = elements.chromaThreshold.value;
    scheduleSave();
  });
  elements.chromaSoftness.addEventListener("input", () => {
    elements.softnessValue.textContent = elements.chromaSoftness.value;
    scheduleSave();
  });
  elements.chromaDespill.addEventListener("input", () => {
    elements.despillValue.textContent = `${elements.chromaDespill.value}%`;
    scheduleSave();
  });
  elements.normalizeButton.addEventListener("click", normalizeReference);
  elements.removeChromaButton.addEventListener("click", removeGreenScreen);
  elements.deleteAssetButton.addEventListener("click", deleteCurrentAsset);
  elements.deleteGeneratedAssetButton.addEventListener("click", deleteCurrentGeneratedAsset);
  elements.deleteProjectButton.addEventListener("click", deleteCurrentProject);
  document.querySelectorAll("[data-generate]").forEach((button) => {
    button.addEventListener("click", () => generateFromCard(button));
  });
  elements.copyPromptButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(elements.basePrompt.value);
      showToast("基准图提示词已复制");
    } catch {
      elements.basePrompt.select();
      showToast("已选中提示词，请手动复制");
    }
  });
  for (const eventName of ["dragenter", "dragover"]) {
    elements.uploadStage.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.uploadStage.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.uploadStage.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.uploadStage.classList.remove("dragging");
    });
  }
  elements.uploadStage.addEventListener("drop", (event) => uploadReference(event.dataTransfer.files[0]));
}

async function initialize() {
  bindEvents();
  try {
    await refreshProjects(false);
    if (state.projects.length) {
      await selectProject(state.projects[0].id);
    } else {
      renderCurrent();
      setSaveState("", "尚未创建角色");
    }
  } catch (error) {
    setSaveState("", "工作台载入失败");
    showToast(error.message, "error");
  }
}

initialize();
