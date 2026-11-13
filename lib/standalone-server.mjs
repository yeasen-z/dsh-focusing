// Local-only HTTP adapter for the independent Focusing application.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createStandaloneApp, defaultDataDir } from "./standalone-app.mjs";

const CONTENT_TYPES = {
  "/": ["text/html; charset=utf-8", "index.html"],
  "/standalone-shell.js": ["text/javascript; charset=utf-8", "standalone-shell.js"],
  "/standalone-boot.js": ["text/javascript; charset=utf-8", "standalone-boot.js"],
  "/focusing-client.js": ["text/javascript; charset=utf-8", "../lib/client.js"],
  "/theme.css": ["text/css; charset=utf-8", "theme.css"],
  "/icon.svg": ["image/svg+xml", "icon.svg"],
  "/vendor/preact.umd.js": ["text/javascript; charset=utf-8", "vendor/preact.umd.js"],
  "/vendor/preact-hooks.umd.js": ["text/javascript; charset=utf-8", "vendor/preact-hooks.umd.js"],
  "/vendor/preact-compat.umd.js": ["text/javascript; charset=utf-8", "vendor/preact-compat.umd.js"],
  "/vendor/PREACT-LICENSE.txt": ["text/plain; charset=utf-8", "vendor/PREACT-LICENSE.txt"],
};
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

async function sendFetchResponse(response, fetchResponse) {
  const body = Buffer.from(await fetchResponse.arrayBuffer());
  response.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers));
  response.end(body);
}

async function asFetchRequest(request, limit = 65536) {
  const chunks = [];
  let size = 0;
  if (request.method !== "GET" && request.method !== "HEAD") {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > limit) throw new Error("Request body is too large");
      chunks.push(chunk);
    }
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  return new Request(`http://${request.headers.host || "localhost"}${request.url}`, {
    method: request.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
    signal: controller.signal,
  });
}

async function bodyJson(request, limit = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function trustedRequest(request, expectedPort) {
  // Binding to loopback is not enough: a malicious domain can re-resolve to
  // 127.0.0.1 and make Origin and Host agree. Both must be independently
  // constrained to the actual loopback listener and its exact port.
  const header = String(request.headers.host ?? "").toLowerCase();
  const match = /^(\[[0-9a-f:.]+\]|[^/\s:]+)(?::(\d+))?$/.exec(header);
  if (!match) return false;
  const hostname = match[1].replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTNAMES.has(hostname) || Number(match[2] ?? 80) !== expectedPort) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const originHostname = parsed.hostname.replace(/^\[|\]$/g, "");
    return parsed.protocol === "http:"
      && parsed.host.toLowerCase() === header
      && LOOPBACK_HOSTNAMES.has(originHostname)
      && Number(parsed.port || 80) === expectedPort;
  } catch { return false; }
}

/**
 * Start a loopback-only independent server. Port 0 selects a free port.
 * Returns the exact origin plus a close() that drains all source indexes.
 */
export async function startStandaloneServer({
  host = "127.0.0.1", port = 0, dataDir = defaultDataDir(),
  codexHome, claudeHome, logger = () => {}, app, onRequest,
} = {}) {
  if (!LOOPBACK.has(host)) throw new Error("The standalone MVP is loopback-only: use 127.0.0.1, ::1 or localhost");
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 0 || numericPort > 65535) throw new Error("Invalid port");
  const application = app ?? createStandaloneApp({ dataDir, codexHome, claudeHome, logger });
  const webDir = fileURLToPath(new URL("../web/", import.meta.url));

  const server = createServer(async (request, response) => {
    try {
      if (!trustedRequest(request, server.address().port)) return json(response, 403, { ok: false, reason: "untrusted-host-or-origin" });
      const intercepted = await onRequest?.(request);
      if (intercepted) return await sendFetchResponse(response, intercepted);
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      const params = Object.fromEntries(url.searchParams);
      params.tags = url.searchParams.getAll("tag");

      if (url.pathname === "/api/v1/health" && request.method === "GET") {
        return json(response, 200, { ok: true, service: "dsh-focusing", version: 1 });
      }
      if (url.pathname === "/api/v1/capabilities" && request.method === "GET") {
        return json(response, 200, { ok: true, capabilities: application.capabilities() });
      }
      if (url.pathname === "/api/v1/sources" && request.method === "GET") {
        return json(response, 200, { ok: true, sources: await application.sources() });
      }
      if (url.pathname === "/api/v1/settings" && (request.method === "GET" || request.method === "POST")) {
        const body = request.method === "POST" ? await bodyJson(request) : undefined;
        const result = await application.settings(body?.settings ?? body);
        return json(response, 200, { ok: true, ...result });
      }
      if (url.pathname === "/api/v1/tags" && request.method === "GET") {
        return json(response, 200, { ok: true, tags: await application.tags(params) });
      }
      if (url.pathname === "/api/v1/workspace/action" && request.method === "POST") {
        if (typeof application.workspaceAction !== "function") return json(response, 501, { ok: false, reason: "bridge-unavailable" });
        return json(response, 200, { ok: true, ...(await application.workspaceAction(await bodyJson(request))) });
      }
      if (url.pathname === "/api/v1/sessions" && request.method === "GET") {
        return json(response, 200, { ok: true, ...(await application.sessions(params)) });
      }
      const eventMatch = /^\/api\/v1\/sessions\/([^/]+)\/events$/.exec(url.pathname);
      if (eventMatch && request.method === "GET") {
        const result = await application.events(decodeURIComponent(eventMatch[1]), params);
        return result ? json(response, 200, { ok: true, ...result }) : json(response, 404, { ok: false, reason: "no-session" });
      }
      const sessionMatch = /^\/api\/v1\/sessions\/([^/]+)$/.exec(url.pathname);
      if (sessionMatch && request.method === "GET") {
        const result = await application.session(decodeURIComponent(sessionMatch[1]), params);
        return result ? json(response, 200, { ok: true, ...result }) : json(response, 404, { ok: false, reason: "no-session" });
      }
      if (url.pathname === "/api/v1/activity" && request.method === "GET") {
        return json(response, 200, { ok: true, ...(await application.activity(params)) });
      }
      if (url.pathname === "/api/dsh-focusing.state" && request.method === "GET") {
        return json(response, 200, await application.focusState(params.session));
      }
      if (url.pathname === "/api/dsh-focusing.settings" && (request.method === "GET" || request.method === "POST")) {
        const body = request.method === "POST" ? await bodyJson(request) : undefined;
        return json(response, 200, { ok: true, ...(await application.pluginSettings(body?.settings ?? body, body?.test === true)) });
      }
      if (url.pathname === "/api/dsh-focusing.models" && request.method === "GET") {
        return json(response, 200, await application.models());
      }
      if (url.pathname === "/api/dsh-focusing.external-models" && (request.method === "GET" || request.method === "POST")) {
        const body = request.method === "POST" ? await bodyJson(request) : {};
        const result = await application.externalModels(body);
        return json(response, 200, result);
      }
      if (url.pathname === "/api/dsh-focusing.preview" && request.method === "GET") {
        const result = await application.preview(params.session);
        return result ? json(response, 200, { ok: true, ...result }) : json(response, 404, { ok: false, reason: "no-session" });
      }
      if (url.pathname === "/api/dsh-focusing.analyze" && request.method === "POST") {
        const body = await bodyJson(request);
        return json(response, 200, await application.analyze(body.session));
      }
      if (url.pathname === "/api/dsh-focusing.export" && request.method === "GET") {
        const result = await application.exportSession(params.session, params.format || "md");
        if (!result) return json(response, 404, { ok: false, reason: "no-session" });
        response.writeHead(200, {
          "content-type": result.contentType,
          "content-disposition": result.disposition,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        return response.end(result.body);
      }
      const pluginRoute = application.routes.get(url.pathname);
      if (pluginRoute && (!pluginRoute.methods || pluginRoute.methods.includes(request.method))) {
        return await sendFetchResponse(response, await pluginRoute.fetch(await asFetchRequest(request)));
      }
      if (url.pathname.startsWith("/api/")) return json(response, 404, { ok: false, reason: "not-found" });

      const asset = CONTENT_TYPES[url.pathname];
      if (!asset || (request.method !== "GET" && request.method !== "HEAD")) {
        return json(response, 404, { ok: false, reason: "not-found" });
      }
      const [contentType, filename] = asset;
      const content = readFileSync(`${webDir}${filename}`);
      response.writeHead(200, {
        "content-type": contentType,
        "content-length": content.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'",
      });
      if (request.method === "HEAD") response.end();
      else response.end(content);
    } catch (error) {
      const message = String(error?.message ?? error);
      const clientError = error instanceof SyntaxError || error instanceof URIError
        || /Settings must be an object|Unknown session source|Tags must|Tag value|Invalid JSON/i.test(message);
      const status = message === "Request body is too large" ? 413 : clientError ? 400 : 500;
      if (!response.headersSent) json(response, status, { ok: false, reason: status === 500 ? "failed" : "bad-request", detail: message.slice(0, 400) });
      else response.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(numericPort, host, resolve);
  });
  const address = server.address();
  const actualHost = typeof address === "object" && address?.address === "::1" ? "[::1]" : host;
  const origin = `http://${actualHost}:${address.port}`;
  let closing;
  return {
    app: application,
    server,
    origin,
    host,
    port: address.port,
    close: () => closing ??= (async () => {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await application.close();
    })(),
  };
}
