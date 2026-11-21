import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const MAX_BYTES = 32 * 1024 * 1024;
const FRAGMENT = 6000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const queues = new Map();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function identifier(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\x00-\x1f]/.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}
function snapshotId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid snapshot id');
  return value;
}
function integer(value, name, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
const textOf = content => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n\n') : '';
function fields(value, names) {
  const out = {};
  for (const name of names) if (['string', 'number', 'boolean'].includes(typeof value?.[name])) out[name] = value[name];
  return out;
}
function eventText(event) {
  const d = event?.data ?? {};
  switch (event?.type) {
    case 'user/message':
      if (d.source?.kind !== undefined && d.source.kind !== 'user') return '';
      return textOf(d.content);
    case 'assistant/message': return textOf(d.message?.content);
    case 'tool/call': return JSON.stringify({ name: d.name ?? '', arguments: d.arguments ?? d.args ?? '' });
    case 'tool/result': {
      const message = d.message ?? {};
      const metadata = { ...fields(d, ['isError', 'exitCode', 'exit_code', 'signal']), ...fields(message, ['isError', 'exitCode', 'exit_code', 'signal']), ...fields(message.metadata, ['exitCode', 'exit_code', 'signal']), ...fields(d.metadata, ['exitCode', 'exit_code', 'signal']) };
      if (typeof d.error === 'string') metadata.error = d.error;
      else if (object(d.error)) metadata.error = fields(d.error, ['code', 'reason', 'message', 'name']);
      const text = textOf(message.content ?? d.content);
      return [text, Object.keys(metadata).length ? JSON.stringify(metadata) : ''].filter(Boolean).join('\n');
    }
    case 'turn/end': {
      const status = fields(d, ['status', 'turn']);
      if (typeof d.reason === 'string' && d.reason) status.reason = d.reason;
      else if (object(d.reason)) {
        const reason = fields(d.reason, ['kind', 'code', 'message']);
        if (Object.keys(reason).length) status.reason = reason;
      }
      return Object.keys(status).length ? JSON.stringify(status) : '';
    }
    default: return '';
  }
}
function validateSnapshot(snapshot) {
  if (!object(snapshot)) throw new Error('Invalid snapshot');
  snapshotId(snapshot.id);
  const { hash, ...body } = snapshot;
  if (typeof hash !== 'string' || digest(body) !== hash) throw new Error('Snapshot hash mismatch');
  if (!object(snapshot.source) || !Array.isArray(snapshot.entries) || typeof snapshot.brief !== 'string' || snapshot.brief.length > 100000 || typeof snapshot.capturedAt !== 'string') throw new Error('Invalid snapshot data');
  identifier(snapshot.source.sessionId, 'source sessionId');
  for (let i = 0; i < snapshot.entries.length; i++) {
    const entry = snapshot.entries[i];
    if (!object(entry) || entry.index !== i || typeof entry.text !== 'string' || entry.text.length > FRAGMENT || typeof entry.type !== 'string') throw new Error('Invalid snapshot entry');
    integer(entry.eventIndex, 'eventIndex', 0);
    integer(entry.offset, 'offset', 0);
    integer(entry.totalChars, 'totalChars', entry.offset + entry.text.length);
  }
  return snapshot;
}
async function readJSON(path) {
  try {
    if ((await stat(path)).size > MAX_BYTES) throw new Error('History file exceeds 32 MiB');
    const text = await readFile(path, 'utf8');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('History file exceeds 32 MiB');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
function encoded(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('History file exceeds 32 MiB');
  return text;
}
async function writeExclusive(path, text) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
}
function serial(key, action) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}
function validateBindings(value) {
  if (!Array.isArray(value)) throw new Error('Invalid bindings file');
  const sessions = new Set(), children = new Set();
  for (const b of value) {
    if (!object(b)) throw new Error('Invalid binding');
    identifier(b.sessionId, 'sessionId'); snapshotId(b.snapshotId);
    if (sessions.has(b.sessionId) || !Array.isArray(b.childIds) || typeof b.createdAt !== 'string' || typeof b.updatedAt !== 'string') throw new Error('Invalid binding');
    sessions.add(b.sessionId);
    if (b.links !== undefined) {
      if (!Array.isArray(b.links) || !b.links.length) throw new Error('Invalid binding links');
      const links = new Set(), sources = new Set(), snapshots = new Set();
      for (const link of b.links) {
        if (!object(link)) throw new Error('Invalid binding link');
        snapshotId(link.id); snapshotId(link.snapshotId);
        identifier(link.sourceSessionId, 'sourceSessionId');
        if (links.has(link.id) || sources.has(link.sourceSessionId) || typeof link.createdAt !== 'string' || typeof link.updatedAt !== 'string' || !Array.isArray(link.versions) || !link.versions.length || !link.versions.includes(link.snapshotId)) throw new Error('Invalid binding link');
        links.add(link.id); sources.add(link.sourceSessionId);
        for (const version of link.versions) {
          snapshotId(version);
          if (snapshots.has(version)) throw new Error('Conflicting snapshot version');
          snapshots.add(version);
        }
      }
      if (b.snapshotId !== b.links[0].snapshotId) throw new Error('Invalid primary snapshot');
    }
    if (b.childId !== null && !b.childIds.includes(b.childId)) throw new Error('Invalid current child');
    for (const id of b.childIds) {
      identifier(id, 'childId');
      if (children.has(id)) throw new Error('Conflicting child binding');
      children.add(id);
    }
  }
  return value;
}

/** Durable data only; queues coordinate all store instances in this process. */
export function createHistoryStore({ directory, logger } = {}) {
  identifier(directory, 'directory');
  const root = resolve(directory), bindingPath = join(root, 'bindings.json');
  const ready = () => mkdir(root, { recursive: true, mode: 0o700 });
  const readBindings = async () => {
    const value = await readJSON(bindingPath);
    const bindings = validateBindings(value === undefined ? [] : value);
    // Normalize v1 in memory only. An actual mutation persists the new shape;
    // reads and idempotent bind calls never rewrite an existing cache file.
    for (const binding of bindings) if (binding.links === undefined) {
      const snapshot = await requireSnapshot(binding.snapshotId);
      binding.links = [makeLink(snapshot, binding.createdAt, binding.updatedAt)];
    }
    return bindings;
  };
  const getSnapshot = async id => {
    snapshotId(id);
    const value = await readJSON(join(root, `${id}.json`));
    if (value === undefined) return null;
    validateSnapshot(value);
    if (value.id !== id) throw new Error('Snapshot id mismatch');
    return value;
  };
  const requireSnapshot = async id => {
    const snapshot = await getSnapshot(id);
    if (!snapshot) throw new Error('Snapshot not found');
    return snapshot;
  };
  const makeLink = (snapshot, createdAt, updatedAt = createdAt) => ({
    id: snapshot.id, sourceSessionId: snapshot.source.sessionId,
    snapshotId: snapshot.id, versions: [snapshot.id], createdAt, updatedAt,
  });
  const newBinding = (sessionId, snapshot, now) => ({
    sessionId, snapshotId: snapshot.id, links: [makeLink(snapshot, now)],
    childId: null, childIds: [], createdAt: now, updatedAt: now,
  });
  const mutate = action => serial(bindingPath, async () => {
    await ready();
    const bindings = await readBindings();
    const result = await action(bindings);
    if (result.changed) {
      const temp = join(root, `.bindings-${randomUUID()}.tmp`);
      try { await writeExclusive(temp, encoded(bindings)); await rename(temp, bindingPath); }
      finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') logger?.warn?.('Could not remove history temporary file', error); }); }
    }
    return clone(result.binding);
  });
  const persistSnapshot = async (sourceId, record, entries, brief) => {
    const body = { id: randomUUID(), source: { sessionId: sourceId, kind: record.source || 'dsh', title: record.title || sourceId, ...(record.cwd === undefined ? {} : { cwd: record.cwd }) }, capturedAt: new Date().toISOString(), brief, entries };
    const snapshot = { ...body, hash: digest(body) };
    const text = encoded(snapshot);
    await ready();
    await writeExclusive(join(root, `${snapshot.id}.json`), text);
    return snapshot;
  };
  return {
    // A range-limited record projection, explicitly distinguished from raw
    // conversation messages. Uses the same immutable, hashed storage as links.
    async createRecordSnapshot({ slice, range } = {}) {
      identifier(slice?.id, 'slice.id');
      const text = JSON.stringify({ slice, range });
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Snapshot exceeds 32 MiB');
      const entries = [];
      for (let offset = 0; offset < text.length; offset += FRAGMENT) {
        entries.push({ index: entries.length, type: 'focusing/record-slice', time: null, text: text.slice(offset, offset + FRAGMENT), eventIndex: 0, offset, totalChars: text.length });
      }
      return persistSnapshot(slice.id, slice, entries, 'Frozen selected-range record projection; not a full conversation transcript.');
    },
    async createSnapshot({ sourceId, record, events, brief = '' } = {}) {
      identifier(sourceId, 'sourceId');
      if (!object(record) || !Array.isArray(events)) throw new Error('record and events are required');
      if (typeof brief !== 'string' || brief.length > 100000) throw new Error('brief must be at most 100000 characters');
      for (const key of ['source', 'title', 'cwd']) if (record[key] !== undefined && typeof record[key] !== 'string') throw new Error(`Invalid record.${key}`);
      const entries = [];
      let bytes = 0;
      for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
        const event = events[eventIndex], text = eventText(event);
        const callId = event?.type === 'tool/call' ? event.data?.callId
          : event?.type === 'tool/result' ? event.data?.message?.toolCallId ?? event.data?.message?.source?.callId : undefined;
        for (let offset = 0; offset < text.length; offset += FRAGMENT) {
          const entry = { index: entries.length, type: event.type, time: typeof event.time === 'string' || Number.isFinite(event.time) ? event.time : null, text: text.slice(offset, offset + FRAGMENT), eventIndex, offset, totalChars: text.length };
          if (typeof callId === 'string' || typeof callId === 'number') entry.callId = callId;
          bytes += Buffer.byteLength(JSON.stringify(entry));
          if (bytes > MAX_BYTES) throw new Error('Snapshot exceeds 32 MiB');
          entries.push(entry);
        }
      }
      return persistSnapshot(sourceId, record, entries, brief);
    },
    getSnapshot,
    bind({ sessionId, snapshotId: id } = {}) {
      return mutate(async bindings => {
        identifier(sessionId, 'sessionId'); snapshotId(id);
        const old = bindings.find(b => b.sessionId === sessionId);
        if (old) {
          if (old.snapshotId !== id) throw new Error('Session already bound to a different snapshot');
          return { binding: old, changed: false };
        }
        const snapshot = await requireSnapshot(id);
        const binding = newBinding(sessionId, snapshot, new Date().toISOString());
        bindings.push(binding);
        return { binding, changed: true };
      });
    },
    /** Add one source to a session; use updateLink to change an existing source. */
    addLink({ sessionId, snapshotId: id } = {}) {
      return mutate(async bindings => {
        identifier(sessionId, 'sessionId'); snapshotId(id);
        const snapshot = await requireSnapshot(id);
        const binding = bindings.find(b => b.sessionId === sessionId);
        const now = new Date().toISOString();
        if (!binding) {
          const created = newBinding(sessionId, snapshot, now);
          bindings.push(created);
          return { binding: created, changed: true };
        }
        const existing = binding.links.find(link => link.sourceSessionId === snapshot.source.sessionId);
        if (existing) {
          if (existing.snapshotId !== id) throw new Error('Source already linked to a different snapshot; use updateLink');
          return { binding, changed: false };
        }
        binding.links.push(makeLink(snapshot, now));
        binding.updatedAt = now;
        return { binding, changed: true };
      });
    },
    /**
     * CAS one source's current snapshot. versions retains every authorized
     * immutable version once, in introduction order (including on rollback).
     * Policy readers use links[].versions for version access and snapshotId for
     * the current version; the top-level snapshotId aliases links[0].snapshotId.
     */
    updateLink({ sessionId, linkId, expectedSnapshotId, snapshotId: id } = {}) {
      return mutate(async bindings => {
        identifier(sessionId, 'sessionId'); snapshotId(linkId); snapshotId(expectedSnapshotId); snapshotId(id);
        const binding = bindings.find(b => b.sessionId === sessionId);
        if (!binding) throw new Error('Binding not found');
        const link = binding.links.find(item => item.id === linkId);
        if (!link) throw new Error('Link not found');
        if (link.snapshotId !== expectedSnapshotId) throw new Error('Snapshot version conflict');
        const previous = await requireSnapshot(link.snapshotId);
        const next = await requireSnapshot(id);
        if (previous.source.sessionId !== link.sourceSessionId || next.source.sessionId !== link.sourceSessionId) throw new Error('Snapshot sourceSessionId mismatch');
        if (link.snapshotId === id) return { binding, changed: false };
        if (!link.versions.includes(id)) link.versions.push(id);
        link.snapshotId = id;
        link.updatedAt = new Date().toISOString();
        binding.snapshotId = binding.links[0].snapshotId;
        binding.updatedAt = link.updatedAt;
        return { binding, changed: true };
      });
    },
    async getBinding(sessionId) {
      identifier(sessionId, 'sessionId');
      await (queues.get(bindingPath) ?? Promise.resolve()).catch(() => {});
      return (await readBindings()).find(b => b.sessionId === sessionId) ?? null;
    },
    setChild(sessionId, childId) {
      return mutate(async bindings => {
        identifier(sessionId, 'sessionId'); identifier(childId, 'childId');
        const binding = bindings.find(b => b.sessionId === sessionId);
        if (!binding) throw new Error('Binding not found');
        if (bindings.some(b => b.sessionId !== sessionId && b.childIds.includes(childId))) throw new Error('Child already belongs to another binding');
        if (binding.childId === childId) return { binding, changed: false };
        if (!binding.childIds.includes(childId)) binding.childIds.push(childId);
        binding.childId = childId;
        binding.updatedAt = new Date().toISOString();
        return { binding, changed: true };
      });
    },
    clearChild(sessionId, expectedChildId) {
      return mutate(async bindings => {
        identifier(sessionId, 'sessionId'); identifier(expectedChildId, 'expectedChildId');
        const binding = bindings.find(b => b.sessionId === sessionId);
        if (!binding) throw new Error('Binding not found');
        if (binding.childId !== expectedChildId) return { binding, changed: false };
        binding.childId = null;
        binding.updatedAt = new Date().toISOString();
        return { binding, changed: true };
      });
    },
    async getAdvisorBinding(childId) {
      identifier(childId, 'childId');
      await (queues.get(bindingPath) ?? Promise.resolve()).catch(() => {});
      return (await readBindings()).find(b => b.childIds.includes(childId)) ?? null;
    },
    async listBindings() {
      await (queues.get(bindingPath) ?? Promise.resolve()).catch(() => {});
      return readBindings();
    },
  };
}
function identity(snapshot) {
  validateSnapshot(snapshot);
  return { id: snapshot.id, hash: snapshot.hash, source: clone(snapshot.source), capturedAt: snapshot.capturedAt, totalEntries: snapshot.entries.length };
}
export function readHistorySnapshot(snapshot, { start = 0, limit = 6 } = {}) {
  const info = identity(snapshot);
  integer(start, 'start', 0); integer(limit, 'limit', 1, 50);
  const items = clone(snapshot.entries.slice(start, start + limit));
  return { ...info, items, total: snapshot.entries.length, nextStart: start + items.length < snapshot.entries.length ? start + items.length : null };
}
/** Case-sensitive literal matches, including matches spanning fragment boundaries. */
export function searchHistorySnapshot(snapshot, { query, limit = 6 } = {}) {
  const info = identity(snapshot);
  if (typeof query !== 'string' || !query.length || query.length > 100000) throw new Error('query must contain 1..100000 characters');
  integer(limit, 'limit', 1, 50);
  const groups = new Map();
  for (const entry of snapshot.entries) {
    if (!groups.has(entry.eventIndex)) groups.set(entry.eventIndex, []);
    groups.get(entry.eventIndex).push(entry);
  }
  const matches = [];
  let total = 0;
  for (const entries of groups.values()) {
    const text = entries.map(e => e.text).join('');
    let previousIndex = -1, match = null;
    for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) {
      const entry = entries[Math.floor(at / FRAGMENT)];
      if (entry.index !== previousIndex) {
        previousIndex = entry.index;
        total++;
        match = matches.length < limit ? { ...entry, matchOffsets: [], matchCount: 0, offsetsTruncated: false } : null;
        if (match) matches.push(match);
      }
      if (match) {
        match.matchCount++;
        if (match.matchOffsets.length < 20) match.matchOffsets.push(at);
        else match.offsetsTruncated = true;
      }
    }
  }
  return { ...info, query, items: clone(matches), total, truncated: total > limit };
}
