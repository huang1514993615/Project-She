import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Night Mailbox application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>夜航信箱｜AI 陪伴<\/title>/i);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/i);
  assert.match(html, /name="theme-color" content="#171925"/i);
});

test("keeps chat history locally and reserves mobile navigation space", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/VueGirlfriend.jsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /saved\?\.messages/);
  assert.match(component, /tasks:\s*this\.tasks,\s*messages,/);
  assert.match(component, /\.slice\(-120\)/);
  assert.match(component, /this\.persist\(\);\s*this\.scrollBottom\(\);/);
  assert.match(component, /clearConversation\(\)/);
  assert.match(component, /对话仅保存在本机/);
  assert.match(
    css,
    /\.chat-panel\s*\{[^}]*padding-bottom:\s*calc\(62px \+ env\(safe-area-inset-bottom\)\)/s,
  );
});
