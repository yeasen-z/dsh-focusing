#!/usr/bin/env node
// Run the independent local Focusing workbench: node lib/standalone.mjs serve
import { startStandaloneServer } from "./standalone-server.mjs";
import { defaultDataDir } from "./standalone-app.mjs";

function usage() {
  console.log(`Focusing standalone workbench

Usage:
  focusing serve [--host 127.0.0.1] [--port 8765] [--data-dir ~/.focusing]
  node lib/standalone.mjs [--port 0]

Options:
  --host       Loopback hostname/address only (default: 127.0.0.1)
  --port       HTTP port; 0 selects a free port (default: 8765)
  --data-dir   Independent settings/index directory (default: ~/.focusing)

Environment:
  FOCUSING_DATA_DIR, FOCUSING_HOST, FOCUSING_PORT, CODEX_HOME, CLAUDE_CONFIG_DIR
`);
}

const args = process.argv.slice(2);
if (args[0] === "serve") args.shift();
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}
const options = {};
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (!["--host", "--port", "--data-dir"].includes(key) || i + 1 >= args.length) {
    console.error(`Unknown or incomplete option: ${key}`);
    usage();
    process.exit(2);
  }
  options[key] = args[++i];
}

const running = await startStandaloneServer({
  host: options["--host"] ?? process.env.FOCUSING_HOST ?? "127.0.0.1",
  port: options["--port"] ?? process.env.FOCUSING_PORT ?? 8765,
  dataDir: options["--data-dir"] ?? process.env.FOCUSING_DATA_DIR ?? defaultDataDir(),
  codexHome: process.env.DSH_FOCUSING_CODEX_HOME,
  claudeHome: process.env.DSH_FOCUSING_CLAUDE_HOME,
  logger: (...args) => console.warn(...args),
});
console.log(`FOCUSING_URL=${running.origin}`);
console.log(`FOCUSING_DATA_DIR=${options["--data-dir"] ?? process.env.FOCUSING_DATA_DIR ?? defaultDataDir()}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try { await running.close(); process.exit(0); }
  catch (error) { console.error(error); process.exit(1); }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
