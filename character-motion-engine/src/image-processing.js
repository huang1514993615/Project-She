function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function parseHexColor(value, fallback = [0, 255, 0]) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || "").trim());
  if (!match) return [...fallback];
  const integer = Number.parseInt(match[1], 16);
  return [
    (integer >> 16) & 255,
    (integer >> 8) & 255,
    integer & 255,
  ];
}

export function calculateContainRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceW = Math.max(1, Number(sourceWidth) || 1);
  const sourceH = Math.max(1, Number(sourceHeight) || 1);
  const targetW = Math.max(1, Number(targetWidth) || 1);
  const targetH = Math.max(1, Number(targetHeight) || 1);
  const scale = Math.min(targetW / sourceW, targetH / sourceH);
  const width = sourceW * scale;
  const height = sourceH * scale;
  return {
    x: (targetW - width) / 2,
    y: (targetH - height) / 2,
    width,
    height,
    scale,
  };
}

export function chromaAlpha(red, green, blue, target, threshold = 42, softness = 96) {
  const [targetRed, targetGreen, targetBlue] = target;
  const distance = Math.hypot(
    red - targetRed,
    green - targetGreen,
    blue - targetBlue,
  );
  const hardEdge = clamp(threshold, 0, 255);
  const feather = Math.max(1, clamp(softness, 1, 255));
  return clamp((distance - hardEdge) / feather, 0, 1);
}

export function removeChromaFromPixels(
  pixels,
  {
    color = "#00FF00",
    threshold = 42,
    softness = 96,
    despill = 0.72,
  } = {},
) {
  const target = parseHexColor(color);
  const strength = clamp(despill, 0, 1);
  let transparentPixels = 0;
  let featheredPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const originalAlpha = pixels[index + 3];
    const visibility = chromaAlpha(red, green, blue, target, threshold, softness);
    const alpha = Math.round(originalAlpha * visibility);
    if (alpha === 0) transparentPixels += 1;
    else if (alpha < originalAlpha) featheredPixels += 1;
    if (strength > 0) {
      const neutralGreen = Math.max(red, blue);
      const greenDominance = Math.max(0, green - neutralGreen);
      const spillSignal = clamp((greenDominance - 3) / 92, 0, 1);
      const edgeSignal = Math.max(1 - visibility, spillSignal);
      pixels[index + 1] = Math.round(green + (neutralGreen - green) * edgeSignal * strength);
    }
    pixels[index + 3] = alpha;
  }
  return {
    pixels,
    transparentPixels,
    featheredPixels,
  };
}
