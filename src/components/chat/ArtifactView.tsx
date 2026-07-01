'use client';

import { X } from '@phosphor-icons/react/dist/ssr';
import type { Artifact } from '@/lib/artifacts';
import { Markdown } from './Markdown';

// Side panel that renders a detected artifact. HTML/SVG run live in a sandboxed iframe
// (no same-origin, no top navigation); text renders as markdown. React/mermaid preview is a
// Phase-4 add — for now their source is shown so nothing is lost.
export function ArtifactView({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const live = artifact.kind === 'html' || artifact.kind === 'svg';
  const srcDoc =
    artifact.kind === 'svg'
      ? `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0a0a">${artifact.code}`
      : artifact.code;

  return (
    <div className="flex h-full w-[45%] min-w-[360px] flex-col border-l border-border bg-card">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Artifact · {artifact.kind}
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {live ? (
          <iframe
            title="artifact"
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-white"
            srcDoc={srcDoc}
          />
        ) : artifact.kind === 'text' ? (
          <div className="p-4">
            <Markdown>{artifact.code}</Markdown>
          </div>
        ) : (
          <pre className="m-4 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
            {artifact.code}
          </pre>
        )}
      </div>
    </div>
  );
}
