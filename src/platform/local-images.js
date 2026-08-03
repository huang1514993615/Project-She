const sourceCache = new Map();
const elementTokens = new WeakMap();
const MAX_CACHE_ITEMS = 24;

/** Detects asset and native-file references that a normal <img> cannot read directly. */
export function isLocalImageReference(value) {
  return /^(?:asset:\/\/|file:|content:|\/storage\/|\/data\/|_(?:doc|downloads?)\/)/i
    .test(String(value || "").trim());
}

function remember(cacheKey, promise) {
  if (sourceCache.has(cacheKey)) sourceCache.delete(cacheKey);
  sourceCache.set(cacheKey, promise);
  while (sourceCache.size > MAX_CACHE_ITEMS) sourceCache.delete(sourceCache.keys().next().value);
  return promise;
}

/** Resolves a stored reference to a temporary browser-displayable URL. */
export function resolveLocalImageSource(source, thumbnail = false) {
  if (!isLocalImageReference(source) || !window.__NIGHT_MAILBOX_NATIVE_IMAGE__?.resolvePreviewSource) {
    return Promise.resolve(source);
  }
  const cacheKey = `${thumbnail ? "thumbnail" : "full"}:${source}`;
  const cached = sourceCache.get(cacheKey);
  if (cached) {
    sourceCache.delete(cacheKey);
    sourceCache.set(cacheKey, cached);
    return cached;
  }
  const nativeImages = window.__NIGHT_MAILBOX_NATIVE_IMAGE__;
  const resolver = thumbnail && nativeImages.resolveThumbnailSource
    ? nativeImages.resolveThumbnailSource.bind(nativeImages)
    : nativeImages.resolvePreviewSource.bind(nativeImages);
  const request = resolver(source).catch((error) => {
    sourceCache.delete(cacheKey);
    throw error;
  });
  return remember(cacheKey, request);
}

function renderImageElement(element, value) {
  const options = value && typeof value === "object" ? value : { src: value };
  const source = String(options.src || "").trim();
  const token = Symbol("local-image");
  elementTokens.set(element, token);
  if (!source || !isLocalImageReference(source)) return;
  resolveLocalImageSource(source, options.thumbnail === true)
    .then((resolved) => {
      if (elementTokens.get(element) !== token || !resolved) return;
      element.src = resolved;
      element.dataset.localImageReady = "true";
    })
    .catch(() => {
      if (elementTokens.get(element) === token) element.dataset.localImageReady = "false";
    });
}

/** Vue 2 directive used by avatars, thumbnails and full-size previews. */
export const localImageDirective = {
  inserted(element, binding) {
    renderImageElement(element, binding.value);
  },
  update(element, binding) {
    const value = binding.value && typeof binding.value === "object" ? binding.value : { src: binding.value };
    const oldValue = binding.oldValue && typeof binding.oldValue === "object" ? binding.oldValue : { src: binding.oldValue };
    if (value.src !== oldValue.src || value.thumbnail !== oldValue.thumbnail) renderImageElement(element, binding.value);
  },
  unbind(element) {
    elementTokens.delete(element);
  },
};
