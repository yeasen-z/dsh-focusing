// One-shot model gateway shared by reports, rooms, review and connection tests.
// Transports remain injected ports: a Host llm implementation for "dsh", or an
// OpenAI-compatible fetch implementation for "external". No Cordis lookup here.

import { complete } from "./complete.mjs";
import { runReview, testConnection } from "./review.mjs";

export function createModelGateway({ settingsStore, llm, resolveRoute, fetchImpl } = {}) {
  if (!settingsStore?.get) throw new Error("The model gateway needs a settings store");

  function defaults(request = {}) {
    return {
      ...request,
      settings: request.settings ?? settingsStore.get(),
      llm: request.llm ?? (typeof llm === "function" ? llm() : llm),
      resolveRoute: request.resolveRoute ?? resolveRoute,
      fetchImpl: request.fetchImpl ?? fetchImpl,
    };
  }

  return {
    /** One generic text completion (digest, follow-up, room participant). */
    complete: request => complete(defaults(request)),
    /** One NORMAL/STUCK review through the selected transport. */
    review: request => runReview(defaults(request)),
    /** A trivial reachability probe with no session content. */
    test: (settings = settingsStore.get()) => testConnection(defaults({ settings })),
    /** Derive a gateway with a session-specific Host route or another port. */
    with(overrides = {}) {
      return createModelGateway({
        settingsStore,
        llm: overrides.llm ?? llm,
        resolveRoute: overrides.resolveRoute ?? resolveRoute,
        fetchImpl: overrides.fetchImpl ?? fetchImpl,
      });
    },
  };
}
