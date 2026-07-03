import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { type BackupEntry, type BackupsConfig, buildBackupsView, type BackupsView } from './backups-view';

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
