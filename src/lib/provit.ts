// Provit — the visual-QA product (Phase 2), running at https://provit.getoffgridai.co.
// This client surfaces Provit inside the console: reachability + its public showcase.
//
// Layering: the network I/O lives in getShowcase()/provitHealth(); the parsing and
// normalization is a PURE function (normalizeShowcase) with zero imports and zero I/O so it
// is unit-testable with no network and no mocks (see test/provit.test.ts).

const DEFAULT_BASE_URL = 'https://provit.getoffgridai.co';

export function provitBaseUrl(): string {
  return (process.env.OFFGRID_PROVIT_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

// Provit is always addressable (public default), but a deployment can point it elsewhere.
// "Configured" means we have a non-empty base URL to talk to.
export function provitConfigured(): boolean {
  return provitBaseUrl().length > 0;
}

export interface ShowcaseItem {
  id: string;
  title: string;
  url: string;
  description?: string;
}

export interface ShowcaseResult {
  items: ShowcaseItem[];
  error?: string;
}

// PURE: normalize an arbitrary parsed JSON body into a stable ShowcaseItem[]. Never throws.
// Accepts either an array or an object with an `items`/`showcase`/`results` array. Drops entries
// that have neither a title nor a url; fills missing ids/titles with sensible fallbacks.
export function normalizeShowcase(raw: unknown): ShowcaseItem[] {
  const list = extractList(raw);
  const items: ShowcaseItem[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = normalizeItem(list[i], i);
    if (item) items.push(item);
  }
  return items;
}

function extractList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.showcase)) return obj.showcase;
    if (Array.isArray(obj.results)) return obj.results;
  }
  return [];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function normalizeItem(raw: unknown, index: number): ShowcaseItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const title = str(obj.title) ?? str(obj.name);
  const url = str(obj.url) ?? str(obj.link) ?? str(obj.href);
  // An item with neither a title nor a URL carries no usable information — drop it.
  if (!title && !url) return null;
  const description = str(obj.description) ?? str(obj.summary);
  return {
    id: str(obj.id) ?? str(obj.slug) ?? `item-${index}`,
    title: title ?? url ?? `Untitled ${index}`,
    url: url ?? '',
    ...(description ? { description } : {}),
  };
}

// GET /api/showcase — best-effort. Never throws; on any failure returns { items: [], error }.
export async function getShowcase(): Promise<ShowcaseResult> {
  const base = provitBaseUrl();
  try {
    const res = await fetch(`${base}/api/showcase`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { items: [], error: `provit showcase: HTTP ${res.status}` };
    const body: unknown = await res.json();
    return { items: normalizeShowcase(body) };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : 'provit unreachable' };
  }
}

// Best-effort reachability. Never throws.
export async function provitHealth(): Promise<{ reachable: boolean; url: string; error?: string }> {
  const url = provitBaseUrl();
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    return { reachable: res.ok, url };
  } catch (e) {
    return { reachable: false, url, error: e instanceof Error ? e.message : 'unreachable' };
  }
}
