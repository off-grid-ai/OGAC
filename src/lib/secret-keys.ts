// PURE secret-KEY-NAME logic — ZERO imports, ZERO I/O, fully unit-testable.
//
// SAFETY INVARIANT: nothing in this module ever accepts, holds, or emits a secret VALUE. It works
// exclusively over key PATHS (names) and their derived display metadata. Writes are handled by the
// adapter/route; the pure layer only validates the key path and normalizes the listing into a
// display model that — by construction — has no field capable of carrying a value.

// Result of validating a proposed secret key path (the name only, never the value).
export interface KeyPathValidation {
  ok: boolean;
  key: string; // trimmed, normalized key path (safe to echo — it's a name, not a value)
  error: string | null;
}

// KV v2 key paths: slash-delimited segments of [A-Za-z0-9._-]. No leading/trailing/duplicate
// slashes, no whitespace, no "." / ".." segments (path traversal), bounded length. This mirrors
// what OpenBao's KV backend accepts while refusing anything that could confuse the data path.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const MAX_KEY_LEN = 256;

export function validateKeyPath(raw: unknown): KeyPathValidation {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) return { ok: false, key: '', error: 'Key path is required.' };
  if (key.length > MAX_KEY_LEN) {
    return { ok: false, key: '', error: `Key path must be ≤ ${MAX_KEY_LEN} characters.` };
  }
  if (key.startsWith('/') || key.endsWith('/')) {
    return { ok: false, key: '', error: 'Key path cannot start or end with "/".' };
  }
  const segments = key.split('/');
  for (const seg of segments) {
    if (seg === '') {
      return { ok: false, key: '', error: 'Key path cannot contain empty segments ("//").' };
    }
    if (seg === '.' || seg === '..') {
      return { ok: false, key: '', error: 'Key path cannot contain "." or ".." segments.' };
    }
    if (!SEGMENT_RE.test(seg)) {
      return {
        ok: false,
        key: '',
        error: 'Key path segments may only contain letters, digits, ".", "_", "-".',
      };
    }
  }
  return { ok: true, key, error: null };
}

// Result of validating a folder path used to drill into a KV v2 "directory" — the same segment
// rules as a key path, but a folder path always ENDS in "/" (that's what marks it a namespace,
// not a leaf) and MAY be empty (the root).
export interface FolderPathValidation {
  ok: boolean;
  folder: string; // '' (root) or a trimmed, normalized "a/b/" path
  error: string | null;
}

export function validateFolderPath(raw: unknown): FolderPathValidation {
  // Absent (undefined/null) or blank both mean "the root" — no folder was requested. Any OTHER
  // non-string is a malformed caller, not a folder, so it must fail closed rather than silently
  // resolve to the root.
  if (raw === undefined || raw === null) return { ok: true, folder: '', error: null };
  if (typeof raw !== 'string') {
    return { ok: false, folder: '', error: 'Folder path must be a string.' };
  }
  const value = raw.trim();
  if (value === '') return { ok: true, folder: '', error: null };
  if (value.length > MAX_KEY_LEN) {
    return { ok: false, folder: '', error: `Folder path must be ≤ ${MAX_KEY_LEN} characters.` };
  }
  if (value.startsWith('/') || !value.endsWith('/')) {
    return { ok: false, folder: '', error: 'Folder path must not start with "/" and must end with "/".' };
  }
  const segments = value.slice(0, -1).split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..' || !SEGMENT_RE.test(seg)) {
      return { ok: false, folder: '', error: 'Folder path contains an invalid segment.' };
    }
  }
  return { ok: true, folder: value, error: null };
}

// A row in the key-name listing. Deliberately NO `value` field — the display model is structurally
// incapable of carrying secret material. `folder` marks KV v2 "directory" keys (trailing slash),
// which are namespaces, not leaf secrets, and so are not individually deletable as a value.
export interface SecretKeyRow {
  key: string; // the key name/path as stored
  folder: boolean; // true when it's a KV v2 folder (trailing slash) rather than a leaf secret
}

// Normalize a raw key listing (from the adapter's list()) into a sorted, de-duplicated display
// model. Drops non-strings and blanks. Folders sort after leaves, then alphabetical. Never touches
// or produces any value.
export function normalizeKeyList(raw: unknown): SecretKeyRow[] {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const rows: SecretKeyRow[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, folder: key.endsWith('/') });
  }
  rows.sort((a, b) => {
    if (a.folder !== b.folder) return a.folder ? 1 : -1;
    return a.key.localeCompare(b.key);
  });
  return rows;
}
