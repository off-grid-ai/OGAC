// Provit INTELLIGENCE ENGINE — the console-brokered surface over Provit's real HTTP API.
//
// What Provit actually exposes (evidence: provit/src/ui/server.ts):
//   • POST /api/ingest?repo=<github-url>      → maps a repo into a feature plan (fire-and-forget job)
//   • GET  /api/ingest/status                 → { running, phase, message, error, repo }
//   • GET  /api/repos                         → mapped repos (feature map + generated test counts)
//   • GET  /api/features?repo=<id>            → one repo's full feature plan
//   • POST /api/chat  { repo, messages }      → SSE token stream from Provit's test COPILOT, which
//                                                itself runs on the console's gateway (oracle).
//
// Provit's own oracle points at `${console}/api/v1/gateway/v1` (provit/src/core/provider.ts), so
// this intelligence rides the SAME gateway the console fronts — we BRIDGE to it, we do not
// duplicate it.
//
// LAYERING (SOLID): the network I/O lives in the async fns at the bottom; all request/response
// SHAPING is PURE (zero imports, zero I/O) so it is unit-testable against representative Provit
// responses with no mocks and no network — mirrors src/lib/provit.ts (normalizeShowcase).

import { provitBaseUrl } from '@/lib/provit';

// ── PURE shaping ──────────────────────────────────────────────────────────────────────────────

export interface ProvitRepoSummary {
  id: string;
  url: string;
  name: string;
  features: number;
  cases: number;
  screens: number;
  hasSession: boolean;
  runCount: number;
  latestRunId?: string;
  latestRunFlagged: number;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Normalize Provit's GET /api/repos array into a stable summary list. Never throws; drops entries
// with no id. Tolerant of the several count shapes Provit has shipped (top-level or counts.*).
export function normalizeRepos(raw: unknown): ProvitRepoSummary[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ProvitRepoSummary[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const counts = (o.counts && typeof o.counts === 'object' ? (o.counts as Record<string, unknown>) : {}) as Record<string, unknown>;
    const id = str(o.id) ?? str(o.name);
    if (!id) continue;
    const url = str(o.url) ?? '';
    out.push({
      id,
      url,
      name: str(o.name) ?? (url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') || id),
      features: num(o.features) || num(counts.features),
      // Provit shows the tests it GENERATED (generatedCases) when a session exists, else corpus cases.
      cases: num(o.generatedCases) || num(o.cases) || num(counts.cases),
      screens: num(o.screens) || num(counts.screens),
      hasSession: o.hasSession === true,
      runCount: num(o.runCount),
      latestRunId: str(o.latestRunId),
      latestRunFlagged: num(o.latestRunFlagged),
    });
  }
  return out;
}

export interface IngestStatus {
  running: boolean;
  phase: string;
  message: string;
  error: string | null;
  repo: string | null;
}

// Normalize Provit's GET /api/ingest/status. Never throws — an unreachable Provit yields an idle
// status carrying the error, so the UI degrades honestly.
export function normalizeIngestStatus(raw: unknown, fallbackError?: string): IngestStatus {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    running: o.running === true,
    phase: str(o.phase) ?? (fallbackError ? 'error' : 'idle'),
    message: str(o.message) ?? '',
    error: str(o.error) ?? fallbackError ?? null,
    repo: str(o.repo) ?? null,
  };
}

const GH_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/i;

// PURE: validate + normalize the ONE thing Provit's public HTTP intake accepts — a public GitHub
// URL (evidence: provit/src/core/tryDemo.ts normalizeGithubUrl + server.ts /api/ingest). Returns
// { url } or { error }; never throws. Keep this in lockstep with Provit's own validator.
export function validateRepoTarget(raw: string): { url: string } | { error: string } {
  const url = (raw || '').trim();
  if (!GH_URL.test(url)) {
    return { error: 'Enter a public GitHub repo URL, e.g. https://github.com/owner/repo' };
  }
  return { url: url.replace(/\/$/, '').replace(/\.git$/i, '') };
}

// PURE: parse one SSE `data:` line from Provit's /api/chat stream into a delta / error / done
// signal. Provit emits `data: {"delta"|"error"|"done"}` frames (server.ts streamGatewayChat).
export type ChatFrame = { delta: string } | { error: string } | { done: true } | null;
export function parseChatFrame(line: string): ChatFrame {
  const t = (line || '').trim();
  if (!t.startsWith('data:')) return null;
  const payload = t.slice(5).trim();
  if (!payload) return null;
  if (payload === '[DONE]') return { done: true };
  try {
    const j = JSON.parse(payload) as Record<string, unknown>;
    if (typeof j.delta === 'string') return { delta: j.delta };
    if (typeof j.error === 'string') return { error: j.error };
    if (j.done === true) return { done: true };
  } catch {
    /* keepalive / partial — ignore */
  }
  return null;
}

// ── I/O (thin; never throws into the caller) ────────────────────────────────────────────────────

async function provitGet(path: string, timeoutMs = 5000): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${provitBaseUrl()}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `provit ${path}: HTTP ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'provit unreachable' };
  }
}

export interface ReposResult {
  repos: ProvitRepoSummary[];
  error?: string;
}

// GET Provit's mapped repos (its intelligence output). Best-effort; never throws.
export async function getRepos(): Promise<ReposResult> {
  const r = await provitGet('/api/repos');
  if (!r.ok) return { repos: [], error: r.error };
  return { repos: normalizeRepos(r.body) };
}

// GET the live status of Provit's ingest (map-a-repo) job. Best-effort; never throws.
export async function getIngestStatus(): Promise<IngestStatus> {
  const r = await provitGet('/api/ingest/status', 4000);
  if (!r.ok) return normalizeIngestStatus(null, r.error);
  return normalizeIngestStatus(r.body);
}

export interface StartMapResult {
  started: boolean;
  repo?: string;
  error?: string;
  status?: number;
}

// POST /api/ingest?repo=<github-url> — kick Provit's map-a-repo intelligence for a public repo.
// Returns { started } or a shaped error (409 already-indexing, 400 bad url, etc.). Never throws.
export async function startMap(githubUrl: string): Promise<StartMapResult> {
  const v = validateRepoTarget(githubUrl);
  if ('error' in v) return { started: false, error: v.error, status: 400 };
  try {
    const res = await fetch(`${provitBaseUrl()}/api/ingest?repo=${encodeURIComponent(v.url)}`, {
      method: 'POST',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { started: false, error: str(body.error) ?? `provit ingest: HTTP ${res.status}`, status: res.status };
    return { started: body.started === true, repo: str(body.repo) ?? v.url };
  } catch (e) {
    return { started: false, error: e instanceof Error ? e.message : 'provit unreachable', status: 502 };
  }
}

export interface ChatResult {
  ok: boolean;
  /** The assembled assistant reply (deltas concatenated). */
  content: string;
  error?: string;
}

// POST /api/chat — Provit's test COPILOT, grounded in a repo's feature/batch context and answered
// on the console's gateway. Provit streams SSE; we consume it server-side and return the assembled
// reply so the console route stays a simple request/response (no client SSE plumbing needed).
// Never throws — a stream `error` frame or an unreachable Provit becomes { ok:false, error }.
export async function askCopilot(repo: string, messages: { role: string; content: string }[]): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(`${provitBaseUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ repo, messages: messages.slice(-12) }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    return { ok: false, content: '', error: e instanceof Error ? e.message : 'provit unreachable' };
  }
  if (!res.ok || !res.body) return { ok: false, content: '', error: `provit chat: HTTP ${res.status}` };

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let streamError: string | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const frame = parseChatFrame(line);
      if (!frame) continue;
      if ('delta' in frame) content += frame.delta;
      else if ('error' in frame) streamError = frame.error;
    }
  }
  if (streamError) return { ok: false, content, error: streamError };
  return { ok: true, content };
}
