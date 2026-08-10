// ─── "Common prompts" — mining the gateway's call history for what people actually ask ────────────
//
// CROSS-TENANT LEAK, found 2026-08-05 in the read-only demo audit. `GET /api/v1/prompts/common`
// queried the gateway index with `{ bool: { must: [{ exists: { field: 'input' } }] } }` — no org
// predicate of ANY kind — and returned the top 25 prompt texts to whoever asked. Measured on the live
// index: 3,338 documents carry an `input`, of which 112 belong to org_bharat and 94 to org_suraksha.
// So each tenant's demo account could read the other tenant's verbatim prompts, which is the most
// sensitive content in the system: a prompt is the customer's own question, often with their data in
// it. This is the sixth leak of the same class and it is fixed the same way.
//
// THE RULE, applied identically to the audit trail (siem.ts), AI observability, the warehouse API,
// ETL and the tenant admin list:
//
//   1. The org is a REQUIRED leading parameter, so a caller cannot omit it and get everything. A
//      forgotten argument is a type error, not a silent disclosure.
//   2. It comes from `currentOrgId()` at the call site — never from a query parameter the client
//      controls.
//   3. An UNATTRIBUTABLE record belongs to NOBODY. 3,146 of 3,479 documents in this index have
//      `org: null`, and the tempting reading — "unmarked means shared, show it to everyone" — is
//      exactly what the leak was. They are now invisible to every tenant. The surface stays useful
//      (94 and 112 prompts respectively) and, more importantly, it is honest: we cannot prove who
//      those 3,146 belong to, so we must not show them to anyone.
//
// Pure and zero-IO: the route owns the fetch, this owns the query and the tally, and the tests below
// exercise the rule directly rather than through a mocked HTTP client.

/** Longest prompt text we keep, for both the counting key and the returned sample. */
export const MAX_PROMPT_LEN = 500;

/** How many distinct prompts the surface shows. */
export const MAX_COMMON_PROMPTS = 25;

/** Documents scanned per query. */
export const SCAN_SIZE = 1000;

export interface CommonPrompt {
  prompt: string;
  count: number;
  lastSeen: string;
}

export interface GatewayInputHit {
  _source?: { input?: unknown; '@timestamp'?: string };
}

/**
 * Normalize a prompt for counting: trim, collapse whitespace, lowercase, cap length. Two prompts that
 * differ only in spacing or case are the same question and must land in one bucket.
 */
export function normalizePrompt(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_PROMPT_LEN);
}

/**
 * True when a normalized prompt is not a real question — either empty, or exactly the JS-ism a
 * caller's null/undefined value becomes once something upstream stringifies it before logging
 * ("null" via String(null), "undefined" via template interpolation). A gateway call with no real
 * input is not a common prompt; showing the literal word "null" as if a customer typed it reads as
 * broken software, and it is not going away on its own — the same upstream stringification can log
 * it again on the next call, so this is a permanent filter, not a one-off cleanup.
 */
function isInvalidPrompt(normalized: string): boolean {
  return !normalized || normalized === 'null' || normalized === 'undefined';
}

/**
 * The OpenSearch body for one org's prompt history.
 *
 * `org` is required and is applied as a `filter` term (non-scoring, cacheable). There is deliberately
 * no code path that omits it — compare the pre-fix version, whose `must` clause contained only an
 * `exists` check.
 */
export function buildCommonPromptsQuery(org: string): Record<string, unknown> {
  return {
    size: SCAN_SIZE,
    _source: ['input', '@timestamp'],
    sort: [{ '@timestamp': 'desc' }],
    query: {
      bool: {
        must: [{ exists: { field: 'input' } }],
        filter: [{ term: { 'org.keyword': org } }],
      },
    },
  };
}

/**
 * Count normalized prompts, keeping one representative original and the most recent timestamp.
 * Returns the most frequent first.
 */
export function tallyCommonPrompts(hits: readonly GatewayInputHit[]): CommonPrompt[] {
  const agg = new Map<string, CommonPrompt>();
  for (const hit of hits) {
    const raw = typeof hit._source?.input === 'string' ? hit._source.input : '';
    const key = normalizePrompt(raw);
    if (isInvalidPrompt(key)) continue;
    const ts = hit._source?.['@timestamp'] ?? '';
    const current = agg.get(key);
    if (current) {
      current.count += 1;
      if (ts > current.lastSeen) current.lastSeen = ts;
    } else {
      agg.set(key, { prompt: raw.trim().slice(0, MAX_PROMPT_LEN), count: 1, lastSeen: ts });
    }
  }
  return [...agg.values()].sort((a, b) => b.count - a.count).slice(0, MAX_COMMON_PROMPTS);
}
