'use client';

import { Code, Copy } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { buildSrcDoc, isLiveKind } from '@/lib/artifacts';

// Read-only public renderer for a published artifact. Standalone (no console chrome). CDN libs
// are allowed here (unlike the AI-bridge sandbox) so react/mermaid render for viewers.
export function PublicArtifact({
  artifact,
  url,
}: {
  artifact: { id: string; kind: string; code: string; language: string | null; title: string };
  url: string;
}) {
  const [showEmbed, setShowEmbed] = useState(false);
  const live = isLiveKind(artifact.kind);
  const embed = `<iframe src="${url}" style="width:100%;height:600px;border:0" sandbox="allow-scripts"></iframe>`;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          {artifact.title} · {artifact.kind}
          {artifact.language ? ` · ${artifact.language}` : ''}
        </span>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <button
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              toast.success('Link copied');
            }}
          >
            <Copy className="size-3.5" /> Copy link
          </button>
          <button
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setShowEmbed((v) => !v)}
          >
            <Code className="size-3.5" /> Embed
          </button>
        </div>
      </header>
      {showEmbed ? (
        <div className="border-b border-border bg-card px-4 py-2">
          <button
            type="button"
            aria-label="Copy the embed code"
            title="Click to copy"
            className="block w-full cursor-pointer text-left"
            onClick={() => {
              void navigator.clipboard.writeText(embed);
              toast.success('Embed code copied');
            }}
          >
            <pre className="overflow-x-auto rounded border border-border bg-background p-2 font-mono text-[11px]">
              {embed}
            </pre>
          </button>
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        {live ? (
          <iframe
            title={artifact.title}
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-white"
            srcDoc={buildSrcDoc(artifact)}
          />
        ) : (
          <pre className="m-4 overflow-x-auto rounded-md border border-border bg-card p-3 font-mono text-xs">
            {artifact.code}
          </pre>
        )}
      </div>
      <footer className="shrink-0 border-t border-border px-4 py-1.5 text-center font-mono text-[10px] text-muted-foreground">
        Published from Off Grid AI Console
      </footer>
    </div>
  );
}
