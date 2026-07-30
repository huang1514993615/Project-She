import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStudioStore, STUDIO_SCHEMA } from "../server/studio-store.mjs";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("studio store persists project metadata and uploaded reference images", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "character-studio-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const store = createStudioStore({ rootDir });
  const created = await store.createProject({
    name: "月影",
    appearance: "紫色长发，银色发饰，黑紫色长裙。",
  });
  assert.match(created.id, /^role-/);
  assert.equal(created.processing.chromaColor, "#00FF00");
  const updated = await store.updateProject(created.id, {
    ...created,
    summary: "安静可靠的成年魔法师",
  });
  assert.equal(updated.summary, "安静可靠的成年魔法师");

  const uploaded = await store.addAsset(created.id, {
    group: "reference",
    name: "master.png",
    variant: "source",
    width: 1024,
    height: 1536,
    dataUrl: onePixelPng,
  });
  assert.equal(uploaded.project.assets.reference.length, 1);
  assert.equal(uploaded.asset.width, 1024);
  assert.equal(uploaded.asset.variant, "source");
  assert.equal(
    await readFile(store.resolveAsset(created.id, "reference", uploaded.asset.filename), "base64"),
    onePixelPng.split(",")[1],
  );

  const listed = await store.listProjects();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].assetCount, 1);
  assert.equal(listed[0].thumbnail, uploaded.asset.url);
  const deleted = await store.deleteAsset(created.id, uploaded.asset.id);
  assert.equal(deleted.asset.id, uploaded.asset.id);
  assert.equal(deleted.project.assets.reference.length, 0);
  const trashFiles = await readdir(path.join(rootDir, created.id, ".trash"));
  assert.equal(
    await readFile(path.join(rootDir, created.id, ".trash", trashFiles[0]), "base64"),
    onePixelPng.split(",")[1],
  );
});

test("studio bundle export and import creates an independent copy", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "character-studio-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const store = createStudioStore({ rootDir });
  const source = await store.createProject({ name: "角色甲" });
  await store.addAsset(source.id, {
    group: "reference",
    name: "master.png",
    dataUrl: onePixelPng,
  });

  const bundle = await store.exportProject(source.id);
  assert.equal(bundle.schema, `${STUDIO_SCHEMA}-bundle`);
  assert.equal(bundle.assets.length, 1);
  const imported = await store.importProject(bundle);
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.name, "角色甲 · 导入");
  assert.equal(imported.assets.reference.length, 1);
  assert.equal((await store.listProjects()).length, 2);
});

test("processed variants replace older output and projects move to a recoverable trash folder", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "character-studio-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const store = createStudioStore({ rootDir });
  const project = await store.createProject({ name: "Replace test" });
  await store.addAsset(project.id, {
    group: "processed",
    variant: "transparent",
    replaceVariant: true,
    name: "first.png",
    dataUrl: onePixelPng,
  });
  const replaced = await store.addAsset(project.id, {
    group: "processed",
    variant: "transparent",
    replaceVariant: true,
    name: "second.png",
    dataUrl: onePixelPng,
  });
  assert.equal(replaced.project.assets.processed.length, 1);
  assert.equal(replaced.project.assets.processed[0].name, "second.png");
  assert.equal((await readdir(path.join(rootDir, project.id, ".trash"))).length, 1);

  const deleted = await store.deleteProject(project.id);
  assert.equal(deleted.project.id, project.id);
  assert.equal((await store.listProjects()).length, 0);
  const trashProjects = await readdir(path.join(rootDir, ".trash-projects"));
  assert.equal(trashProjects.length, 1);
  assert.match(trashProjects[0], new RegExp(`${project.id}$`));
});
