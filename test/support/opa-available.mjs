// Shared helper for the OPA integration suite: probe whether a real OPA is reachable at the SAME
// base the app uses (OFFGRID_OPA_URL), so the suite runs for real when an OPA is up and skips
// gracefully (green) otherwise — mirrors test/support/db-available.mjs.

const BASE = process.env.OFFGRID_OPA_URL;

export async function opaReachable() {
  if (!BASE) return false;
  try {
    const res = await fetch(`${BASE.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const OPA_BASE = BASE;

export const SKIP_MESSAGE =
  `OPA not reachable at ${BASE ?? '(OFFGRID_OPA_URL unset)'} — skipping OPA integration test. ` +
  'Set OFFGRID_OPA_URL to a running OPA (e.g. http://offgrid-s1.local:8181) to run it for real.';
