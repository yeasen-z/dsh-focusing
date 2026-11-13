// One operation shared by the authenticated Host route and the agent tool.
export async function controlBridge(controller, { action = "status", host, port } = {}) {
  if (action === "start") {
    const origin = await controller.start({ host, port });
    return { ok: true, running: true, origin };
  }
  if (action === "stop") {
    await controller.stop();
    return { ok: true, running: false };
  }
  if (action === "status") {
    const origin = controller.origin();
    return { ok: true, running: !!origin, ...(origin ? { origin } : {}) };
  }
  throw new Error("Unknown bridge action");
}

export function createBridgeControlTool(controller) {
  return {
    name: "focusing_web",
    description: "Start, stop, or inspect the local Focusing web page connected to DSH sessions and models. Start returns a private access URL for this computer; stopping closes the web listener without deleting history.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "start", "stop"], description: "Operation to perform; defaults to status." },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, running: { type: "boolean" }, origin: { type: "string" } }, required: ["ok", "running"], additionalProperties: false },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    execute: async args => controlBridge(controller(), args),
  };
}
