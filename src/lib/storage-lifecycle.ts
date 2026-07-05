// Pure S3 bucket lifecycle + policy payload logic — zero I/O, unit-testable in isolation.
//
// The console's storage backend is SeaweedFS's S3 API. Two operator-facing bucket controls live here:
//   1. Lifecycle (object expiry): PutBucketLifecycleConfiguration takes an XML body; GetBucket…
//      returns XML. SeaweedFS implements a subset — Expiration.Days + a Filter prefix — so we build/
//      parse exactly that subset and nothing we can't honour.
//   2. Bucket policy (public/private): PutBucketPolicy takes a JSON policy document. A "public"
//      bucket is the canonical anonymous-read policy on arn:aws:s3:::<bucket>/*; "private" removes it
//      (DeleteBucketPolicy). SeaweedFS's S3 policy support is partial, so callers degrade gracefully
//      on a non-2xx and never fake success.
//
// All string-building and XML/JSON parsing is here (pure). files.ts is the thin I/O shell that PUTs/
// GETs these against the bucket.

export interface LifecycleRule {
  /** Rule id (defaults derived from prefix). */
  id: string;
  /** Key prefix the rule applies to; '' = whole bucket. */
  prefix: string;
  /** Delete objects this many days after creation. Must be ≥ 1. */
  expireDays: number;
  /** Rule enabled? Disabled rules are kept but not enforced. */
  enabled: boolean;
}

/** Clamp/normalise a rule from untrusted input; returns null if unusable (no positive expiry). */
export function normalizeLifecycleRule(input: {
  id?: unknown;
  prefix?: unknown;
  expireDays?: unknown;
  enabled?: unknown;
}): LifecycleRule | null {
  const rawDays = Math.floor(Number(input.expireDays));
  if (!Number.isFinite(rawDays) || rawDays < 1) return null;
  const expireDays = Math.min(rawDays, 3650);
  const prefix = typeof input.prefix === 'string' ? input.prefix : '';
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `expire-${prefix || 'all'}-${expireDays}d`;
  return {
    id: id.slice(0, 255),
    prefix: prefix.slice(0, 1024),
    expireDays,
    enabled: input.enabled !== false,
  };
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

/**
 * Build the LifecycleConfiguration XML body for PutBucketLifecycleConfiguration. An empty rule list
 * yields an empty (rule-free) configuration — the way to clear lifecycle via a PUT where DELETE isn't
 * supported.
 */
export function buildLifecycleXml(rules: LifecycleRule[]): string {
  const body = rules
    .map(
      (r) =>
        `<Rule>` +
        `<ID>${xmlEscape(r.id)}</ID>` +
        `<Filter><Prefix>${xmlEscape(r.prefix)}</Prefix></Filter>` +
        `<Status>${r.enabled ? 'Enabled' : 'Disabled'}</Status>` +
        `<Expiration><Days>${r.expireDays}</Days></Expiration>` +
        `</Rule>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</LifecycleConfiguration>`;
}

/** Parse a GetBucketLifecycleConfiguration XML response into rules (tolerant regex — no XML dep). */
export function parseLifecycleXml(xml: string): LifecycleRule[] {
  const out: LifecycleRule[] = [];
  for (const m of xml.matchAll(/<Rule>([\s\S]*?)<\/Rule>/g)) {
    const block = m[1];
    const days = Number(block.match(/<Days>\s*(\d+)\s*<\/Days>/)?.[1]);
    if (!Number.isFinite(days) || days < 1) continue; // only expiry-by-days rules are represented
    const id = block.match(/<ID>([\s\S]*?)<\/ID>/)?.[1]?.trim() ?? '';
    // Prefix can be nested under Filter (v2) or a bare <Prefix> (v1).
    const prefix = block.match(/<Prefix>([\s\S]*?)<\/Prefix>/)?.[1] ?? '';
    const status = block.match(/<Status>([\s\S]*?)<\/Status>/)?.[1]?.trim() ?? 'Enabled';
    out.push({ id: id || `expire-${prefix || 'all'}-${days}d`, prefix, expireDays: days, enabled: status !== 'Disabled' });
  }
  return out;
}

/**
 * The canonical anonymous public-read bucket policy JSON for PutBucketPolicy. `private` is represented
 * by the ABSENCE of a policy (DeleteBucketPolicy), so this builder only produces the public document.
 */
export function buildPublicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicRead',
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

/** Classify a GetBucketPolicy JSON body as 'public' (grants anonymous s3:GetObject) or 'private'. */
export function classifyBucketPolicy(policyJson: string | null): 'public' | 'private' {
  if (!policyJson) return 'private';
  try {
    const doc = JSON.parse(policyJson) as {
      Statement?: Array<{ Effect?: string; Principal?: unknown; Action?: unknown }>;
    };
    for (const st of doc.Statement ?? []) {
      if (st.Effect !== 'Allow') continue;
      const principalStar =
        st.Principal === '*' ||
        (typeof st.Principal === 'object' && st.Principal !== null && Object.values(st.Principal).some((v) => v === '*' || (Array.isArray(v) && v.includes('*'))));
      const actions = Array.isArray(st.Action) ? st.Action : [st.Action];
      const grantsGet = actions.some((a) => a === '*' || a === 's3:*' || a === 's3:GetObject');
      if (principalStar && grantsGet) return 'public';
    }
  } catch {
    /* unparseable → treat as private */
  }
  return 'private';
}
