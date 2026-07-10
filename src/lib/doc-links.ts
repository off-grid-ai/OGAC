// Off Grid Console — documentation link-checker: PURE logic (#226).
//
// Zero-IO, unit-testable rules for the docs:links gate. The thin I/O runner
// (scripts/check-doc-links.mjs) walks the markdown files, extracts links, and
// resolves/reports them; every DECISION it makes lives here so it can be tested
// without touching the filesystem or the network.
//
// Gate policy (docs:links):
//   • INTERNAL links (relative paths + in-repo anchors) → FAIL the build if the
//     target file/section does not exist. These are fully under our control; a
//     broken internal link is a real docs defect we can and must fix.
//   • EXTERNAL links (http/https/mailto) → WARN only. Reachability depends on the
//     network and third-party uptime; making the gate depend on it would flake
//     CI. We surface them for a human, but never block a push/merge on them.

/** Classification of a single markdown link for gate purposes. */
export type LinkKind = 'internal' | 'external' | 'ignored';

/**
 * Classify a raw markdown link target.
 *   - external: has a URL scheme we treat as off-repo (http, https, mailto, tel,
 *     ftp) — WARN only.
 *   - ignored: pure in-page anchors (`#section`), `file:`/non-navigational
 *     schemes, AND repo-ABSOLUTE (`/…`) links. A leading-`/` link in our docs is
 *     an IN-APP ROUTE reference (e.g. `/fleet-control`, `/handbook/agent-qa`), a
 *     live Next.js page — NOT a repo file on disk. Verifying app routes is out of
 *     scope for a docs link-checker (the build + route tests own that), so we
 *     don't fail on them and don't false-positive them as missing files.
 *   - internal: a RELATIVE repo path (`./x`, `../x`, or bare `x/y.md`), optionally
 *     with a `#anchor` — unambiguously a file on disk. FAIL if the target is
 *     missing (a real, fixable docs defect fully under our control).
 */
export function classifyLink(raw: string): LinkKind {
  const link = raw.trim();
  if (link.length === 0) return 'ignored';
  // Pure in-page anchor — points within the same document; we don't verify
  // heading anchors (heading→slug rules are renderer-specific), so ignore.
  if (link.startsWith('#')) return 'ignored';
  // A URL scheme like `https:`, `mailto:`, `tel:` — external, warn-only.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    // Protocol-relative URLs (`//host/…`) are also external.
    return s === 'file' ? 'ignored' : 'external';
  }
  if (link.startsWith('//')) return 'external';
  // Repo-absolute `/…` → an in-app route reference, not a filesystem path.
  if (link.startsWith('/')) return 'ignored';
  return 'internal';
}

/**
 * Split an internal link into its path part and optional `#fragment`.
 * `./a/b.md#section` → { path: './a/b.md', fragment: 'section' }
 * `#top`             → { path: '', fragment: 'top' }  (caller treats empty path
 *                       as "same file", already handled by classify → ignored)
 */
export function splitFragment(link: string): { path: string; fragment: string | null } {
  const hash = link.indexOf('#');
  if (hash === -1) return { path: link, fragment: null };
  return { path: link.slice(0, hash), fragment: link.slice(hash + 1) || null };
}

/**
 * Extract every markdown link target from a document's text. Covers:
 *   • inline links  `[text](target)`  (target may be `<...>`-wrapped or `"title"`-suffixed)
 *   • reference defs `[id]: target`
 * Returns targets in source order (duplicates kept — each occurrence is a link
 * a reader can click, so each is checked). Code spans/fences are stripped first
 * so example links inside ``` blocks are not treated as real links.
 */
export function extractLinks(markdown: string): string[] {
  const text = stripCode(markdown);
  const out: string[] = [];

  // Inline: [text](target ...) — target is up to the first whitespace or ).
  const inline = /\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)/g;
  for (let m = inline.exec(text); m !== null; m = inline.exec(text)) {
    out.push(unwrap(m[1]));
  }
  // Reference definitions: [id]: target "title"
  const ref = /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm;
  for (let m = ref.exec(text); m !== null; m = ref.exec(text)) {
    out.push(unwrap(m[1]));
  }
  return out;
}

/** Strip fenced (``` / ~~~) and inline (`code`) spans so their contents are not parsed as links. */
function stripCode(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

/** Remove `<...>` angle-wrapping from a link target, if present. */
function unwrap(target: string): string {
  const t = target.trim();
  return t.startsWith('<') && t.endsWith('>') ? t.slice(1, -1).trim() : t;
}

/** A single classified finding, ready for the runner to report/aggregate. */
export interface LinkFinding {
  file: string;
  link: string;
  kind: LinkKind;
}

/**
 * Decide the process exit code from all findings + a set of internal links the
 * runner has resolved as BROKEN (missing target file). Pure: the runner does
 * the filesystem lookups and hands us the broken set; we own the pass/fail rule.
 *   → exit 1 if ANY internal link is broken; else 0 (external warnings never fail).
 */
export function gateExitCode(brokenInternalCount: number): number {
  return brokenInternalCount > 0 ? 1 : 0;
}
