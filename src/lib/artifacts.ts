// Artifact detection — ported from Off Grid AI Desktop's ArtifactCanvas parser. Pulls a
// renderable artifact (html / svg / mermaid / react / markdown) out of a model reply so the
// chat can show it side-by-side. Detection only; rendering happens in the client canvas.

export type ArtifactKind = 'html' | 'svg' | 'mermaid' | 'react' | 'text' | 'code';
export interface Artifact {
  kind: ArtifactKind;
  code: string;
  language?: 'python' | 'node'; // set for runnable `code` artifacts
}

const JSX_SIGNAL =
  /(<[A-Za-z][^>]*>|<\/[A-Za-z]|=>\s*\(?\s*<|React\.|useState|ReactDOM|export default function|className=)/;

// Whether a kind renders live in the sandboxed iframe (vs. shown as source/markdown).
export function isLiveKind(kind: string): boolean {
  return kind === 'html' || kind === 'svg' || kind === 'react' || kind === 'mermaid';
}

// Build the iframe srcDoc for a live artifact. HTML passes through; SVG is centered on a dark
// canvas; React (Babel + React/ReactDOM UMD) and Mermaid are bootstrapped with their libs loaded
// inside the frame. `bridge` injects the window.offgrid.complete() proxy for AI-powered apps.
// eslint-disable-next-line complexity
export function buildSrcDoc(
  a: { kind: string; code: string },
  opts: { cdn?: string; bridge?: boolean } = {},
): string {
  const cdn = opts.cdn ?? 'https://cdn.jsdelivr.net';
  const bridge = opts.bridge
    ? `<script>window.offgrid={complete:function(prompt,options){return fetch('/api/v1/chat/artifacts/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({prompt:prompt},options||{}))}).then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error);return d.text})};</script>`
    : '';
  if (a.kind === 'html') {
    return bridge ? a.code.replace(/<head[^>]*>/i, (h) => h + bridge) || bridge + a.code : a.code;
  }
  if (a.kind === 'svg') {
    return `<!doctype html><meta charset="utf-8">${bridge}<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0a0a">${a.code}`;
  }
  if (a.kind === 'mermaid') {
    return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0a0a0a;color:#e5e5e5;font-family:Menlo,monospace">
<pre class="mermaid" style="display:flex;justify-content:center;padding:16px">${escapeHtml(a.code)}</pre>
${bridge}
<script type="module">
import mermaid from '${cdn}/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true, theme: 'dark' });
</script></body>`;
  }
  // react
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">
<div id="root"></div>
${bridge}
<script src="${cdn}/npm/react@18/umd/react.production.min.js"></script>
<script src="${cdn}/npm/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="${cdn}/npm/@babel/standalone@7/babel.min.js"></script>
<script type="text/babel" data-presets="react,typescript" data-type="module">
const { useState, useEffect, useRef, useMemo, useCallback } = React;
${stripImportsExports(a.code)}
const __C = typeof App !== 'undefined' ? App
  : (typeof exports !== 'undefined' && exports.default) ? exports.default : null;
ReactDOM.createRoot(document.getElementById('root')).render(
  __C ? React.createElement(__C) : React.createElement('pre', { style: { padding: 16, color: '#b00' } },
    'No default export or App component found.'));
</script></body>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

// Strip ES module import/export syntax so the code runs in Babel's script scope. `export default
// function App` → `function App`; bare `export default <expr>` → `exports.default = <expr>`.
function stripImportsExports(code: string): string {
  return code
    .replace(/^\s*import\s+.*?;?\s*$/gm, '')
    .replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/g, 'function $1')
    .replace(/export\s+default\s+/g, 'window.exports = window.exports || {}; exports.default = ')
    .replace(/^\s*export\s+(const|let|var|function|class)\s/gm, '$1 ');
}

// Best-effort human title for a saved artifact: an HTML <title>, a leading markdown/comment
// heading, or a kind-based fallback. Keeps the library readable without asking the user.
// eslint-disable-next-line complexity
export function artifactTitle(a: Artifact): string {
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(a.code)?.[1]?.trim();
  if (title) return title.slice(0, 80);
  const heading = /^\s*(?:\/\/|#|<!--)?\s*#{0,3}\s*([A-Za-z][^\n]{2,60})/.exec(a.code)?.[1]?.trim();
  if (heading && /[a-z]/i.test(heading)) return heading.slice(0, 80);
  const label = a.kind === 'code' ? (a.language ?? 'code') : a.kind;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} artifact`;
}

// ─── Inline editing (task #92) ──────────────────────────────────────────────
// Pure helpers for the in-place artifact editor. Zero I/O, unit-testable. The viewer keeps a
// local `code` buffer while editing; these decide when it's savable and shape the persist body
// the EXISTING `POST /api/v1/chat/artifacts` route consumes (which versions server-side by
// (user, conversation, title) — identical code is a no-op, changed code appends a new version).

// Body accepted by POST /api/v1/chat/artifacts. Matches saveArtifact()'s expected fields.
export interface ArtifactSavePayload {
  kind: string;
  code: string;
  language: string | null;
  title: string;
  conversationId: string | null;
}

// True when the edited buffer differs from the saved/original code (trailing whitespace ignored so
// a stray newline doesn't count as a change).
export function isArtifactDirty(original: string, edited: string): boolean {
  return edited.trim() !== original.trim();
}

// Whether a Save should be allowed: there must be a real change AND non-empty content. We never
// persist an empty artifact (a useless version) and never a no-op.
export function canSaveArtifact(original: string, edited: string): boolean {
  return edited.trim().length > 0 && isArtifactDirty(original, edited);
}

// Build the persist body for the edited artifact. `title` defaults to the derived title of the
// EDITED content (via artifactTitle); callers pass the original title through to guarantee the new
// version lands on the same logical row (saveArtifact keys on (user, conversation, title)).
export function artifactSavePayload(
  a: { kind: string; code: string; language?: string | null },
  opts: { title?: string; conversationId?: string | null } = {},
): ArtifactSavePayload {
  const code = a.code;
  const title =
    opts.title?.trim() ||
    artifactTitle({
      kind: a.kind as ArtifactKind,
      code,
      language: (a.language ?? undefined) as Artifact['language'],
    });
  return {
    kind: a.kind,
    code,
    language: a.language ?? null,
    title,
    conversationId: opts.conversationId ?? null,
  };
}

export function parseArtifact(content: string): Artifact | null {
  // 1. React: combine all jsx/tsx/react fenced blocks into one scope.
  const reactBlocks = [...content.matchAll(/```(?:jsx|tsx|react)\s*\n([\s\S]*?)```/gi)].map((b) =>
    b[1].trim(),
  );
  if (reactBlocks.length) return { kind: 'react', code: reactBlocks.join('\n\n') };

  // 2. Single html / svg / mermaid fenced block.
  const m = /```(html|svg|mermaid)\s*\n([\s\S]*?)```/i.exec(content);
  if (m) return { kind: m[1].toLowerCase() as ArtifactKind, code: m[2].trim() };

  // 3. Plain js/ts blocks that look like React.
  const jsBlocks = [...content.matchAll(/```(?:javascript|js|typescript|ts)\s*\n([\s\S]*?)```/gi)].map(
    (b) => b[1].trim(),
  );
  if (jsBlocks.length && jsBlocks.some((b) => JSX_SIGNAL.test(b))) {
    return { kind: 'react', code: jsBlocks.join('\n\n') };
  }

  // 4. Bare <svg>…</svg> with no fence.
  const svg = /<svg[\s\S]*<\/svg>/i.exec(content);
  if (svg) return { kind: 'svg', code: svg[0] };

  // 5. Runnable code: a python or node/js block (that isn't React) → executable via the sandbox.
  const py = /```(?:python|py)\s*\n([\s\S]*?)```/i.exec(content);
  if (py) return { kind: 'code', code: py[1].trim(), language: 'python' };
  if (jsBlocks.length) return { kind: 'code', code: jsBlocks.join('\n\n'), language: 'node' };

  return null;
}
