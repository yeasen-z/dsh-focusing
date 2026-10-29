// Templates: three shipped, any number of your own, kept on disk. A template is
// only words plus a range, so generating from one is the same path as typed text.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTemplateStore, BUILTIN_TEMPLATES, normalizeTemplate } from "../lib/template-store.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "focusing-tpl-")));
after(() => { if (dir.startsWith(realpathSync(tmpdir()))) rmSync(dir, { recursive: true, force: true }); });

test("the shipped templates come first and cannot be changed", async () => {
  const store = createTemplateStore({ file: join(dir, "a.json") });
  const list = await store.list();
  assert.deepEqual(list.slice(0, 3).map(t => t.id), ["builtin:weekly", "builtin:daily", "builtin:handoff"]);
  assert.ok(list.every(t => t.builtin));
  assert.equal((await store.update("builtin:weekly", { name: "x", instruction: "y" })).reason, "read-only");
  assert.equal((await store.remove("builtin:daily")).reason, "read-only");
  assert.equal((await store.list()).length, 3, "nothing was removed");
  // The handoff one needs a session, so it is not runnable from the list.
  assert.equal(list.find(t => t.id === "builtin:handoff").needsSession, true);
});

test("a template of your own is saved, survives a restart, and can be edited and deleted", async () => {
  const file = join(dir, "b.json");
  const one = createTemplateStore({ file });
  const made = await one.create({ name: "  发布复盘  ", instruction: "总结本周发布相关的改动、风险和阻塞", range: "this-week" });
  assert.equal(made.ok, true);
  assert.equal(made.template.name, "发布复盘", "trimmed");
  assert.match(made.template.id, /^tpl-/);

  const two = createTemplateStore({ file });                  // a fresh process
  const saved = (await two.list()).at(-1);
  assert.equal(saved.name, "发布复盘");
  assert.equal(saved.range, "this-week");

  const edited = await two.update(saved.id, { name: "发布复盘 v2", instruction: "只看风险", range: "" });
  assert.equal(edited.ok, true);
  assert.equal((await createTemplateStore({ file }).list()).at(-1).name, "发布复盘 v2");
  assert.equal(edited.template.range, "", "auto is stored as empty");

  assert.equal((await two.remove(saved.id)).ok, true);
  assert.deepEqual((await createTemplateStore({ file }).list()).map(t => t.id), BUILTIN_TEMPLATES.map(t => t.id));
});

test("a template with no name or no instruction is refused, and so is an unknown range", () => {
  assert.equal(normalizeTemplate({ name: "", instruction: "x" }).reason, "bad-request");
  assert.equal(normalizeTemplate({ name: "x", instruction: "  " }).reason, "bad-request");
  assert.equal(normalizeTemplate({ name: "x".repeat(41), instruction: "y" }).reason, "bad-request");
  assert.equal(normalizeTemplate({ name: "x", instruction: "y".repeat(2001) }).reason, "bad-request");
  assert.equal(normalizeTemplate({ name: "x", instruction: "y", range: "session" }).reason, "bad-request");
  assert.equal(normalizeTemplate({ name: "x", instruction: "y", range: "" }).ok, true);
  assert.equal(normalizeTemplate({ name: "x", instruction: "y", range: "today" }).ok, true);
});

test("the template list is bounded", async () => {
  const store = createTemplateStore({ file: join(dir, "c.json") });
  for (let i = 0; i < 52; i++) await store.create({ name: `t${i}`, instruction: "i" });
  assert.equal((await store.list()).length, 53, "50 of mine plus the three shipped");
});
