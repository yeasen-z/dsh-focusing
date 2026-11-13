// Mount the existing Focusing HTTP handlers against a standalone route table.
// Only native DSH services are stubbed; all context/report/model code is shared.

import { registerContextRoutes } from "./context-routes.mjs";
import { registerRoomRoutes } from "./room-routes.mjs";

export function mountStandaloneRoutes({ settingsStore, runtime, modelGateway, dataDir, logger, serviceOverrides = {} }) {
  const routes = new Map();
  const disposers = [];
  const services = {
    agents: { list: () => [], get: () => undefined },
    sessions: { list: () => [], get: () => undefined },
    sessionPersistence: { list: async () => [] },
    sessionQuery: { readSession: async () => undefined },
    sessionTitle: { get: () => undefined },
    agentDefaultModel: { currentSelection: () => null },
    llm: undefined,
    ...serviceOverrides,
  };
  const child = {
    get: name => services[name],
    effect: fn => {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
      return dispose;
    },
    connection: { fetch: { register: route => { routes.set(route.path, route); return () => {}; } } },
  };
  let source;
  registerContextRoutes(child, {
    settingsStore,
    digestFile: `${dataDir}/digests.json`,
    activityFile: `${dataDir}/activity-index.json`,
    logger,
    codexRecords: () => runtime.records("codex"),
    claudeRecords: () => runtime.records("claude"),
    codexChats: async () => runtime.chats("codex"),
    claudeChats: async () => runtime.chats("claude"),
    onContextSource: value => { source = value; },
    modelGateway,
  });
  registerRoomRoutes(child, {
    settingsStore,
    roomsFile: `${dataDir}/rooms.json`,
    logger,
    modelGateway,
  });
  return {
    routes,
    source: () => source,
    close: async () => {
      const pending = disposers.splice(0).reverse();
      for (const dispose of pending) await dispose();
    },
  };
}
