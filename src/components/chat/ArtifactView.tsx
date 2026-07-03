'use client';

import { ArrowCounterClockwise, Code, Eye, Play, Sparkle, X } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type Artifact, buildSrcDoc, isLiveKind } from '@/lib/artifacts';
import { Markdown } from './Markdown';

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  refused?: string;
  engine: string;
}

// Side panel that renders a detected artifact. HTML/SVG run live in a sandboxed iframe
// (no same-origin, no top navigation); text renders as markdown; runnable code (python/node) gets a
// Run button that executes it in the console sandbox adapter and shows stdout/stderr inline.
// eslint-disable-next-line complexity
export function ArtifactView({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  // Live kinds render in the sandboxed iframe: html/svg inline, react (Babel+UMD) and mermaid via
  // CDN libs loaded inside the frame. The AI bridge (window.offgrid.complete) is enabled so
  // generated apps can call the local model through the console proxy.
  const live = isLiveKind(artifact.kind);
  const runnable = artifact.kind === 'code';
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  // In-place editing: local code edits re-render the preview live. Reset restores the original.
  const [code, setCode] = useState(artifact.code);
  const [editing, setEditing] = useState(false);
  // S7 refine loop: plain-language change requests re-generate the artifact and re-render.
  const [refineInput, setRefineInput] = useState('');
  const [refining, setRefining] = useState(false);
  const dirty = code !== artifact.code;

  async function refine() {
    const instruction = refineInput.trim();
    if (!instruction || refining) return;
    setRefining(true);
    try {
      const r = await fetch('/api/v1/chat/artifacts/refine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, instruction, kind: artifact.kind, language: artifact.language }),
      });
      const d = (await r.json()) as { code?: string; error?: string };
      if (!r.ok || !d.code) { toast.error(d.error ?? 'Refine failed.'); return; }
      setCode(d.code);
      setRefineInput('');
      toast.success('Updated.');
    } catch {
      toast.error('Refine failed — gateway unreachable.');
    } finally {
      setRefining(false);
    }
  }
  const current: Artifact = { ...artifact, code };
  const srcDoc = buildSrcDoc(current, { bridge: true });

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch('/api/v1/chat/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language: artifact.language ?? 'python', code }),
      });
      const d = await r.json();
      setResult(d.result ?? null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full w-[45%] min-w-[360px] flex-col border-l border-border bg-card">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Artifact · {artifact.kind}
          {artifact.language ? ` · ${artifact.language}` : ''}
        </span>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={() => setCode(artifact.code)} title="Revert to original">
              <ArrowCounterClockwise className="size-3.5" /> Reset
            </Button>
          ) : null}
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setEditing((v) => !v)}>
            {editing ? <><Eye className="size-3.5" /> Preview</> : <><Code className="size-3.5" /> Edit</>}
          </Button>
          {runnable ? (
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={run} disabled={running}>
              <Play className="size-3.5" /> {running ? 'Running…' : 'Run'}
            </Button>
          ) : null}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {editing ? (
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none border-0 bg-background p-4 font-mono text-xs text-foreground focus:outline-none"
          />
        ) : live ? (
          <iframe
            title="artifact"
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-white"
            srcDoc={srcDoc}
          />
        ) : artifact.kind === 'text' ? (
          <div className="p-4">
            <Markdown>{code}</Markdown>
          </div>
        ) : (
          <pre className="m-4 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
            {code}
          </pre>
        )}
        {result ? (
          <div className="mx-4 mb-4 space-y-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Output · {result.engine}
              {result.timedOut ? ' · timed out' : ''}
              {result.exitCode !== null ? ` · exit ${result.exitCode}` : ''}
            </div>
            {result.refused ? (
              <pre className="overflow-x-auto rounded-md border border-amber-500/40 bg-amber-500/10 p-2 font-mono text-xs text-foreground">
                {result.refused}
              </pre>
            ) : null}
            {result.stdout ? (
              <pre className="overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                {result.stdout}
              </pre>
            ) : null}
            {result.stderr ? (
              <pre className="overflow-x-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 font-mono text-xs">
                {result.stderr}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* S7 refine bar — describe a change, the app re-generates + re-renders */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border p-2">
        <Sparkle className="size-4 shrink-0 text-primary" />
        <Input
          value={refineInput}
          onChange={(e) => setRefineInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void refine(); }}
          placeholder={refining ? 'Updating…' : 'Ask AI to change this — e.g. “add a dark mode toggle”'}
          disabled={refining}
          className="h-8 text-xs"
        />
        <Button size="sm" className="h-8 shrink-0" onClick={refine} disabled={refining || !refineInput.trim()}>
          {refining ? '…' : 'Update'}
        </Button>
      </div>
    </div>
  );
}
