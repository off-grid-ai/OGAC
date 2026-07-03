'use client';

import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BookOpen,
  FloppyDisk,
  Globe,
  Lock,
  Play,
  Sparkle,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { Block, Catalog, Workflow } from '@/lib/studio';

const COLS: Block['group'][] = ['Input', 'Connector', 'Data', 'Guardrail', 'Tool', 'Agent', 'Human', 'Model', 'Output'];
const COLOR: Record<Block['group'], string> = {
  Input: '#0ea5e9', Connector: '#2563eb', Data: '#7c3aed', Guardrail: '#dc2626',
  Tool: '#0891b2', Agent: '#059669', Human: '#ca8a04', Model: '#d97706', Output: '#db2777',
};

function layout(blocks: Block[]): Node[] {
  const perCol: Record<string, number> = {};
  return blocks.map((b) => {
    const col = COLS.indexOf(b.group);
    const row = (perCol[b.group] = (perCol[b.group] ?? 0) + 1) - 1;
    return {
      id: b.id,
      position: { x: col * 200, y: 70 + row * 76 },
      data: { label: `${b.label}${b.sub ? `\n${b.sub}` : ''}` },
      style: {
        width: 168, fontSize: 11, fontFamily: 'Menlo, monospace', borderRadius: 10,
        border: '1px solid #e5e7eb', borderLeft: `4px solid ${COLOR[b.group]}`,
        background: '#fff', whiteSpace: 'pre-line', textAlign: 'left', padding: '7px 9px',
      },
    } as Node;
  });
}

const EXAMPLES = [
  'When a claim email comes in, mask PII and have the FNOL agent draft a first-notice-of-loss grounded in the claims SOP, with a human review before it sends.',
  'On a schedule, summarize top-performer sessions into an onboarding SOP and export a signed report.',
  'On an advisor call, transcribe on-device and surface the objection playbook to the console.',
  'Every morning, pull the top 5 support tickets from Zendesk, categorise them, and post a summary to Slack.',
];

interface SavedTemplate {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  workflow: Workflow;
  visibility: string;
  ownerId: string;
  createdAt: string;
}

// ── Gallery ───────────────────────────────────────────────────────────────────

function Gallery({
  onLoad,
  currentUserId,
}: {
  onLoad: (t: SavedTemplate) => void;
  currentUserId?: string;
}) {
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/v1/studio/templates');
      if (r.ok) setTemplates(((await r.json()) as { templates: SavedTemplate[] }).templates);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const del = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/v1/studio/templates/${id}`, { method: 'DELETE' });
    void refresh();
    toast.success('Template deleted.');
  };

  const toggleVisibility = async (t: SavedTemplate) => {
    const next = t.visibility === 'org' ? 'private' : 'org';
    await fetch(`/api/v1/studio/templates/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: next }),
    });
    void refresh();
    toast.success(next === 'org' ? 'Shared with org.' : 'Made private.');
  };

  if (loading) return <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>;
  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <BookOpen className="size-7 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">No saved workflows yet.<br />Compose one and hit Save.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {templates.map((t) => (
        <div
          key={t.id}
          className="group cursor-pointer rounded-lg border border-border bg-background p-3 hover:border-primary/50 hover:bg-muted/30"
          onClick={() => onLoad(t)}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-foreground leading-snug">{t.title}</p>
            <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
              {t.ownerId === currentUserId && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); void toggleVisibility(t); }}
                    title={t.visibility === 'org' ? 'Make private' : 'Share with org'}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t.visibility === 'org'
                      ? <Globe className="size-3.5" />
                      : <Lock className="size-3.5" />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void del(t.id); }}
                    className="text-destructive hover:text-destructive/80"
                  >
                    <Trash className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{t.summary}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
              {t.workflow.nodeIds.length} blocks
            </Badge>
            {t.visibility === 'org' && (
              <Badge variant="outline" className="gap-1 px-1 py-0 text-[10px]">
                <Globe className="size-2.5" /> shared
              </Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main canvas ───────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
export function StudioCanvas({ catalog, userId }: { catalog: Catalog; userId?: string }) {
  const allNodes = useMemo(() => layout(catalog.blocks), [catalog]);
  const byId = useMemo(() => new Map(catalog.blocks.map((b) => [b.id, b])), [catalog]);

  const [nodes, setNodes] = useState<Node[]>([]);    // empty until composed
  const [edges, setEdges] = useState<Edge[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [wf, setWf] = useState<Workflow | null>(null);
  const [tab, setTab] = useState<'build' | 'gallery'>('build');
  const [saving, setSaving] = useState(false);

  // Run-as-app state
  const [appOpen, setAppOpen] = useState(false);
  const [runInput, setRunInput] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'approve' | 'done'>('idle');
  const [output, setOutput] = useState('');
  const [governed, setGoverned] = useState<string | null>(null);
  const [steps, setSteps] = useState<{ kind: string; label: string; detail: string }[]>([]);

  const trigger = wf?.nodeIds.map((id) => byId.get(id)).find((b) => b?.group === 'Input');
  const human   = wf?.nodeIds.map((id) => byId.get(id)).find((b) => b?.group === 'Human');
  const sink    = wf?.nodeIds.map((id) => byId.get(id)).find((b) => b?.group === 'Output');
  const agent   = wf?.nodeIds.map((id) => byId.get(id)).find((b) => b?.group === 'Agent');

  function applyWorkflow(workflow: Workflow) {
    const active = new Set(workflow.nodeIds);
    setNodes(allNodes.map((n) => ({
      ...n,
      style: {
        ...n.style,
        opacity: active.has(n.id) ? 1 : 0.12,
        boxShadow: active.has(n.id) ? '0 0 0 2px #059669' : 'none',
      },
    })));
    setEdges(workflow.edges.map((e, i) => ({
      id: `e${i}`, source: e.from, target: e.to, label: e.label, animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#059669' },
      style: { stroke: '#059669', strokeWidth: 2 },
      labelStyle: { fontFamily: 'Menlo, monospace', fontSize: 10 },
    })));
    setWf(workflow);
  }

  async function compose() {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/v1/admin/compose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!r.ok) { toast.error('Compose failed — gateway may be offline.'); return; }
      const { workflow } = (await r.json()) as { workflow: Workflow };
      applyWorkflow(workflow);
    } finally {
      setBusy(false);
    }
  }

  async function save(visibility: 'private' | 'org') {
    if (!wf) return;
    setSaving(true);
    try {
      const r = await fetch('/api/v1/studio/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: wf.title, summary: wf.summary, prompt, workflow: wf, visibility }),
      });
      if (r.ok) {
        toast.success(visibility === 'org' ? 'Shared with your org.' : 'Saved to your gallery.');
        setTab('gallery');
      } else {
        toast.error('Save failed.');
      }
    } finally { setSaving(false); }
  }

  async function runApp() {
    setPhase('running');
    setOutput('');
    setGoverned(null);
    setSteps([]);
    try {
      const r = await fetch('/api/v1/admin/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: runInput || prompt,
          // Pass the composed Agent block so the run goes through the governed pipeline
          // (ABAC + guardrails + grounding + Temporal), not a bare model call.
          agentId: agent?.id,
          system: agent ? `You are the ${agent.label}. ${wf?.summary ?? ''}` : '',
        }),
      });
      const d = await r.json() as { output: string; governed?: boolean; status?: string; error?: string; steps?: { kind: string; label: string; detail: string }[] };
      setOutput(d.output || d.error || '(no output)');
      if (d.governed) setGoverned(d.status ?? 'ok');
      setSteps(d.steps ?? []);
    } catch {
      setOutput('(run failed — gateway unavailable)');
    }
    setPhase(human ? 'approve' : 'done');
  }

  const isEmpty = nodes.length === 0;

  return (
    <div className="flex h-[calc(100vh-160px)] gap-4">
      {/* ── Left panel ── */}
      <div className="flex w-[340px] shrink-0 flex-col gap-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Tabs */}
        <div className="flex border-b border-border">
          {(['build', 'gallery'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${
                tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'gallery' ? 'Saved' : 'Build'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'build' ? (
            <div className="space-y-3">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want in plain English — what triggers it, what it does, where the result goes…"
                className="min-h-[120px] resize-none font-mono text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void compose(); }}
              />
              <Button onClick={compose} disabled={busy || !prompt.trim()} className="w-full gap-2">
                <Sparkle className="size-4" />
                {busy ? 'Building…' : 'Build workflow'}
              </Button>

              {/* Examples */}
              {!wf && (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Examples</p>
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setPrompt(ex)}
                      className="block w-full rounded-md border border-border p-2 text-left text-[11px] text-muted-foreground hover:border-primary/50 hover:bg-muted/30 hover:text-foreground"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}

              {/* Workflow summary */}
              {wf && (
                <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-semibold text-foreground">{wf.title}</p>
                  <p className="text-xs text-muted-foreground">{wf.summary}</p>
                  <p className="text-[10px] uppercase tracking-wide text-primary">
                    {wf.nodeIds.length} steps · {wf.edges.length} connections{human ? ' · human review' : ''}
                  </p>

                  <div className="flex flex-wrap gap-1 pt-0.5 text-[10px]">
                    {trigger && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-700">in: {trigger.label}</span>}
                    {human   && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">⏸ {human.label}</span>}
                    {sink    && <span className="rounded bg-pink-100 px-1.5 py-0.5 text-pink-700">out: {sink.label}</span>}
                  </div>

                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" className="flex-1 gap-1.5" onClick={() => { setAppOpen(true); setPhase('idle'); setOutput(''); }}>
                      <Play className="size-3.5" /> Try it
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void save('private')} disabled={saving}>
                      <Lock className="size-3.5" /> Save
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void save('org')} disabled={saving}>
                      <Globe className="size-3.5" /> Share
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Gallery
              onLoad={(t) => {
                setPrompt(t.prompt);
                applyWorkflow(t.workflow);
                setTab('build');
              }}
              currentUserId={userId}
            />
          )}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div className="relative flex-1 overflow-hidden rounded-xl border border-border bg-[#fafafa]">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Sparkle className="size-10 text-muted-foreground/30" />
            <p className="max-w-xs text-sm text-muted-foreground">
              Describe your workflow on the left and hit <strong>Build workflow</strong>.
              <br />
              <span className="text-xs">No technical knowledge needed.</span>
            </p>
          </div>
        ) : (
          <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
            <Background gap={20} color="#e5e7eb" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}

        {/* Clear button when workflow is shown */}
        {!isEmpty && (
          <button
            onClick={() => { setNodes([]); setEdges([]); setWf(null); }}
            className="absolute right-3 top-3 rounded-md border border-border bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
            title="Clear canvas"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* ── Run-as-app dialog ── */}
      <Dialog open={appOpen} onOpenChange={setAppOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{wf?.title ?? 'Try your workflow'}</DialogTitle>
            <DialogDescription>
              {trigger?.label ?? 'Manual'} → {sink?.label ?? 'Console'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {trigger && trigger.id !== 'input:manual' && (
              <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
                Trigger: <strong>{trigger.label}</strong> — fires automatically in production. Enter a sample to preview:
              </p>
            )}
            <Textarea
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
              placeholder="Type the input (e.g. the claim details, the question, the document content)…"
              className="min-h-[90px] font-mono text-sm"
            />
            <Button onClick={runApp} disabled={phase === 'running'} className="w-full gap-2">
              <Play className="size-4" />
              {phase === 'running' ? 'Running…' : 'Run'}
            </Button>

            {phase === 'approve' && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-800">⏸ {human?.label ?? 'Human review'} required</p>
                <p className="mt-1 text-xs text-amber-700">
                  The result is held for a human before reaching {sink?.label ?? 'the output'}.
                </p>
                <Button size="sm" className="mt-2" onClick={() => setPhase('done')}>
                  Approve &amp; deliver
                </Button>
              </div>
            )}

            {output && (phase === 'approve' || phase === 'done') && (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Result{phase === 'done' && sink ? ` → ${sink.label}` : ' (pending approval)'}
                  {governed && (
                    <span className={`rounded px-1.5 py-0.5 text-[9px] normal-case ${
                      governed === 'ok' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                    }`}>
                      {governed === 'ok' ? '✓ governed — policy + guardrails passed' : `⚠ ${governed} by governance`}
                    </span>
                  )}
                </p>
                <p className="whitespace-pre-wrap text-sm">{output}</p>
                {steps.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground">
                      Governance trace ({steps.length} steps)
                    </summary>
                    <ol className="mt-1 space-y-0.5 border-l border-border pl-3">
                      {steps.map((s, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground">
                          <span className="font-mono text-foreground">{s.kind}</span>
                          {s.label ? ` · ${s.label}` : ''}{s.detail ? ` — ${s.detail}` : ''}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
