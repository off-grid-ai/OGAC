// PURE backup/DR display-model builder — ZERO imports, ZERO I/O, fully unit-testable.
//
// The on-prem backup script (deploy/onprem/backup.sh) writes a timestamped directory per run to
// /Users/admin/offgrid/backups/<ts>/ (gzip dumps, 14-day retention) and best-effort rsyncs the
// same dir to an off-box peer. This module takes a plain list of backup-dir entries + config and
// computes the read-only status surface the console renders. The fs read lives in a thin reader
// (readBackupsView, in backups.ts); this file never touches the filesystem or the clock — the
// caller passes `now` so age/staleness are deterministic and testable.

// One backup directory as seen on disk. `timestampMs` is the backup's own time (parsed from the
// dir name when possible, else its mtime); the reader decides. Everything defensive.
export interface BackupEntry {
  name: string; // directory name, e.g. "20260704-020000"
  timestampMs: number | null; // epoch ms for this backup, or null if unknown
  sizeBytes: number; // total bytes across the dump files in the dir
  offBox?: boolean; // known to be replicated off-box (reader may not always know)
}

export interface BackupsConfig {
  retentionDays: number; // how many days/dirs the script keeps (14)
  backupRoot: string; // where dumps live on the server
  offBoxTarget: string | null; // rsync peer, e.g. "admin@offgrid-g6.local:/…"; null = disabled
  staleAfterHours: number; // overdue threshold (24h → a nightly job that missed is stale)
}

export interface BackupRow {
  name: string;
  timestampMs: number | null;
  ageMs: number | null; // now - timestamp, or null when timestamp unknown
  sizeBytes: number;
  offBox: boolean;
  withinRetention: boolean; // newer than the retention cutoff
}

export interface BackupsView {
  config: BackupsConfig;
  count: number; // total entries seen
  countWithinRetention: number; // entries newer than the retention cutoff
  totalSizeBytes: number; // sum across all entries
  latest: BackupRow | null; // most-recent backup (by timestamp), or null when none
  latestAgeMs: number | null; // age of the latest backup at `now`
  stale: boolean; // no backup, or the latest is older than staleAfterHours
  offBoxEnabled: boolean; // an off-box target is configured
  offBoxReplicatedCount: number; // entries known to be replicated off-box
  rows: BackupRow[]; // all entries, newest-first
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

// Build the read-only DR status model. Never throws; malformed entries degrade to safe defaults.
export function buildBackupsView(
  entries: readonly BackupEntry[] | null | undefined,
  config: BackupsConfig,
  now: number,
): BackupsView {
  const list = Array.isArray(entries) ? entries : [];
  const retentionCutoff = now - config.retentionDays * DAY_MS;

  const rows: BackupRow[] = list.map((e) => {
    const timestampMs =
      typeof e?.timestampMs === 'number' && Number.isFinite(e.timestampMs) ? e.timestampMs : null;
    const ageMs = timestampMs === null ? null : now - timestampMs;
    return {
      name: typeof e?.name === 'string' && e.name.length > 0 ? e.name : '(unknown)',
      timestampMs,
      ageMs,
      sizeBytes: num(e?.sizeBytes),
      offBox: e?.offBox === true,
      withinRetention: timestampMs === null ? false : timestampMs >= retentionCutoff,
    };
  });

  // Newest-first. Entries with a known timestamp sort ahead of unknown ones.
  rows.sort((a, b) => {
    if (a.timestampMs === null && b.timestampMs === null) return 0;
    if (a.timestampMs === null) return 1;
    if (b.timestampMs === null) return -1;
    return b.timestampMs - a.timestampMs;
  });

  const totalSizeBytes = rows.reduce((sum, r) => sum + r.sizeBytes, 0);
  const countWithinRetention = rows.filter((r) => r.withinRetention).length;
  const offBoxReplicatedCount = rows.filter((r) => r.offBox).length;

  const latest = rows.find((r) => r.timestampMs !== null) ?? null;
  const latestAgeMs = latest?.ageMs ?? null;
  const stale =
    latest === null || latestAgeMs === null || latestAgeMs > config.staleAfterHours * HOUR_MS;

  return {
    config,
    count: rows.length,
    countWithinRetention,
    totalSizeBytes,
    latest,
    latestAgeMs,
    stale,
    offBoxEnabled: Boolean(config.offBoxTarget && config.offBoxTarget.length > 0),
    offBoxReplicatedCount,
    rows,
  };
}

// ── Formatting helpers (pure; used by the route & page) ─────────────────────────────────────────

export function formatBytes(bytes: number): string {
  const b = num(bytes);
  if (b === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  const val = b / 1024 ** i;
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

export function formatAge(ageMs: number | null): string {
  if (ageMs === null || ageMs < 0) return '—';
  if (ageMs < HOUR_MS) return `${Math.max(1, Math.round(ageMs / (60 * 1000)))}m ago`;
  if (ageMs < DAY_MS) return `${Math.round(ageMs / HOUR_MS)}h ago`;
  return `${Math.round(ageMs / DAY_MS)}d ago`;
}

// ── Management-action pure logic (no I/O; the reader/route wrap these) ───────────────────────────

// A backup dir name is EXACTLY one path segment — a bare directory name, never a path. This is the
// path-safety guard for destructive actions: reject anything that could escape the backups root.
// Rejects: empty, "." / "..", names containing a path separator, absolute paths, null bytes, and
// leading dots (hidden / dot-traversal). Accepts the timestamp form the script writes
// ("YYYYMMDD-HHMMSS") and any plain alphanumeric segment with dashes/underscores/dots inside.
export function isSafeBackupName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  if (name.startsWith('.')) return false; // no hidden dirs / no leading-dot traversal
  if (name.includes('/') || name.includes('\\')) return false; // no path separators
  if (name.includes('\0')) return false; // no null bytes
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name); // safe filename charset only
}

// Given the rows built by buildBackupsView, select which backups fall OUTSIDE the retention window
// and are therefore prunable. Pure: the route feeds it the view's rows. Entries with a known
// timestamp older than the cutoff are prunable; unknown-timestamp entries are NEVER auto-pruned
// (we can't prove their age — they require an explicit, named delete instead).
export function selectPrunable(rows: readonly BackupRow[]): BackupRow[] {
  return (Array.isArray(rows) ? rows : []).filter(
    (r) => r.timestampMs !== null && r.withinRetention === false,
  );
}

// ── Restore command derivation (PURE — no execution) ─────────────────────────────────────────────
//
// Restoring a dump is DESTRUCTIVE (it overwrites a live database), so the console does NOT run it
// one-click. Instead it inspects a chosen backup, lists its dump files, and derives the EXACT,
// copy-pasteable restore command an operator runs on S1 during a maintenance window. This maps each
// known dump filename to its target container + client, mirroring the RESTORE notes in backup.sh.
// Unknown files are surfaced with a null command (honest: "we don't know how to restore this").

export interface DumpFile {
  file: string; // bare filename inside the backup dir, e.g. "console.sql.gz"
  sizeBytes: number;
}

// One restore instruction: the dump file, the human target, and the exact shell command (or null
// when the file isn't a recognised dump).
export interface RestorePlanItem {
  file: string;
  sizeBytes: number;
  target: string; // human label of what gets overwritten
  command: string | null; // exact restore command, or null if unrecognised
}

// Recognised dump → restore mapping. Kept beside the script so the two never drift. `{path}` is the
// absolute path to the dump file (the reader fills it in).
const RESTORE_TARGETS: ReadonlyArray<{
  match: RegExp;
  target: string;
  command: (path: string) => string;
}> = [
  {
    match: /^console\.sql\.gz$/,
    target: 'Console Postgres (offgrid_console) — the whole console',
    command: (p) =>
      `gunzip -c '${p}' | /Users/admin/.orbstack/bin/docker exec -i offgrid-console-postgres-1 psql -U offgrid offgrid_console`,
  },
  {
    match: /^corebank\.sql\.gz$/,
    target: 'Core Banking (Postgres)',
    command: (p) =>
      `gunzip -c '${p}' | /Users/admin/.orbstack/bin/docker exec -i offgrid-ds-corebank psql -U corebank corebank`,
  },
  {
    match: /^policyadmin\.sql\.gz$/,
    target: 'Policy Admin (MySQL)',
    command: (p) =>
      `gunzip -c '${p}' | /Users/admin/.orbstack/bin/docker exec -i offgrid-ds-policyadmin mysql -upolicyadmin -ppolicyadmin policyadmin`,
  },
];

// Build the restore plan for a backup's dump files. Pure: the reader passes the dir listing + the
// absolute path resolver. Each recognised dump gets its exact command; unknown files get command:null.
export function buildRestorePlan(
  files: readonly DumpFile[],
  absPathFor: (file: string) => string,
): RestorePlanItem[] {
  return (Array.isArray(files) ? files : [])
    .filter((f) => f && typeof f.file === 'string' && f.file.length > 0)
    .map((f) => {
      const hit = RESTORE_TARGETS.find((t) => t.match.test(f.file));
      return {
        file: f.file,
        sizeBytes: num(f.sizeBytes),
        target: hit ? hit.target : 'unrecognised dump — no known restore path',
        command: hit ? hit.command(absPathFor(f.file)) : null,
      };
    });
}
