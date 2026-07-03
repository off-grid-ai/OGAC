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
  offBoxTarget: string | null; // rsync peer, e.g. "admin@192.168.1.66:/…"; null = disabled
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
