// ─── The infrastructure, translated ──────────────────────────────────────────────────────────────────
//
// Seventeen of the forty-nine services on the capability map are pure infrastructure — PostgreSQL, Redis,
// Jaeger, the OTel collector, the forwarders, the tunnel, device management — and every one of their
// capabilities lands only on an `/operations/*` page in engine language. I recorded them as "correctly
// invisible", and a claims handler should indeed never meet the word Jaeger.
//
// But invisible is not the same as delivering nothing. These services carry one thing a department person
// genuinely needs, and it was reaching them nowhere: **can I trust what I am looking at, and can I work
// right now?** A person deciding a case has no way to tell "this queue is empty because the work is done"
// from "this queue is empty because a part of the platform is down". That is exactly the failure-presents-
// as-emptiness defect, at platform scale.
//
// So this states their value as an outcome, and names no engine.
//
// Pure. Zero IO.

export interface ServiceState {
  /** The service id — used only to decide relevance, never shown. */
  id: string;
  /** 'up' | 'down' | 'embedded' | 'optional'. */
  status: string;
  ms?: number | null;
}

export interface PlatformPlain {
  /** 'ok' | 'slow' | 'degraded' | 'unknown'. */
  state: 'ok' | 'slow' | 'degraded' | 'unknown';
  /** One sentence for a department reader. Names no service, no engine, no host. */
  sentence: string;
  /** True when the reader should treat what is on screen as possibly incomplete. */
  trustCaveat: boolean;
}

/** Above this, a person notices the wait. */
const SLOW_MS = 2000;

/**
 * Is the platform fit to work on right now, in the reader's terms?
 *
 * The engine names are deliberately absent: naming Redis to a claims handler transfers our problem to
 * someone who cannot act on it. What they can act on is whether to trust the screen and whether to wait.
 *
 * With no probes at all this returns 'unknown' and says so, rather than 'ok'. A health summary that
 * defaults to reassuring is worse than none — it is the "empty read presented as all clear" defect, and
 * the whole reason this exists.
 */
export function platformPlain(services: readonly ServiceState[]): PlatformPlain {
  if (services.length === 0) {
    return {
      state: 'unknown',
      sentence: 'The platform’s own health could not be checked just now, so treat this screen as possibly out of date.',
      trustCaveat: true,
    };
  }

  const down = services.filter((s) => s.status === 'down');
  if (down.length > 0) {
    return {
      state: 'degraded',
      sentence:
        down.length === 1
          ? 'One part of the platform is not responding. Your cases are safe, but this screen may be missing some of them until it recovers.'
          : `${down.length} parts of the platform are not responding. Your cases are safe, but this screen may be missing some of them until they recover.`,
      trustCaveat: true,
    };
  }

  const slow = services.filter((s) => typeof s.ms === 'number' && (s.ms ?? 0) > SLOW_MS);
  if (slow.length > 0) {
    return {
      state: 'slow',
      // Not a caveat on trust: slow is complete, just late. Saying "may be missing some" here would
      // teach the reader to distrust a screen that is in fact correct.
      sentence: 'The platform is running slowly at the moment, so cases may take longer than usual to finish.',
      trustCaveat: false,
    };
  }

  return {
    state: 'ok',
    sentence: 'Everything this app needs is running normally.',
    trustCaveat: false,
  };
}

// ─── Where this app's data came from ─────────────────────────────────────────────────────────────────
//
// Lineage (Marquez, the lineage graph, the lineage runs surface) is real and its value never reached the
// app. I first recorded per-app lineage as impossible because there is no join from an app to the
// warehouse catalogue — and there isn't. But the app's OWN steps declare the domains they read, and each
// domain names the connector and resource behind it. That is a genuine, per-app answer to "where did this
// come from", assembled from what the app itself declares rather than from a catalogue it is not
// connected to.

export interface ReadSource {
  /** The domain's label, as the business calls it. */
  label: string;
  /** The system it comes from, e.g. "Core Banking (Postgres)". */
  system: string;
  /** The table/collection/path inside that system. */
  resource: string;
}

export interface LineageLine {
  label: string;
  /** "from Core Banking · customers" — the chain, in one readable line. */
  origin: string;
}

/**
 * One line per thing the app reads: what it is, and where it comes from.
 *
 * A source whose system we cannot name is DROPPED rather than shown as "from unknown": a reader learns
 * nothing from that, and a lineage list that pads itself with unknowns reads as more complete than it is.
 */
export function describeLineage(sources: readonly ReadSource[]): LineageLine[] {
  const out: LineageLine[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const system = s.system?.trim();
    if (!system) continue;
    const key = `${s.label}|${system}|${s.resource}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const resource = s.resource?.trim();
    out.push({
      label: s.label,
      origin: resource ? `from ${system} · ${resource}` : `from ${system}`,
    });
  }
  return out;
}
