'use client';

import { ArrowCounterClockwise, Code, Eye, FloppyDisk, Play, Sparkle, X } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type Artifact,
  artifactSavePayload,
  buildSrcDoc,
  canSaveArtifact,
  isArtifactDirty,
  isLiveKind,
} from '@/lib/artifacts';
import { ArtifactEditor } from './ArtifactEditor';
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
export function ArtifactView({
  artifact,
  onClose,
  title,
  conversationId,
  onSaved,
}: {
  artifact: Artifact;
  onClose: () => void;
  // Persist context: `title` + `conversationId` key the EXISTING save route to the same logical
  // artifact row so Save appends a NEW VERSION rather than creating a duplicate. Both optional so
  // the viewer still works (edit + live preview) when opened without library context.
  title?: string;
  conversationId?: string | null;
  onSaved?: (id: string) => void;
}) {
  // Live kinds render in the sandboxed iframe: html/svg inline, react (Babel+UMD) and mermaid via
  // CDN libs loaded inside the frame. The AI bridge (window.offgrid.complete) is enabled so
  // generated apps can call the local model through the console proxy.
  const live = isLiveKind(artifact.kind);
  const runnable = artifact.kind === 'code';
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  // In-place editing: local code edits re-render the preview live. The baseline is the last SAVED
  // code — Save advances it, Cancel/Reset restores it. Starts as the code we opened with.
  const [baseline, setBaseline] = useState(artifact.code);
  const [code, setCode] = useState(artifact.code);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // S7 refine loop: plain-language change requests re-generate the artifact and re-render.
  const [refineInput, setRefineInput] = useState('');
  const [refining, setRefining] = useState(false);
  const dirty = isArtifactDirty(baseline, code);
  const savable = canSaveArtifact(baseline, code);

  // Persist the edited buffer as a new version through the EXISTING artifacts route. saveArtifact
  // versions server-side by (user, conversation, title): identical code is a no-op, changed code
  // appends a version + advances the head. We pass the original title so the edit lands on the
  // same logical row instead of forking a new artifact when an HTML <title> changed mid-edit.
  async function save() {
    if (!savable || saving) return;
    setSaving(true);
    try {
      const payload = artifactSavePayload(
        { kind: artifact.kind, code, language: artifact.language },
        { title, conversationId },
      );
      const r = await fetch('/api/v1/chat/artifacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = (await r.json()) as { id?: string; error?: string };
      if (!r.ok || !d.id) {
        toast.error(d.error ?? 'Save failed.');
        return;
      }
      setBaseline(code); // new saved baseline — Cancel now reverts to the edited version
      toast.success('Saved new version.');
      onSaved?.(d.id);
    } catch {
      toast.error('Save failed — could not reach the console.');
    } finally {
      setSaving(false);
    }
  }

  // Cancel/Reset an in-progress edit: drop the buffer back to the last saved baseline.
  function cancelEdit() {
    setCode(baseline);
  }

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
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={cancelEdit} title="Discard edits, revert to last saved">
              <ArrowCounterClockwise className="size-3.5" /> Cancel
            </Button>
          ) : null}
          {savable ? (
            <Button size="sm" className="h-7 gap-1.5" onClick={save} disabled={saving} title="Save as a new version">
              <FloppyDisk className="size-3.5" /> {saving ? 'Saving…' : 'Save'}
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
          <ArtifactEditor value={code} onChange={setCode} onSave={save} onCancel={cancelEdit} />
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
