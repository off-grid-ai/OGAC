// ─── PURE Postgres-safe string sanitization ─────────────────────────────────────────────────────
//
// Postgres rejects the NUL codepoint U+0000 in BOTH text and jsonb columns ("unsupported Unicode
// escape sequence" / json_errsave_error). A run persists user/model/guard-derived strings (query,
// answer, steps, citations, checks, provenance) — any one carrying a NUL makes the whole INSERT
// throw, and the run is LOST. NULs reach us from: the guardrail masked-text sentinel, model output,
// LLM Guard sanitized text, and retrieved documents. This strips NULs at the persist boundary so a
// run can never be dropped by an unstorable byte. Zero I/O; unit-testable.

/** Remove NUL (U+0000) from a string — the one codepoint Postgres text/jsonb cannot store. */
export function stripNul(s: string): string {
  return s.replaceAll('\u0000', '');
}

/**
 * Recursively strip NUL from every string in a value (objects, arrays, nested). PURE. Returns the
 * same shape with NUL-free strings; non-string leaves (number/boolean/null) pass through untouched.
 * Used to sanitize a whole run-row value object before a jsonb/text INSERT.
 */
export function deepStripNul<T>(value: T): T {
  if (typeof value === 'string') return stripNul(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepStripNul(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepStripNul(v);
    return out as T;
  }
  return value;
}
