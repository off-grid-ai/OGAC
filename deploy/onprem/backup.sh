#!/usr/bin/env bash
# Off Grid — on-prem backup (Phase 3A, the cheap high-value piece; do this regardless of HA).
# Dumps the console Postgres + the enterprise data-source DBs to a timestamped local dir and
# (optionally) pushes to the MinIO warehouse. Run on S1, or over the tunnel. Schedule via cron/
# launchd (see below). Docker at /Users/admin/.orbstack/bin/docker.
#
#   ./backup.sh                 # dump to /Users/admin/offgrid/backups/<ts>/
#   BACKUP_DIR=/path ./backup.sh
#
# Restore: `docker exec -i <container> psql/mysql < dump.sql` (see RESTORE notes at bottom).
set -euo pipefail

D="${DOCKER:-/Users/admin/.orbstack/bin/docker}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR:-/Users/admin/offgrid/backups}/$TS"
mkdir -p "$OUT"
echo "==> backing up to $OUT"

# Console state (Postgres, pgvector) — the source of truth for the whole console.
"$D" exec -i offgrid-console-postgres-1 pg_dump -U offgrid offgrid_console | gzip > "$OUT/console.sql.gz"
echo "  [ok] console_console"

# Core Banking (Postgres)
"$D" exec -i offgrid-ds-corebank pg_dump -U corebank corebank | gzip > "$OUT/corebank.sql.gz" && echo "  [ok] corebank"

# Policy Admin (MySQL)
"$D" exec -i offgrid-ds-policyadmin mysqldump -upolicyadmin -ppolicyadmin policyadmin 2>/dev/null | gzip > "$OUT/policyadmin.sql.gz" && echo "  [ok] policyadmin"

# Finance ERP (MSSQL) — logical export via the mssql driver isn't a single command; snapshot the
# data dir instead (container must be briefly consistent — acceptable for nightly).
# (Left as a documented follow-up; the seed is reproducible from the console script.)

# Keep the last 14 dumps; prune older.
ls -1dt "${BACKUP_DIR:-/Users/admin/offgrid/backups}"/*/ 2>/dev/null | tail -n +15 | xargs -I{} rm -rf {} 2>/dev/null || true

# Off-box DR copy → a second physical node (.66) so a dump survives S1 disk loss. Best-effort;
# never fails the backup if the peer is unreachable. Set OFFSITE_HOST='' to disable.
OFFSITE_HOST="${OFFSITE_HOST:-admin@192.168.1.66}"
OFFSITE_DIR="${OFFSITE_DIR:-/Users/admin/offgrid/backups-from-s1}"
if [ -n "$OFFSITE_HOST" ]; then
  ssh -o BatchMode=yes "$OFFSITE_HOST" "mkdir -p $OFFSITE_DIR" 2>/dev/null \
    && rsync -az "$OUT/" "$OFFSITE_HOST:$OFFSITE_DIR/$TS/" 2>/dev/null \
    && echo "  [ok] off-box copy → $OFFSITE_HOST:$OFFSITE_DIR/$TS" \
    || echo "  [warn] off-box copy to $OFFSITE_HOST failed (peer down?) — local dump still good"
  # Prune off-box copies too (keep 14).
  ssh -o BatchMode=yes "$OFFSITE_HOST" "ls -1dt $OFFSITE_DIR/*/ 2>/dev/null | tail -n +15 | xargs -I{} rm -rf {}" 2>/dev/null || true
fi

echo "==> done. $(du -sh "$OUT" | cut -f1) in $OUT"

# ── Schedule (launchd, daily 02:00) ────────────────────────────────────────────
#   Ready-to-install plist: deploy/onprem/co.getoffgridai.backup.plist (system LaunchDaemon,
#   StartCalendarInterval Hour=2). Install steps in SERVER_STATE.md § "Nightly schedule". The
#   console's Backups page reads its status via `launchctl list co.getoffgridai.backup`.
#   Or a cron line: `0 2 * * * /path/backup.sh`.
#
# ── Restore ────────────────────────────────────────────────────────────────────
#   console : gunzip -c console.sql.gz  | docker exec -i offgrid-console-postgres-1 psql -U offgrid offgrid_console
#   corebank: gunzip -c corebank.sql.gz | docker exec -i offgrid-ds-corebank psql -U corebank corebank
#   mysql   : gunzip -c policyadmin.sql.gz | docker exec -i offgrid-ds-policyadmin mysql -upolicyadmin -ppolicyadmin policyadmin
