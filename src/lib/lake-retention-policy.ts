// ─── Retention for what a run WRITES, not only what it recorded — PURE, zero-IO ───────────────────
//
// The console's retention sweep covers database record classes: app runs, agent runs, indexed text.
// Its own note said lake purging "stays with the data engine and is reported as deferred". That was
// honest when nothing the console ran wrote to the lake. Apps can now write there (`sink: lake`), so
// the deferral has become a hole: a governed run can accumulate objects that no policy bounds, and
// "we do not keep this longer than N days" stops being true for the newest thing we produce.
//
// The enforcement mechanism is deliberately NOT a delete loop. The object store already expires
// objects on a schedule, and re-implementing that in the console would mean a second clock, a second
// failure mode, and a promise that only holds while our process is running. So the policy is PUSHED
// DOWN to the bucket's own lifecycle, and this module owns two questions:
//
//   1. Which bucket prefixes does the console actually write to? (Derived from app specs — a list
//      someone maintains by hand goes stale the first time an app is edited.)
//   2. Does what is on the bucket match the policy? Absent, matching, or DRIFTED — and drift is the
//      case that matters, because a bucket carrying a longer window than the policy claims is a
//      compliance statement that is quietly false.

/** The shape of an app spec this module needs. Deliberately minimal so it stays pure. */
export interface LakeWritingApp {
  id: string;
  title: string;
  steps?: readonly { kind: string; sink?: string; config?: Record<string, unknown> | null }[];
}

/** The shape of a data domain this module needs: which bucket and prefix it approves. */
export interface LakeDomain {
  id: string;
  label: string;
  resource: string;
}

export interface LakeWriteTarget {
  bucket: string;
  /** '' means the whole bucket. */
  prefix: string;
  domainId: string;
  domainLabel: string;
  /** Apps that write here — so an operator knows what a retention change affects. */
  writtenBy: string[];
}

/**
 * Every bucket prefix the console writes into, derived from the apps that write there.
 *
 * Derived, never configured: a hand-maintained list of "buckets we write to" is wrong the first time
 * somebody adds an output step, and the failure is silent — the policy simply stops covering the new
 * destination while still reporting itself as applied.
 */
export function lakeWriteTargets(
  apps: readonly LakeWritingApp[],
  domains: readonly LakeDomain[],
): LakeWriteTarget[] {
  const byDomain = new Map<string, LakeWriteTarget>();
  for (const app of apps) {
    for (const step of app.steps ?? []) {
      if (step.kind !== 'output' || step.sink !== 'lake') continue;
      const named = typeof step.config?.domain === 'string' ? step.config.domain.trim() : '';
      if (!named) continue;
      const domain = domains.find((d) => d.id === named || d.label === named);
      if (!domain) continue;
      const scope = parseResource(domain.resource);
      if (!scope) continue;
      const existing = byDomain.get(domain.id);
      if (existing) {
        if (!existing.writtenBy.includes(app.title)) existing.writtenBy.push(app.title);
        continue;
      }
      byDomain.set(domain.id, {
        bucket: scope.bucket,
        prefix: scope.prefix,
        domainId: domain.id,
        domainLabel: domain.label,
        writtenBy: [app.title],
      });
    }
  }
  // Stable order so two runs of the same policy produce comparable evidence.
  return [...byDomain.values()].sort((a, b) =>
    a.bucket === b.bucket ? a.prefix.localeCompare(b.prefix) : a.bucket.localeCompare(b.bucket),
  );
}

function parseResource(resource: string): { bucket: string; prefix: string } | null {
  const segments = (resource ?? '').split('/').filter(Boolean);
  const bucket = segments.shift();
  if (!bucket) return null;
  return { bucket, prefix: segments.length ? `${segments.join('/')}/` : '' };
}

/** A lifecycle rule as the store reports it — matches storage-lifecycle's LifecycleRule shape. */
export interface ExistingRule {
  id: string;
  prefix: string;
  expireDays: number;
  enabled: boolean;
}

/**
 * The largest window this store can actually hold, in days.
 *
 * MEASURED, NOT ASSUMED — live against the deployed store on 2026-08-05: setting 30 days read back as
 * 30, but 365 read back as 109 and 3650 read back as 66. Those are 365 and 3650 modulo 256: the store
 * encodes the day count in a single byte and WRAPS silently.
 *
 * This is the most dangerous shape a bug can take. A BFSI retention window is 2555 or 3650 days, so
 * exactly the values a bank or insurer needs are the ones that wrap — and they wrap DOWNWARD, which
 * means files are deleted years early while the surface reports the policy as applied. An unbounded
 * bucket is a compliance gap; this would be silent destruction of records someone is legally required
 * to hold.
 */
export const STORE_MAX_WINDOW_DAYS = 255;

/** Would this window silently wrap in the store's encoding? */
export function windowExceedsStore(retainDays: number, limit = STORE_MAX_WINDOW_DAYS): boolean {
  return retainDays > limit;
}

/**
 * What the store would ACTUALLY apply for a window it cannot hold — the number files would really be
 * deleted after. Stated explicitly so the warning can name it rather than saying "may be wrong".
 */
export function truncatedWindow(retainDays: number): number {
  return retainDays % 256;
}

export type RetentionState =
  /** No rule covers this prefix: objects accumulate with no bound at all. */
  | { state: 'absent' }
  /** A rule covers it for exactly the policy window. */
  | { state: 'matches'; days: number }
  /**
   * A rule covers it for a DIFFERENT window. Reported separately from absent because it is worse in
   * one direction: a longer window than the policy claims means the compliance statement is false
   * while the surface looks configured.
   */
  | { state: 'drifted'; found: number; expected: number; longerThanPolicy: boolean }
  /** A rule exists for the policy window but is paused, so nothing is actually expiring. */
  | { state: 'paused'; days: number }
  /**
   * The store cannot represent a window this long and would wrap it to a much shorter one. Kept
   * separate from `drifted` because the consequence is different in kind: drift is a wrong number,
   * this is records being destroyed years before they are allowed to be.
   */
  | { state: 'unrepresentable'; expected: number; wouldBecome: number };

/**
 * Does what is on the bucket match the policy?
 *
 * A rule counts only if it actually covers the target prefix. A rule on `exports/` does not bound
 * `assessments/`, and treating any rule on the bucket as coverage is how a policy reports itself
 * applied while the objects it was meant to bound are untouched.
 */
export function retentionStateFor(
  target: Pick<LakeWriteTarget, 'prefix'>,
  rules: readonly ExistingRule[],
  retainDays: number,
): RetentionState {
  // Checked BEFORE anything else: if the store cannot hold this window, what is or is not currently on
  // the bucket is beside the point — applying the policy would make things actively worse.
  if (windowExceedsStore(retainDays)) {
    return { state: 'unrepresentable', expected: retainDays, wouldBecome: truncatedWindow(retainDays) };
  }
  const covering = rules.filter((r) => covers(r.prefix, target.prefix));
  if (covering.length === 0) return { state: 'absent' };
  // The SHORTEST covering window governs — whichever rule fires first is what actually happens.
  const governing = covering.reduce((a, b) => (a.expireDays <= b.expireDays ? a : b));
  if (governing.expireDays === retainDays) {
    return governing.enabled ? { state: 'matches', days: retainDays } : { state: 'paused', days: retainDays };
  }
  return {
    state: 'drifted',
    found: governing.expireDays,
    expected: retainDays,
    longerThanPolicy: governing.expireDays > retainDays,
  };
}

/** A prefix rule covers a target when the target sits at or inside it. '' covers everything. */
function covers(rulePrefix: string, targetPrefix: string): boolean {
  if (rulePrefix === '') return true;
  return targetPrefix === rulePrefix || targetPrefix.startsWith(rulePrefix);
}

/** The rule the policy wants on this prefix. Named so a person can tell where it came from. */
export function desiredLakeRule(prefix: string, retainDays: number): ExistingRule {
  return {
    id: `offgrid-retention-${prefix ? prefix.replace(/\/$/, '').replace(/[^A-Za-z0-9._-]+/g, '-') : 'all'}-${retainDays}d`,
    prefix,
    expireDays: retainDays,
    enabled: true,
  };
}

/**
 * Merge the policy's rule into a bucket's existing rules WITHOUT discarding rules it does not own.
 *
 * A bucket can carry rules an operator or another system set. Replacing the whole list with ours
 * would silently delete them, and a deleted retention rule means data living longer than someone
 * intended — the exact failure this feature exists to prevent, caused by the feature.
 */
export function mergeLakeRule(
  existing: readonly ExistingRule[],
  desired: ExistingRule,
): ExistingRule[] {
  const kept = existing.filter((r) => r.prefix !== desired.prefix);
  return [...kept, desired].sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/** One line of evidence per target, in the language of the claim it supports. */
export function describeRetentionState(target: LakeWriteTarget, state: RetentionState): string {
  const where = `${target.domainLabel} (${target.bucket}/${target.prefix || ''})`;
  switch (state.state) {
    case 'matches':
      return `${where}: kept ${state.days} days, matching policy.`;
    case 'paused':
      return `${where}: a ${state.days}-day rule exists but is PAUSED, so nothing is being removed.`;
    case 'absent':
      return `${where}: nothing bounded how long files are kept here.`;
    case 'unrepresentable':
      return `${where}: this store cannot keep files for ${state.expected} days — it would silently reduce that to ${state.wouldBecome} days and delete them early, so NO retention rule was set here. Files are kept until something removes them.`;
    case 'drifted':
      return state.longerThanPolicy
        ? `${where}: files were kept ${state.found} days, LONGER than the ${state.expected} days policy claims.`
        : `${where}: files were kept ${state.found} days, shorter than the ${state.expected} days policy allows.`;
  }
}
