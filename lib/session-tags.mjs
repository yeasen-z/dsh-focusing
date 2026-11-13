// Canonical session tags shared by records, reports and conversations.
// Tag ids are stable strings; presentation labels are derived separately.

export function normalizeWorkspace(cwd) {
  const value = String(cwd ?? "").trim().replace(/\\/g, "/");
  if (!value || value === "/") return value;
  return value.replace(/\/+$/, "");
}

export function workspaceProject(cwd) {
  const normalized = normalizeWorkspace(cwd);
  return normalized.split("/").filter(Boolean).at(-1) || (normalized === "/" ? "/" : "");
}

const SOURCE_LABELS = { dsh: "DSH", codex: "Codex", claude: "Claude Code" };

/** Stable tag ids for one session: source, project and exact workspace. */
export function sessionTags({ source = "dsh", cwd = "", project = "" } = {}) {
  const tags = [`source:${source || "dsh"}`];
  const workspace = normalizeWorkspace(cwd);
  const projectName = String(project || workspaceProject(workspace)).trim();
  if (projectName) tags.push(`project:${projectName}`);
  if (workspace) tags.push(`workspace:${workspace}`);
  return tags;
}

/** Rich chips for UI/API consumers; workspace keeps its full path as context. */
export function sessionTagObjects(record = {}) {
  return sessionTags(record).map(id => {
    const at = id.indexOf(":");
    const kind = id.slice(0, at);
    const value = id.slice(at + 1);
    return {
      id, kind, value,
      label: kind === "source" ? SOURCE_LABELS[value] ?? value : value,
      ...(kind === "workspace" ? { path: value, label: workspaceProject(value) || value } : {}),
    };
  });
}

export function normalizeTagScope(tags) {
  if (tags === undefined || tags === null) return [];
  if (!Array.isArray(tags)) throw new Error("Tags must be an array");
  const out = [];
  for (const tag of tags) {
    if (typeof tag !== "string" || !/^(source|project|workspace):[^:\s][\s\S]*$/.test(tag) || tag.length > 1000) {
      throw new Error("Tags must use source:, project: or workspace: followed by a value");
    }
    const normalized = tag.startsWith("workspace:") ? `workspace:${normalizeWorkspace(tag.slice("workspace:".length))}` : tag;
    if (!normalized || normalized.endsWith(":")) throw new Error("Tag value is empty");
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** AND semantics: a session must carry every requested tag. */
export function matchesTags(record, tags = []) {
  if (!tags.length) return true;
  const own = new Set(sessionTags(record));
  return tags.every(tag => own.has(tag));
}
