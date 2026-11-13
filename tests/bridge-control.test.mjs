import test from "node:test";
import assert from "node:assert/strict";
import { controlBridge, createBridgeControlTool } from "../lib/bridge-control.mjs";

test("route and tool share bridge lifecycle with a private URL", async () => {
  let origin;
  const controller = {
    start: async () => origin ??= "http://127.0.0.1:12345/?token=example",
    stop: async () => { origin = undefined; },
    origin: () => origin,
  };
  const tool = createBridgeControlTool(() => controller);
  assert.deepEqual(await tool.execute({}), { ok: true, running: false });
  const started = await tool.execute({ action: "start" });
  assert.equal(started.running, true);
  assert.equal(started.origin, origin);
  assert.deepEqual(await controlBridge(controller, { action: "status" }), started);
  assert.deepEqual(await controlBridge(controller, { action: "stop" }), { ok: true, running: false });
  assert.deepEqual(await tool.execute({ action: "status" }), { ok: true, running: false });
  await assert.rejects(tool.execute({ action: "delete" }), /Unknown bridge action/);
});
