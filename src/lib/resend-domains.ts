// ─── Self-serve SENDING-DOMAIN verification via Resend (NO domain transfer) ───────────────────────
//
// To send from the customer's OWN domain (e.g. mail.acmebank.co) Resend must verify the customer
// controls it. We NEVER touch their DNS — we register the domain with Resend, get back the DNS records
// Resend needs (SPF / DKIM / DMARC / return-path (MX)), and HAND those records to the customer to paste
// into THEIR OWN DNS. A "check verification" action re-reads the domain's status. This module owns:
//
//   • registerDomain(name, region)  — POST /domains → normalize the returned records (I/O + pure shape)
//   • getDomain(id)                  — GET  /domains/:id → the current status + records (poll for verify)
//   • verifyDomain(id)               — POST /domains/:id/verify → ask Resend to (re)check the DNS
//   • deleteDomain(id)               — DELETE /domains/:id (remove a registration)
//
// SOLID: normalizeDomainRecords + normalizeDomain (PURE) map Resend's response into a stable, minimal
// shape {domain, status, records[]} we store — unit-tested without any network. The four functions
// above are the thin fetch wrappers (I/O). The API key is the SAME vaulted resend_api_key the send
// sink uses (resolveResendApiKey) — never hardcoded.

import { RESEND_ENDPOINT, resolveResendApiKey } from '@/lib/adapters/sinks/email-resend';

const DOMAINS_ENDPOINT = RESEND_ENDPOINT.replace(/\/emails$/, '/domains');

// ─── the stable shape we surface + store ─────────────────────────────────────────────────────────
export type DomainStatus = 'not_started' | 'pending' | 'verified' | 'failed' | 'temporary_failure';

export interface DomainDnsRecord {
  /** SPF | DKIM | DMARC | MX (return-path) — the human category for the console table. */
  purpose: 'SPF' | 'DKIM' | 'DMARC' | 'MX' | 'OTHER';
  /** DNS record type Resend returned (TXT | MX | CNAME). */
  type: string;
  /** The host/name the customer creates the record at (e.g. "resend._domainkey.mail.acme.co"). */
  name: string;
  /** The record value to paste (the TXT string, the MX target, etc.). */
  value: string;
  /** TTL Resend suggests (may be absent). */
  ttl?: string;
  /** MX priority when type === MX. */
  priority?: number;
  /** Per-record verification status Resend reports (verified / pending / …). */
  status?: string;
}

export interface SendingDomain {
  id: string;
  domain: string;
  status: DomainStatus;
  region?: string;
  records: DomainDnsRecord[];
  createdAt?: string;
}

// ─── PURE normalization ──────────────────────────────────────────────────────────────────────────

const VALID_STATUS: DomainStatus[] = [
  'not_started',
  'pending',
  'verified',
  'failed',
  'temporary_failure',
];

/** Coerce Resend's status string into our DomainStatus. PURE. Unknown → 'pending' (safe default). */
export function normalizeStatus(raw: unknown): DomainStatus {
  return typeof raw === 'string' && (VALID_STATUS as string[]).includes(raw)
    ? (raw as DomainStatus)
    : 'pending';
}

/**
 * Classify a Resend DNS record into the SPF/DKIM/DMARC/MX purpose the console shows. PURE.
 * Resend labels records by `record` ("SPF"/"DKIM"/"DMARC") and/or by type+name; we derive a stable
 * category so the customer sees WHY each record exists, not just an opaque TXT blob.
 */
export function classifyRecordPurpose(rec: {
  record?: unknown;
  type?: unknown;
  name?: unknown;
}): DomainDnsRecord['purpose'] {
  const label = String(rec.record ?? '').toUpperCase();
  if (label.includes('SPF')) return 'SPF';
  if (label.includes('DKIM')) return 'DKIM';
  if (label.includes('DMARC')) return 'DMARC';
  const type = String(rec.type ?? '').toUpperCase();
  const name = String(rec.name ?? '').toLowerCase();
  if (type === 'MX') return 'MX';
  if (name.includes('_dmarc')) return 'DMARC';
  if (name.includes('_domainkey') || name.includes('dkim')) return 'DKIM';
  if (type === 'TXT') return 'SPF'; // a bare TXT on the root is the SPF record
  return 'OTHER';
}

/** Normalize ONE raw Resend DNS record into our DomainDnsRecord. PURE. */
export function normalizeDnsRecord(raw: unknown): DomainDnsRecord {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rec: DomainDnsRecord = {
    purpose: classifyRecordPurpose(r),
    type: String(r.type ?? 'TXT').toUpperCase(),
    name: String(r.name ?? '').trim(),
    value: String(r.value ?? '').trim(),
  };
  if (typeof r.ttl === 'string' || typeof r.ttl === 'number') rec.ttl = String(r.ttl);
  if (typeof r.priority === 'number') rec.priority = r.priority;
  if (typeof r.status === 'string') rec.status = r.status;
  return rec;
}

/** Normalize the records array (defensive against a non-array / missing field). PURE. */
export function normalizeDomainRecords(raw: unknown): DomainDnsRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeDnsRecord).filter((r) => r.name.length > 0 || r.value.length > 0);
}

/** Normalize a full Resend domain object into our SendingDomain shape. PURE. */
export function normalizeDomain(raw: unknown): SendingDomain {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(d.id ?? '').trim(),
    domain: String(d.name ?? d.domain ?? '').trim(),
    status: normalizeStatus(d.status),
    region: typeof d.region === 'string' ? d.region : undefined,
    records: normalizeDomainRecords(d.records),
    createdAt: typeof d.created_at === 'string' ? d.created_at : undefined,
  };
}

/**
 * Validate a sending-domain name before we register it. PURE. A very small structural check — a bare
 * apex or sub-domain (labels of letters/digits/hyphens, at least one dot). We reject a URL / email /
 * whitespace so the console can't POST a garbage value to Resend.
 */
export function isValidDomain(name: string): boolean {
  const v = (name ?? '').trim().toLowerCase();
  if (!v || /\s/.test(v) || v.includes('@') || v.includes('/')) return false;
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v);
}

// ─── thin I/O ──────────────────────────────────────────────────────────────────────────────────
export interface DomainOpResult<T> {
  ok: boolean;
  configured: boolean;
  data?: T;
  reason: string;
}

async function authHeader(env: NodeJS.ProcessEnv): Promise<string | null> {
  const key = await resolveResendApiKey(env);
  return key ? `Bearer ${key}` : null;
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function errMsg(json: Record<string, unknown> | null, status: number): string {
  const m = json?.message ?? json?.error ?? (json?.name as unknown);
  return typeof m === 'string' ? m : `Resend responded ${status}`;
}

/** Register a sending domain with Resend + return the DNS records the customer must add. */
export async function registerDomain(
  name: string,
  region: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DomainOpResult<SendingDomain>> {
  if (!isValidDomain(name)) {
    return { ok: false, configured: true, reason: `"${name}" is not a valid domain name` };
  }
  const auth = await authHeader(env);
  if (!auth) return { ok: false, configured: false, reason: 'Resend not configured — no API key (vault resend_api_key or RESEND_API_KEY env).' };
  try {
    const res = await fetchImpl(DOMAINS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(region ? { name: name.trim(), region } : { name: name.trim() }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await readJson(res);
    if (!res.ok) return { ok: false, configured: true, reason: errMsg(json, res.status) };
    return { ok: true, configured: true, data: normalizeDomain(json), reason: 'domain registered — add the DNS records below to YOUR DNS, then verify' };
  } catch (e) {
    return { ok: false, configured: true, reason: `Resend domain register failed: ${(e as Error).message}` };
  }
}

/** Read a domain's current status + records (poll for verification). */
export async function getDomain(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DomainOpResult<SendingDomain>> {
  const auth = await authHeader(env);
  if (!auth) return { ok: false, configured: false, reason: 'Resend not configured — no API key.' };
  try {
    const res = await fetchImpl(`${DOMAINS_ENDPOINT}/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await readJson(res);
    if (!res.ok) return { ok: false, configured: true, reason: errMsg(json, res.status) };
    return { ok: true, configured: true, data: normalizeDomain(json), reason: 'ok' };
  } catch (e) {
    return { ok: false, configured: true, reason: `Resend domain lookup failed: ${(e as Error).message}` };
  }
}

/** Ask Resend to (re)check the domain's DNS — the "check verification" action. */
export async function verifyDomain(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DomainOpResult<SendingDomain>> {
  const auth = await authHeader(env);
  if (!auth) return { ok: false, configured: false, reason: 'Resend not configured — no API key.' };
  try {
    const res = await fetchImpl(`${DOMAINS_ENDPOINT}/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await readJson(res);
    if (!res.ok) return { ok: false, configured: true, reason: errMsg(json, res.status) };
    // Resend's verify response is thin; re-read the full domain for the fresh status + records.
    return getDomain(id, env, fetchImpl);
  } catch (e) {
    return { ok: false, configured: true, reason: `Resend domain verify failed: ${(e as Error).message}` };
  }
}

/** Delete a domain registration. */
export async function deleteDomain(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DomainOpResult<{ id: string }>> {
  const auth = await authHeader(env);
  if (!auth) return { ok: false, configured: false, reason: 'Resend not configured — no API key.' };
  try {
    const res = await fetchImpl(`${DOMAINS_ENDPOINT}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 404) {
      const json = await readJson(res);
      return { ok: false, configured: true, reason: errMsg(json, res.status) };
    }
    return { ok: true, configured: true, data: { id }, reason: 'domain deleted' };
  } catch (e) {
    return { ok: false, configured: true, reason: `Resend domain delete failed: ${(e as Error).message}` };
  }
}
