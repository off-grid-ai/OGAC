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
import { useMemo, useState } from 'react';
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
  Input: '#0ea5e9',
  Connector: '#2563eb',
  Data: '#7c3aed',
  Guardrail: '#dc2626',
  Tool: '#0891b2',
  Agent: '#059669',
  Human: '#ca8a04',
  Model: '#d97706',
  Output: '#db2777',
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
        width: 168,
        fontSize: 11,
        fontFamily: 'Menlo, monospace',
        borderRadius: 10,
        border: '1px solid #e5e7eb',
        borderLeft: `4px solid ${COLOR[b.group]}`,
        background: '#fff',
        whiteSpace: 'pre-line',
        textAlign: 'left',
        padding: '7px 9px',
      },
    } as Node;
  });
}

const EXAMPLES = [
  'When a claim email comes in, mask PII and have the FNOL agent draft a first-notice-of-loss grounded in the claims SOP, with a human review before it sends.',
  'On a schedule, summarize top-performer sessions into an onboarding SOP and export a signed report.',
  'On an advisor call, transcribe on-device and surface the objection playbook to the console.',
];

// eslint-disable-next-line complexity
export function StudioCanvas({ catalog }: { catalog: Catalog }) {
  const base = useMemo(() => layout(catalog.blocks), [catalog]);
  const byId = useMemo(() => new Map(catalog.blocks.map((b) => [b.id, b])), [catalog]);
  const [nodes, setNodes] = useState<Node[]>(base);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [wf, setWf] = useState<Workflow | null>(null);

  // "Run as app" preview state
  const [appOpen, setAppOpen] = useState(false);
  const [runInput, setRunInput] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'approve' | 'done'>('idle');
  const [output, setOutput] = useState('');

  const trigger = wf?.nodeIds.map((id) => byId.get(id)).find((b) => b?.group === 'Input');
  const human = wf?.nodeIds.map((id) => byId.get(id)).find((b) => b?.group === 'Human');
  const sink = wf?.nodeIds.map((id) => byId.get(id)).find((b) => b?.group === 'Output');
  const agent = wf?.nodeIds.map((id) => byId.get(id)).find((b) => b?.group === 'Agent');

  async function compose() {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/v1/admin/compose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const { workflow } = (await r.json()) as { workflow: Workflow };
      setWf(workflow);
      const active = new Set(workflow.nodeIds);
      setNodes(base.map((n) => ({ ...n, style: { ...n.style, opacity: active.has(n.id) ? 1 : 0.18, boxShadow: active.has(n.id) ? '0 0 0 2px #059669' : 'none' } })));
      setEdges(workflow.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, label: e.label, animated: true, markerEnd: { type: MarkerType.ArrowClosed, color: '#059669' }, style: { stroke: '#059669', strokeWidth: 2 }, labelStyle: { fontFamily: 'Menlo, monospace', fontSize: 10 } })));
    } finally {
      setBusy(false);
    }
  }

  async function runApp() {
    setPhase('running');
    setOutput('');
    try {
      const r = await fetch('/api/v1/admin/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: runInput || prompt, system: agent ? `You are the ${agent.label}. ${wf?.summary ?? ''}` : '' }),
      });
      const { output: out } = await r.json();
      setOutput(out || '(no output)');
    } catch {
      setOutput('(run failed — gateway unavailable)');
    }
    setPhase(human ? 'approve' : 'done');
  }

  return (
    <div className="flex h-[calc(100vh-150px)] gap-4">
      <div className="flex w-[360px] flex-col gap-3 overflow-auto">
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the workflow in plain language — trigger, what it does, and where the result goes…" className="min-h-[130px] font-mono text-sm" />
        <Button onClick={compose} disabled={busy} className="w-full">{busy ? 'Composing…' : 'Compose workflow'}</Button>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Try</p>
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setPrompt(ex)} className="block w-full rounded-md border border-border p-2 text-left text-xs text-muted-foreground hover:border-primary hover:text-foreground">{ex}</button>
          ))}
        </div>
        {wf ? (
          <div className="mt-1 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-semibold">{wf.title}</p>
            <p className="text-xs text-muted-foreground">{wf.summary}</p>
            <p className="text-[10px] uppercase tracking-wide text-primary">{wf.nodeIds.length} blocks · {wf.edges.length} links{human ? ' · human-in-the-loop' : ''}</p>
            <div className="flex flex-wrap gap-1 pt-1 text-[10px]">
              {trigger ? <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-700">in: {trigger.label}</span> : null}
              {human ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">⏸ {human.label}</span> : null}
              {sink ? <span className="rounded bg-pink-100 px-1.5 py-0.5 text-pink-700">out: {sink.label}</span> : null}
            </div>
            <Button size="sm" className="mt-1 w-full" onClick={() => { setAppOpen(true); setPhase('idle'); setOutput(''); }}>▶ Run as app</Button>
          </div>
        ) : null}
      </div>
      <div className="flex-1 rounded-xl border border-border bg-[#fafafa]">
        <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
          <Background gap={20} color="#e5e7eb" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Generated app surface (stub for non-text triggers; text path is live through the gateway) */}
      <Dialog open={appOpen} onOpenChange={setAppOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{wf?.title ?? 'Workflow'}</DialogTitle>
            <DialogDescription>Generated app preview · in: {trigger?.label ?? 'Manual'} → out: {sink?.label ?? 'Console'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {trigger && trigger.id !== 'input:manual' ? (
              <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">Trigger: <b>{trigger.label}</b> — fires automatically in production. Enter a sample input to preview:</p>
            ) : null}
            <Textarea value={runInput} onChange={(e) => setRunInput(e.target.value)} placeholder="End-user input (e.g. the claim details / the question)…" className="min-h-[90px] font-mono text-sm" />
            <Button onClick={runApp} disabled={phase === 'running'} className="w-full">{phase === 'running' ? 'Running…' : 'Run'}</Button>

            {phase === 'approve' ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-800">⏸ {human?.label ?? 'Human review'} required</p>
                <p className="mt-1 text-xs text-amber-700">The result is held for a human before it reaches {sink?.label ?? 'the output'}.</p>
                <Button size="sm" className="mt-2" onClick={() => setPhase('done')}>Approve & deliver</Button>
              </div>
            ) : null}

            {output && (phase === 'approve' || phase === 'done') ? (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Result{phase === 'done' && sink ? ` → ${sink.label}` : ' (pending approval)'}</p>
                <p className="whitespace-pre-wrap text-sm">{output}</p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
