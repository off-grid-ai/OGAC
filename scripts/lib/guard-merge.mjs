// PURE merge for the guardrail aggregator — dependency-free ESM, zero I/O.
//
// The console's guardrail port (src/lib/adapters/guardrail-provider.ts) POSTs a prompt to ONE
// LLM Guard `/analyze/prompt` and expects ONE verdict:
//   { is_valid: boolean, scanners: { "<Scanner>": <score>, … }, sanitized_prompt: "…" }
//
// The full scanner suite OOMs a single 7.8 GB OrbStack VM, so we SHARD the scanners across fleet
// nodes (S1 = PII/DLP + substrings, S2 = the heavy transformer classifiers) and put the aggregator
// in front. This function folds the per-shard verdicts back into the single shape the console reads,
// so the console never learns the engine is sharded. It is the whole policy of the aggregator and is
// isolated here (no http, no env) so it is exhaustively unit-testable.
//
// A shard result is `{ name, required, ok, status, body }` where `body` is the shard's raw
// `/analyze/prompt` JSON (or null when the shard errored/was unreachable — `ok:false`).
//
// MERGE POLICY:
//   • is_valid  — AND over every shard that ANSWERED (ok). A prompt is valid only if no scanner on
//     any reachable shard tripped. A shard whose body omits is_valid is treated as valid (no trip).
//   • scanners  — the union of every answering shard's scanners map (disjoint scanner sets per shard,
//     so there are no key collisions; on the off chance of one, the lower/riskier score is kept).
//   • sanitized_prompt — only the redacting shard (Anonymize/Secrets/Regex) rewrites text, so we take
//     the sanitized_prompt from the shard that actually CHANGED the original; otherwise the original.
//
// FAIL-CLOSED vs DEGRADE (the aggregator's reliability seam):
//   • A REQUIRED shard that failed ⇒ `blocked:true` — the aggregator must return non-2xx so the
//     console fails closed (a guardrail can't be bypassed by killing its engine).
//   • An OPTIONAL shard that failed ⇒ `degraded` lists it; the verdict stands on the shards that DID
//     answer. This keeps the always-on PII shard (required, on-box) authoritative while an auxiliary
//     classifier node (optional) being down never takes the whole platform's governed runs offline.

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Extract a shard body's scanner map as finite [name, score] pairs (ignore malformed entries).
function scannerPairs(body) {
  if (!isObj(body) || !isObj(body.scanners)) return [];
  return Object.entries(body.scanners).filter(
    ([, s]) => typeof s === 'number' && Number.isFinite(s),
  );
}

/**
 * Merge shard `/analyze/prompt` verdicts into one. PURE.
 *
 * @param {string} original                    the prompt as received
 * @param {Array<{name:string,required?:boolean,ok:boolean,status?:number,body?:any}>} shards
 * @returns {{ merged: object, blocked: boolean, degraded: string[], answered: string[] }}
 *   merged   — the single { is_valid, scanners, sanitized_prompt } the console consumes
 *   blocked  — true iff a REQUIRED shard failed (caller returns non-2xx ⇒ console fails closed)
 *   degraded — names of OPTIONAL shards that failed (verdict still stands on the answering shards)
 *   answered — names of shards that returned a usable verdict
 */
export function mergeGuardResponses(original, shards) {
  const list = Array.isArray(shards) ? shards : [];
  const blocked = list.some((s) => s && s.required && !s.ok);
  const degraded = list.filter((s) => s && !s.required && !s.ok).map((s) => s.name);
  const answered = list.filter((s) => s && s.ok).map((s) => s.name);

  const scanners = {};
  let anyInvalid = false;
  let sanitized = typeof original === 'string' ? original : '';

  for (const s of list) {
    if (!s || !s.ok) continue;
    const body = s.body;
    if (body && (body.is_valid === false || body.is_valid === 'false')) anyInvalid = true;
    for (const [name, score] of scannerPairs(body)) {
      // Disjoint sets in practice; if a name repeats, keep the riskier (lower) score so a trip on
      // any shard is never masked by a clean score elsewhere.
      scanners[name] = name in scanners ? Math.min(scanners[name], score) : score;
    }
    // The redacting shard is the one whose sanitized_prompt differs from the original.
    const sp = isObj(body) ? body.sanitized_prompt : undefined;
    if (typeof sp === 'string' && sp !== original) sanitized = sp;
  }

  return {
    merged: { is_valid: !anyInvalid, scanners, sanitized_prompt: sanitized },
    blocked,
    degraded,
    answered,
  };
}
