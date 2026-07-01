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

// Best-effort human title for a saved artifact: an HTML <title>, a leading markdown/comment
// heading, or a kind-based fallback. Keeps the library readable without asking the user.
export function artifactTitle(a: Artifact): string {
  const title = a.code.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  if (title) return title.slice(0, 80);
  const heading = a.code.match(/^\s*(?:\/\/|#|<!--)?\s*#{0,3}\s*([A-Za-z][^\n]{2,60})/)?.[1]?.trim();
  if (heading && /[a-z]/i.test(heading)) return heading.slice(0, 80);
  const label = a.kind === 'code' ? (a.language ?? 'code') : a.kind;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} artifact`;
}

export function parseArtifact(content: string): Artifact | null {
  // 1. React: combine all jsx/tsx/react fenced blocks into one scope.
  const reactBlocks = [...content.matchAll(/```(?:jsx|tsx|react)\s*\n([\s\S]*?)```/gi)].map((b) =>
    b[1].trim(),
  );
  if (reactBlocks.length) return { kind: 'react', code: reactBlocks.join('\n\n') };

  // 2. Single html / svg / mermaid fenced block.
  const m = content.match(/```(html|svg|mermaid)\s*\n([\s\S]*?)```/i);
  if (m) return { kind: m[1].toLowerCase() as ArtifactKind, code: m[2].trim() };

  // 3. Plain js/ts blocks that look like React.
  const jsBlocks = [...content.matchAll(/```(?:javascript|js|typescript|ts)\s*\n([\s\S]*?)```/gi)].map(
    (b) => b[1].trim(),
  );
  if (jsBlocks.length && jsBlocks.some((b) => JSX_SIGNAL.test(b))) {
    return { kind: 'react', code: jsBlocks.join('\n\n') };
  }

  // 4. Bare <svg>…</svg> with no fence.
  const svg = content.match(/<svg[\s\S]*<\/svg>/i);
  if (svg) return { kind: 'svg', code: svg[0] };

  // 5. Runnable code: a python or node/js block (that isn't React) → executable via the sandbox.
  const py = content.match(/```(?:python|py)\s*\n([\s\S]*?)```/i);
  if (py) return { kind: 'code', code: py[1].trim(), language: 'python' };
  if (jsBlocks.length) return { kind: 'code', code: jsBlocks.join('\n\n'), language: 'node' };

  return null;
}
