// Artifact detection — ported from Off Grid AI Desktop's ArtifactCanvas parser. Pulls a
// renderable artifact (html / svg / mermaid / react / markdown) out of a model reply so the
// chat can show it side-by-side. Detection only; rendering happens in the client canvas.

export type ArtifactKind = 'html' | 'svg' | 'mermaid' | 'react' | 'text';
export interface Artifact {
  kind: ArtifactKind;
  code: string;
}

const JSX_SIGNAL =
  /(<[A-Za-z][^>]*>|<\/[A-Za-z]|=>\s*\(?\s*<|React\.|useState|ReactDOM|export default function|className=)/;

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

  return null;
}
