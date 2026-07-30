const MAX_JSON_SOURCE_LENGTH = 200_000;

function normalizeSource(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .slice(0, MAX_JSON_SOURCE_LENGTH)
    .trim();
}

function collectFencedBlocks(source) {
  const blocks = [];
  const pattern = /```(?:json|JSON|javascript|js)?[ \t]*\r?\n?([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(source))) {
    const value = String(match[1] || "").trim();
    if (value) blocks.push(value);
  }
  return blocks;
}

function collectBalancedSegments(source) {
  const segments = [];
  let start = -1;
  let quote = "";
  let escaped = false;
  const stack = [];

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "\"" && stack.length) {
      quote = character;
      continue;
    }
    if (character === "{" || character === "[") {
      if (!stack.length) start = index;
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;
    const expected = character === "}" ? "{" : "[";
    if (!stack.length || stack[stack.length - 1] !== expected) {
      stack.length = 0;
      start = -1;
      continue;
    }
    stack.pop();
    if (!stack.length && start >= 0) {
      segments.push(source.slice(start, index + 1));
      start = -1;
    }
  }
  return segments;
}

function repairJsonCandidate(value) {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (const character of String(value || "")) {
    if (inString) {
      if (escaped) {
        repaired += character;
        escaped = false;
      } else if (character === "\\") {
        repaired += character;
        escaped = true;
      } else if (character === "\"") {
        repaired += character;
        inString = false;
      } else if (character === "\n") {
        repaired += "\\n";
      } else if (character === "\r") {
        repaired += "\\r";
      } else if (character === "\t") {
        repaired += "\\t";
      } else {
        repaired += character;
      }
      continue;
    }
    if (character === "\"") {
      repaired += character;
      inString = true;
    } else if (character === "：") {
      repaired += ":";
    } else if (character === "，") {
      repaired += ",";
    } else {
      repaired += character;
    }
  }

  let withoutTrailingCommas = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < repaired.length; index += 1) {
    const character = repaired[index];
    if (inString) {
      withoutTrailingCommas += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      withoutTrailingCommas += character;
      inString = true;
      continue;
    }
    if (character === ",") {
      let cursor = index + 1;
      while (cursor < repaired.length && /\s/.test(repaired[cursor])) cursor += 1;
      if (repaired[cursor] === "}" || repaired[cursor] === "]") continue;
    }
    withoutTrailingCommas += character;
  }
  return withoutTrailingCommas;
}

function tryParseCandidate(candidate) {
  try {
    return JSON.parse(candidate);
  } catch {}
  const repaired = repairJsonCandidate(candidate);
  if (repaired === candidate) return undefined;
  try {
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}

function matchesKind(value, kind) {
  if (kind === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (kind === "array") return Array.isArray(value);
  return value !== undefined;
}

export function parseLooseJsonValue(value, options = {}) {
  if (value && typeof value === "object") {
    return matchesKind(value, options.kind || "any")
      && (!options.validate || options.validate(value))
      ? value
      : null;
  }
  const source = normalizeSource(value);
  if (!source) return null;
  const candidates = [
    source,
    ...collectFencedBlocks(source),
    ...collectBalancedSegments(source),
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const parsed = tryParseCandidate(normalized);
    if (!matchesKind(parsed, options.kind || "any")) continue;
    if (options.validate && !options.validate(parsed)) continue;
    return parsed;
  }
  return null;
}

export function parseLooseJsonObject(value, validate) {
  return parseLooseJsonValue(value, { kind: "object", validate });
}

export function parseLooseJsonArray(value, validate) {
  return parseLooseJsonValue(value, { kind: "array", validate });
}
