/**
 * Download file names for exported conversations.
 *
 * The browser decides the name from `Content-Disposition`, so the Host has to
 * send one; without it every export lands as the URL's last segment. Chinese
 * chat titles are supported through RFC 5987 `filename*`, with an ASCII
 * `filename` fallback for clients that ignore it.
 */

const MAX_BASE = 80;

/**
 * Turn a chat title into a safe file-name stem.
 *
 * Removes path separators and control characters (a title is user text and
 * must never influence where a file is written), collapses whitespace, and
 * bounds the length so the download stays usable on every platform.
 */
export function safeFileStem(title) {
  const cleaned = String(title ?? "")
    // Control characters and the separators Windows and POSIX reserve.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Trailing dots/spaces are invalid on Windows.
    .replace(/[. ]+$/, "");
  if (!cleaned) return "";
  return cleaned.length > MAX_BASE ? cleaned.slice(0, MAX_BASE).trim() : cleaned;
}

/** Local date stamp, so two exports of one chat never collide silently. */
export function fileStamp(at = Date.now()) {
  const date = new Date(at);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Build a Content-Disposition value for one export.
 * `fallback` is used when the chat has no usable title at all.
 */
export function exportDisposition({ title, at, format = "md", fallback = "conversation" }) {
  const extension = format === "json" ? "json" : "md";
  const stem = safeFileStem(title) || fallback;
  const name = `${stem}-${fileStamp(at)}.${extension}`;
  // ASCII-only fallback: keep letters and digits, replace everything else, so
  // an older client still gets a sensible file instead of a percent-encoded mess.
  const ascii = `${name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
