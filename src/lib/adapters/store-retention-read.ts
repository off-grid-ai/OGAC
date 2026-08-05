// I/O bridge: ask each observability store how long it keeps data. Judgement is pure, in
// store-retention-posture.ts.
//
// These stores set retention as a DEPLOY FLAG, not through an API, so the console cannot write it —
// that ownership boundary is deliberate and stated in each capability entry. What the console CAN do is
// read the flag back and report it, which is the difference between a retention claim and a hope.
//
// The `/flags` endpoint is the VictoriaMetrics family's own report of its effective configuration, so a
// value read there is the store's word rather than ours. A flag that is ABSENT from that list is the
// interesting case: it means the store is on its built-in default, which nobody chose and which the
// store will not state.

import {
  readPosture,
  summarisePosture,
  type PostureSummary,
  type StoreReading,
} from '@/lib/store-retention-posture';

interface StoreProbe {
  storeId: string;
  holds: string;
  /** Base URL, env-overridable, loopback default like every other on-box service. */
  url: string;
  flag: string;
  /**
   * The store's documented default, cited ONLY to distinguish "on a default" from "unknown". Kept next
   * to the probe so the citation lives with the thing it describes.
   */
  documentedDefault: string | null;
}

function probes(env: NodeJS.ProcessEnv): StoreProbe[] {
  return [
    {
      storeId: 'victoriametrics',
      holds: 'metrics',
      url: (env.OFFGRID_VICTORIAMETRICS_URL || 'http://127.0.0.1:8428').replace(/\/$/, ''),
      flag: 'retentionPeriod',
      // VictoriaMetrics keeps 1 month when unset.
      documentedDefault: '1',
    },
    {
      storeId: 'victorialogs',
      holds: 'logs',
      url: (env.OFFGRID_VICTORIALOGS_URL || 'http://127.0.0.1:9428').replace(/\/$/, ''),
      flag: 'retentionPeriod',
      // VictoriaLogs keeps 7 days when unset.
      documentedDefault: '7d',
    },
  ];
}

/** Pull the flag value out of the family's `/flags` text output. Absent → null, never a guess. */
export function flagValueFrom(body: string, flag: string): string | null {
  // Flags come back as `-name="value"` or `-name=value`, whitespace separated.
  const re = new RegExp(`-${flag}=(?:"([^"]*)"|(\\S+))`);
  const m = re.exec(body);
  if (!m) return null;
  const value = m[1] ?? m[2] ?? '';
  return value.trim() === '' ? null : value;
}

async function probeOne(p: StoreProbe, timeoutMs: number): Promise<StoreReading> {
  try {
    const res = await fetch(`${p.url}/flags`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { storeId: p.storeId, holds: p.holds, flagValue: null, readFailed: true };
    }
    return {
      storeId: p.storeId,
      holds: p.holds,
      flagValue: flagValueFrom(await res.text(), p.flag),
      documentedDefault: p.documentedDefault,
    };
  } catch {
    // readFailed, NOT flagValue:null — an unreachable store must not be reported as one running on a
    // default it never told us about.
    return { storeId: p.storeId, holds: p.holds, flagValue: null, readFailed: true };
  }
}

/** Ask every store, in parallel, and summarise whether the deployment can make its retention claim. */
export async function readRetentionPosture(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 4_000,
): Promise<PostureSummary> {
  const readings = await Promise.all(probes(env).map((p) => probeOne(p, timeoutMs)));
  return summarisePosture(readings.map(readPosture));
}
