// Pure data-shaping helpers for the Workspace grid surfaces (Projects, Prompts, Artifacts). Zero
// imports, no I/O, no React — so the card-meta logic (relative time, previews, initials, tag
// extraction) is unit-testable in isolation and the components stay thin presenters. See
// test/workspace-grid.test.ts.

/** Compact relative-time label for a card's "updated" meta ("just now", "3d", "2mo", "1y"). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
}

/** Two-letter uppercase initials for an avatar tile, derived from a title. */
export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words.at(-1)![0]).toUpperCase();
}

/** Collapse a prompt/instruction body to a single-line preview, trimmed to `max` chars. */
export function preview(text: string | null | undefined, max = 160): string {
  const one = (text ?? '').replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1).trimEnd()}…`;
}

/** Extract {{variable}} names from a prompt body (deduped, in first-seen order). */
export function templateVariables(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * A deterministic accent-hue (0–360) for a card, derived from its id/title so tiles get stable,
 * distinct color without storing one. Pure hash → hue; same input always yields the same hue.
 */
export function accentHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}
