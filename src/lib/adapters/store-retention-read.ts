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

/**
 * The search index is a different shape: retention there is an index-lifecycle POLICY, not a flag. Zero
 * policies is not a missing setting — it is a read that succeeded and found that nothing expires. On an
 * index holding audit logs that is the "unbounded audit store" the roadmap calls a promise we cannot
 * keep, so it is worth reading rather than assuming.
 */
async function probeSearchIndex(timeoutMs: number): Promise<StoreReading> {
  const base = { storeId: 'opensearch', holds: 'audit and security logs' };
  try {
    const url = (process.env.OPENSEARCH_URL || 'http://127.0.0.1:9200').replace(/\/$/, '');
    const { getServiceCredential } = await import('@/lib/service-credentials');
    const cred = (await getServiceCredential('opensearch')) as { kind: string; token?: string };
    const headers: Record<string, string> =
      cred.kind === 'bearer' && cred.token ? { authorization: `Bearer ${cred.token}` } : {};
    const res = await fetch(`${url}/_plugins/_ism/policies`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) return { ...base, flagValue: null, readFailed: true };
    const body = (await res.json()) as { total_policies?: number };
    const total = Number(body.total_policies ?? 0);
    if (total === 0) return { ...base, flagValue: null, explicitUnbounded: true };
    // Policies exist. We do not parse their per-state ages here — saying "N policies are in force"
    // without reading what they DO would be the overstatement this module exists to avoid.
    return { ...base, flagValue: null, readFailed: true };
  } catch {
    return { ...base, flagValue: null, readFailed: true };
  }
}

/** Ask every store, in parallel, and summarise whether the deployment can make its retention claim. */
export async function readRetentionPosture(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 4_000,
): Promise<PostureSummary> {
  const [flagged, search] = await Promise.all([
    Promise.all(probes(env).map((p) => probeOne(p, timeoutMs))),
    probeSearchIndex(timeoutMs),
  ]);
  return summarisePosture([...flagged, search].map(readPosture));
}
