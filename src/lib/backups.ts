import { execFile, spawn } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  type BackupEntry,
  type BackupsConfig,
  buildBackupsView,
  type BackupsView,
  isSafeBackupName,
  selectPrunable,
} from './backups-view';

const execFileAsync = promisify(execFile);

// Thin best-effort reader over the on-prem backup directory produced by deploy/onprem/backup.sh.
// The console runs on the same host (S1), so this is a local directory read — no extra service.
// The pure model-building lives in backups-view.ts; this file only does the I/O and defers, so it
// never throws: it returns { view, error } for the read-back page to render reachability.

const BACKUPS_DIR = process.env.OFFGRID_BACKUPS_DIR || '/Users/admin/offgrid/backups';
const RETENTION_DAYS = Number(process.env.OFFGRID_BACKUPS_RETENTION_DAYS) || 14;
const STALE_AFTER_HOURS = Number(process.env.OFFGRID_BACKUPS_STALE_HOURS) || 24;
// Mirrors backup.sh's OFFSITE_HOST/OFFSITE_DIR default; empty disables (as in the script).
const OFFBOX_TARGET =
  process.env.OFFGRID_BACKUPS_OFFBOX_TARGET ?? 'admin@192.168.1.66:/Users/admin/offgrid/backups-from-s1';

function config(): BackupsConfig {
  return {
    retentionDays: RETENTION_DAYS,
    backupRoot: BACKUPS_DIR,
    offBoxTarget: OFFBOX_TARGET && OFFBOX_TARGET.length > 0 ? OFFBOX_TARGET : null,
    staleAfterHours: STALE_AFTER_HOURS,
  };
}

// Backup dir names are "YYYYMMDD-HHMMSS" (see backup.sh `date +%Y%m%d-%H%M%S`). Parse to epoch ms;
// fall back to the dir mtime when the name doesn't match.
function parseTimestamp(name: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const t = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
  return Number.isFinite(t) ? t : null;
}

// Sum the byte sizes of the dump files directly inside a backup dir (non-recursive; the script
// writes flat *.sql.gz files per run).
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const files = await readdir(dir, { withFileTypes: true });
  for (const f of files) {
    if (!f.isFile()) continue;
    try {
      const st = await stat(path.join(dir, f.name));
      total += st.size;
    } catch {
      // skip unreadable file
    }
  }
  return total;
}

async function readEntries(root: string): Promise<BackupEntry[]> {
  const dirents = await readdir(root, { withFileTypes: true });
  const entries: BackupEntry[] = [];
  for (const de of dirents) {
    if (!de.isDirectory()) continue;
    const full = path.join(root, de.name);
    let timestampMs = parseTimestamp(de.name);
    let sizeBytes = 0;
    try {
      sizeBytes = await dirSize(full);
      if (timestampMs === null) {
        const st = await stat(full);
        timestampMs = st.mtimeMs;
      }
    } catch {
      // directory vanished / unreadable — keep name with what we have
    }
    entries.push({ name: de.name, timestampMs, sizeBytes });
  }
  return entries;
}

export async function readBackupsView(now: number = Date.now()): Promise<{
  view: BackupsView;
  error: string | null;
}> {
  const cfg = config();
  try {
    const entries = await readEntries(cfg.backupRoot);
    return { view: buildBackupsView(entries, cfg, now), error: null };
  } catch (e) {
    // Directory missing/unreadable → empty view (which reports stale) + the error for the surface.
    return { view: buildBackupsView([], cfg, now), error: (e as Error).message };
  }
}

// ── Management actions (I/O; the pure guards live in backups-view.ts) ────────────────────────────

// The dump script and the daily launchd job label (documented in deploy/onprem/backup.sh & SERVER_STATE).
const BACKUP_SCRIPT =
  process.env.OFFGRID_BACKUP_SCRIPT || '/Users/admin/offgrid/console/deploy/onprem/backup.sh';
const LAUNCHD_LABEL = process.env.OFFGRID_BACKUP_LAUNCHD_LABEL || 'co.getoffgridai.backup';

export function backupsConfig(): BackupsConfig {
  return config();
}

// Resolve a bare backup-dir name to its absolute path, WITHIN the root. Returns null if the name
// fails the path-safety guard OR if the resolved path escapes the root (belt-and-braces). This is
// the single choke-point every destructive action goes through.
export function resolveBackupPath(name: string): string | null {
  if (!isSafeBackupName(name)) return null;
  const root = path.resolve(config().backupRoot);
  const full = path.resolve(root, name);
  // Must be a direct child of root: dirname(full) === root.
  if (path.dirname(full) !== root) return null;
  if (full === root) return null;
  return full;
}

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  outputTail: string; // last ~4KB of combined stdout+stderr
  error?: string;
}

// Serialize backup runs across this process — the script prunes/rsyncs, so two at once is unsafe.
let running = false;
export function isBackupRunning(): boolean {
  return running;
}

// Trigger deploy/onprem/backup.sh. Captures exit code + a tail of combined output. Guarded against
// concurrent runs (throws CONCURRENT if one is already in flight — the route maps it to 409).
export async function runBackupNow(timeoutMs = 10 * 60 * 1000): Promise<RunResult> {
  if (running) {
    const err = new Error('a backup is already running');
    (err as Error & { code?: string }).code = 'CONCURRENT';
    throw err;
  }
  running = true;
  const started = Date.now();
  try {
    return await new Promise<RunResult>((resolve) => {
      const child = spawn('/bin/bash', [BACKUP_SCRIPT], {
        env: { ...process.env, BACKUP_DIR: config().backupRoot },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let buf = '';
      const cap = (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        if (buf.length > 8192) buf = buf.slice(-8192); // keep only the tail
      };
      child.stdout.on('data', cap);
      child.stderr.on('data', cap);

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          exitCode: null,
          signal: null,
          durationMs: Date.now() - started,
          outputTail: buf.slice(-4096),
          error: (e as Error).message,
        });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          exitCode: code,
          signal: signal ?? null,
          durationMs: Date.now() - started,
          outputTail: buf.slice(-4096),
        });
      });
    });
  } finally {
    running = false;
  }
}

export interface DeleteResult {
  ok: boolean;
  name: string;
  error?: string;
}

// Delete a single backup dir by bare name. Path-safety enforced via resolveBackupPath. Best-effort:
// returns a structured result rather than throwing on fs errors.
export async function deleteBackup(name: string): Promise<DeleteResult> {
  const full = resolveBackupPath(name);
  if (!full) return { ok: false, name, error: 'invalid backup name (path-safety rejected)' };
  try {
    const st = await stat(full);
    if (!st.isDirectory()) return { ok: false, name, error: 'not a backup directory' };
    await rm(full, { recursive: true, force: true });
    return { ok: true, name };
  } catch (e) {
    return { ok: false, name, error: (e as Error).message };
  }
}

export interface PruneResult {
  ok: boolean;
  candidates: string[]; // dirs selected as outside retention
  deleted: string[];
  failed: DeleteResult[];
}

// Prune every backup outside the retention window on demand (the script prunes by count nightly;
// this prunes by the console's retention-days policy). Pure selection via selectPrunable; each
// delete goes through the same path-safety choke-point.
export async function pruneBackups(now: number = Date.now()): Promise<PruneResult> {
  const { view } = await readBackupsView(now);
  const candidates = selectPrunable(view.rows).map((r) => r.name);
  const deleted: string[] = [];
  const failed: DeleteResult[] = [];
  for (const name of candidates) {
    const res = await deleteBackup(name);
    if (res.ok) deleted.push(name);
    else failed.push(res);
  }
  return { ok: failed.length === 0, candidates, deleted, failed };
}

export interface ScheduleStatus {
  label: string;
  scheduled: boolean; // launchd job is loaded
  detail: string; // human-readable status / instructions
  controllable: boolean; // whether remote enable/disable is offered (we render status only)
}

// Surface whether the daily launchd backup job is loaded. Read-only: `launchctl list <label>`
// exits 0 when the job is registered. We deliberately DON'T load/unload launchd remotely from the
// web app (needs the right user context / sudo and is easy to get wrong) — the UI shows status +
// the documented plist instructions instead. Honest about that via `controllable: false`.
export async function readScheduleStatus(): Promise<ScheduleStatus> {
  const base = {
    label: LAUNCHD_LABEL,
    controllable: false as const,
  };
  try {
    await execFileAsync('launchctl', ['list', LAUNCHD_LABEL], { timeout: 5000 });
    return {
      ...base,
      scheduled: true,
      detail: `launchd job ${LAUNCHD_LABEL} is loaded (daily 02:00). Managed via /Library/LaunchDaemons/${LAUNCHD_LABEL}.plist.`,
    };
  } catch (e) {
    const msg = (e as Error).message || '';
    // Non-zero exit = not loaded; ENOENT = launchctl unavailable (not macOS / dev box).
    const unavailable = /ENOENT|not found/i.test(msg);
    return {
      ...base,
      scheduled: false,
      detail: unavailable
        ? 'launchctl unavailable in this environment — schedule status can only be read on the S1 host.'
        : `launchd job ${LAUNCHD_LABEL} is NOT loaded. Install /Library/LaunchDaemons/${LAUNCHD_LABEL}.plist (StartCalendarInterval Hour=2) to schedule the nightly backup — see deploy/onprem/backup.sh.`,
    };
  }
}
