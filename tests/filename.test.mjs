import test from "node:test";
import assert from "node:assert/strict";
import { exportDisposition, safeFileStem, fileStamp } from "../lib/filename.mjs";
import { sessionMetadata, isListable, createPanelMetadata } from "../lib/panel-data.mjs";

// A fixed instant keeps the tests independent of the machine clock.
const at = new Date(2026, 9, 26, 14, 5).getTime();

test("a Chinese chat title becomes a readable download name", () => {
  const header = exportDisposition({ title: "修复登录问题", at, format: "md" });
  assert.match(header, /^attachment; /);
  assert.match(header, /filename\*=UTF-8''/);
  // The RFC 5987 form is what browsers actually honour for non-ASCII names.
  const encoded = header.split("filename*=UTF-8''")[1];
  assert.equal(decodeURIComponent(encoded), "修复登录问题-20261026-1405.md");
});

test("path separators and control characters cannot shape a file path", () => {
  assert.equal(safeFileStem("a/b\\c:d*e?f\"g<h>i|j"), "a b c d e f g h i j");
  assert.equal(safeFileStem("line\nbreak\u0000name"), "line break name");
  assert.equal(safeFileStem("trailing dots..."), "trailing dots");
  assert.equal(safeFileStem("   "), "");
});

test("a very long title is bounded so the download stays usable", () => {
  const stem = safeFileStem("x".repeat(300));
  assert.ok(stem.length <= 80, `stem was ${stem.length} characters`);
});

test("a nameless chat still produces a valid name and extension", () => {
  const md = exportDisposition({ title: "", at, format: "md" });
  assert.match(decodeURIComponent(md.split("filename*=UTF-8''")[1]), /^conversation-\d{8}-\d{4}\.md$/);
  const json = exportDisposition({ title: "Chat", at, format: "json" });
  assert.match(decodeURIComponent(json.split("filename*=UTF-8''")[1]), /\.json$/);
});

test("the ASCII fallback never contains a raw quote or non-ASCII byte", () => {
  const header = exportDisposition({ title: 'Report "final" 报告', at, format: "md" });
  const ascii = /filename="([^"]*)"/.exec(header)[1];
  assert.equal(ascii.replace(/[^\x20-\x7e]/g, ""), ascii);
  assert.doesNotMatch(ascii, /["\\]/);
});

test("the date stamp follows local time so two exports do not collide", () => {
  assert.equal(fileStamp(new Date(2026, 0, 2, 3, 4).getTime()), "20260102-0304");
});

test("a session with neither a name nor a message is not listable", () => {
  const empty = createPanelMetadata("shell");
  assert.equal(isListable(empty), false, "an agent shell must not appear as a chat");
  assert.equal(sessionMetadata(empty).untitled, true);

  const named = createPanelMetadata("named");
  named.title = "Real title";
  assert.equal(isListable(named), true);

  const spoken = createPanelMetadata("spoken");
  spoken.startedConversation = true;
  assert.equal(isListable(spoken), true, "a conversation the person started is always shown");
});
