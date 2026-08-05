// Provenance read-back — the DISPLAY layer for the signed-provenance surface (Phase 4).
//
// Two seams, deliberately split (SOLID):
//   1. `buildProvenanceView` — a PURE normalizer. ZERO imports, so it's unit-testable in isolation
//      (mirror of tenancy-policy.ts). Given raw provenance records it produces the display model:
//      verified/unverified rollup + per-record rows, newest-first. It NEVER throws — malformed,
//      missing, or empty input degrades gracefully.
//   2. `readProvenanceView` — a thin, best-effort reader that pulls recent signed records off the
//      existing provenance module (agent-run signatures verified with the active signing port) and
//      feeds them through the normalizer. All I/O lives here; the rule lives above.

// A raw provenance record as it arrives from the reader (or a test). Every field is treated as
// untrusted — the normalizer copes with anything.
export interface ProvenanceRecord {
  runId?: unknown; // the agent-run id this record signs — lets the UI re-verify it on demand
  subject?: unknown; // what was signed (e.g. an agent-run id or filename)
  signer?: unknown; // identity / algorithm that produced the signature
  sha256?: unknown; // hex digest of the signed content, if known
  /**
   * The signature itself, base64 as Ed25519 produces it. THIS is what the ledger's "Signature" column
   * is for, and reading only `sha256` is why every row rendered a dash: the retained record carries
   * `signature` + `algorithm` + `publicKey`, and no `sha256` at all.
   */
  signature?: unknown;
  algorithm?: unknown;
  verified?: unknown; // did the signature verify against the active key?
  timestamp?: unknown; // ISO-8601 signing time
}

// A normalized row ready to render — every field is a safe, typed primitive.
export interface ProvenanceRow {
  runId: string; // '' when not backed by an agent-run (e.g. a detached export manifest)
  subject: string;
  signer: string;
  sha256Short: string; // short signature or digest fingerprint, or '—' when genuinely absent
  verified: boolean;
  timestamp: string; // ISO-8601 or '' when unknown/unparseable
}

export interface ProvenanceView {
  total: number;
  verified: number;
  unverified: number;
  records: ProvenanceRow[]; // newest-first
  /**
   * Why the ledger could not be read, when it could not be.
   *
   * Present because `catch { return EMPTY }` rendered a DB outage, an import failure or a signing-key
   * error as three zero tiles and an empty table — i.e. "nothing here is signed" — on the one surface
   * whose entire purpose is proving that answers are tamper-evident. "Nothing is signed" and "we could
   * not check" are opposite facts about a deployment.
   */
  error?: string;
}

const EMPTY: ProvenanceView = { total: 0, verified: 0, unverified: 0, records: [] };

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

/**
 * A short fingerprint for the ledger's "Signature" column.
 *
 * This previously accepted HEX ONLY, and read from a `sha256` field the retained record does not have —
 * so every row on the deployment rendered '—' on the one surface whose job is proving answers are
 * tamper-evident. An Ed25519 signature is base64, which the hex test rejected even when it was passed.
 *
 * Hex is still lower-cased (a digest is conventionally shown that way); base64 keeps its case, because
 * base64 is case-significant and folding it would print something that is not the signature.
 */
function shortFingerprint(v: unknown): string {
  if (typeof v !== 'string') return '—';
  const raw = v.trim().replace(/^(sha256|ed25519):/i, '');
  if (!raw) return '—';
  if (/^[0-9a-fA-F]{8,}$/.test(raw)) return raw.slice(0, 12).toLowerCase();
  // Base64 / base64url, as every signature algorithm in use here emits.
  if (/^[A-Za-z0-9+/_=-]{8,}$/.test(raw)) return raw.slice(0, 12);
  return '—';
}

/**
 * A short, stable fingerprint identifying WHICH key signed — from a PEM block, a raw base64 key, or an
 * `alg:key` form.
 *
 * Slicing the first 16 characters of a PEM produced "-----BEGIN PUBLI…" on every row: identical for
 * every key, so it identified nothing, and it reads as a rendering bug. Stripping the armour and the
 * newlines leaves the actual key material, whose leading characters DO distinguish one key from another.
 */
function keyFingerprint(publicKey: string): string {
  const body = publicKey
    .replace(/-----(BEGIN|END)[^-]*-----/g, '')
    .replace(/^(ed25519|rsa|ecdsa):/i, '')
    .replace(/\s+/g, '')
    .trim();
  if (!body) return 'key not recorded';
  return `${body.slice(0, 12)}…`;
}

// Coerce to a stable ISO string, or '' if unparseable. Used both for the row and for sorting.
function isoTime(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = Date.parse(v);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

function normalizeRow(r: ProvenanceRecord): ProvenanceRow {
  return {
    runId: str(r?.runId, ''),
    subject: str(r?.subject, '(unknown)'),
    signer: str(r?.signer, '(unsigned)'),
    // The SIGNATURE first — that is what the column says and what the record carries. The digest is a
    // fallback for detached manifests that record one instead.
    sha256Short: (() => {
      const sig = shortFingerprint(r?.signature);
      return sig === '—' ? shortFingerprint(r?.sha256) : sig;
    })(),
    verified: r?.verified === true,
    timestamp: isoTime(r?.timestamp),
  };
}

/**
 * PURE. Build the display model from raw provenance records. Never throws.
 * Rows are sorted newest-first (unknown timestamps sort last). Non-array / nullish input → empty.
 */
export function buildProvenanceView(records: readonly ProvenanceRecord[] | null | undefined): ProvenanceView {
  if (!Array.isArray(records) || records.length === 0) return EMPTY;

  const rows = records
    .filter((r): r is ProvenanceRecord => r != null && typeof r === 'object')
    .map(normalizeRow)
    .sort((a, b) => {
      // Newest-first; empty timestamps (unknown) sink to the bottom.
      if (a.timestamp === b.timestamp) return 0;
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return a.timestamp < b.timestamp ? 1 : -1;
    });

  const verified = rows.filter((r) => r.verified).length;
  return { total: rows.length, verified, unverified: rows.length - verified, records: rows };
}

// ── Reader (I/O) ──────────────────────────────────────────────────────────────────────────────
// Best-effort: pulls recent agent-run signatures — the console's live source of signed provenance —
// re-verifies each against the active signing port, and returns the display model. Never throws;
// on any failure it returns the empty view so the page always renders.
export async function readProvenanceView(limit = 50, orgId?: string): Promise<ProvenanceView> {
  try {
    const [{ listAgentRuns }, { getSigning }, { rebuildRunPayload }] = await Promise.all([
      import('@/lib/agentrun'),
      import('@/lib/adapters/registry'),
      import('@/lib/provenance-verify'),
    ]);
    const signing = getSigning();
    const runs = await listAgentRuns(limit, orgId);

    const records: ProvenanceRecord[] = runs
      .filter((r) => r.provenance != null)
      .map((r) => {
        const p = r.provenance!;
        // Reconstruct the EXACT payload agentrun signs (incl. runId as provenanceRef — the shared
        // rebuild is the single source of truth), then re-verify with the active key.
        const payload = rebuildRunPayload(r);
        let verified = false;
        try {
          verified = signing.verify(payload, p.signature);
        } catch {
          verified = false;
        }
        return {
          runId: r.id,
          subject: `${r.agentId} · ${r.id}`,
          // The key FINGERPRINT, not the first 16 characters of a PEM block — that rendered as
          // "Ed25519 · -----BEGIN PUBLI…", which identifies nothing and looks broken on screen.
          signer: p.publicKey ? `${p.algorithm} · ${keyFingerprint(p.publicKey)}` : p.algorithm,
          signature: p.signature.replace(/^sig_/, ''),
          algorithm: p.algorithm,
          verified,
          timestamp: p.signedAt,
        };
      });

    return buildProvenanceView(records);
  } catch (e) {
    return { ...EMPTY, error: e instanceof Error ? e.message : 'the provenance ledger could not be read' };
  }
}
