// ─── Where the data actually went ────────────────────────────────────────────────────────────────────
//
// The product's central claim is that data stays on the customer's own machines, and it was the one claim
// the platform could not evidence. `WHATS_MISSING_2.md` ranked it the biggest hole: the ledger recorded a
// model NAME (4 distinct) and nothing about where that model ran — no provider, no host, no region, no
// per-run event. So "did any customer's data leave India?" was answerable only by reading configuration
// and trusting it.
//
// A routing rule saying "personal data stays local" is a commitment. This module is the other thing: a
// record, per run, of the endpoint the call was actually made to — captured at execution time, not
// inferred afterwards from settings that may have changed since.
//
// Pure. Zero IO.

export type EgressScope = 'on-prem' | 'external' | 'unknown';

export interface EndpointClass {
  scope: EgressScope;
  /** The host as written, so evidence can be checked rather than taken on trust. */
  host: string;
  /** Why it was classified this way — the reason is part of the evidence. */
  why: string;
}

/** Private ranges per RFC 1918, plus RFC 6598 carrier-grade NAT, which is also not the public internet. */
function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * Is this endpoint on the customer's own network, or out on the internet?
 *
 * `unknown` is a real answer and is never quietly folded into either side. An endpoint we cannot classify
 * must not be counted as on-prem — that would manufacture the reassurance this record exists to earn — and
 * must not be counted as external either, which would invent a breach.
 */
export function classifyEndpoint(url: string | null | undefined): EndpointClass {
  const raw = (url ?? '').trim();
  if (!raw) return { scope: 'unknown', host: '', why: 'no endpoint was recorded for this call' };

  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    // Not a URL — could be a bare host:port.
    const bare = raw.replace(/^[a-z]+:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
    if (!bare) return { scope: 'unknown', host: raw, why: 'the endpoint could not be read as an address' };
    host = bare;
  }

  if (host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')) {
    return { scope: 'on-prem', host, why: 'a process on the same machine as the console' };
  }
  if (isPrivateIpv4(host)) {
    return { scope: 'on-prem', host, why: 'a private address on your own network' };
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) {
    return { scope: 'on-prem', host, why: 'a name that only resolves inside your network' };
  }
  if (!host.includes('.')) {
    // A single-label name is a container/host alias on the internal network, not a public domain.
    return { scope: 'on-prem', host, why: 'an internal host name on your own network' };
  }
  return { scope: 'external', host, why: 'a public address outside your network' };
}

export interface EgressEvent {
  /** What the pipeline's leash DECIDED for this call: local, cloud or block. */
  decision: string;
  /** The endpoint the call was actually made to. */
  endpoint: string;
  /** Model asked for, when known. */
  model?: string | null;
  /** Whether personal details were replaced before the call. */
  masked?: boolean;
  /** ISO. */
  at: string;
}

export interface EgressSummary {
  onPrem: number;
  external: number;
  unknown: number;
  total: number;
  /** Distinct external hosts, so "what left" names where it went. */
  externalHosts: string[];
  /** One sentence. Never claims more than the records support. */
  sentence: string;
}

/**
 * Summarise a set of recorded calls for a reader who wants to know whether their data left the building.
 *
 * The sentence is deliberately conservative. With no records at all it says so rather than reassuring:
 * "nothing left" and "we did not look" are the same picture to an auditor and opposite facts to a
 * customer, and this record exists precisely to stop the platform asserting the first when it means the
 * second.
 */
export function summariseEgress(events: readonly EgressEvent[]): EgressSummary {
  let onPrem = 0;
  let external = 0;
  let unknown = 0;
  const hosts = new Set<string>();
  for (const e of events) {
    const c = classifyEndpoint(e.endpoint);
    if (c.scope === 'on-prem') onPrem++;
    else if (c.scope === 'external') {
      external++;
      if (c.host) hosts.add(c.host);
    } else unknown++;
  }
  const total = events.length;
  const externalHosts = [...hosts].sort();

  let sentence: string;
  if (total === 0) {
    sentence =
      'No AI calls have been recorded for this app yet, so nothing is known either way about where its data went.';
  } else if (external > 0) {
    sentence = `${external} of ${total} AI calls went outside your network — to ${externalHosts.join(', ')}.`;
  } else if (unknown > 0 && onPrem === 0) {
    sentence = `${unknown} AI ${unknown === 1 ? 'call was' : 'calls were'} recorded without an address, so where they went cannot be confirmed.`;
  } else if (unknown > 0) {
    sentence = `${onPrem} of ${total} AI calls stayed on your own hardware. ${unknown} ${unknown === 1 ? 'was' : 'were'} recorded without an address and cannot be confirmed either way.`;
  } else {
    sentence = `All ${total} AI ${total === 1 ? 'call' : 'calls'} for this app stayed on your own hardware — nothing was sent to an outside provider.`;
  }
  return { onPrem, external, unknown, total, externalHosts, sentence };
}
