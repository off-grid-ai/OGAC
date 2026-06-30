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
import { Textarea } from '@/components/ui/textarea';
import type { Block, Catalog, Workflow } from '@/lib/studio';

const COLS: Block['group'][] = ['Connector', 'Data', 'Guardrail', 'Tool', 'Agent', 'Model'];
const COLOR: Record<Block['group'], string> = {
  Connector: '#2563eb',
  Data: '#7c3aed',
  Guardrail: '#dc2626',
  Tool: '#0891b2',
  Agent: '#059669',
  Model: '#d97706',
};

function layout(blocks: Block[]): Node[] {
  const perCol: Record<string, number> = {};
  return blocks.map((b) => {
    const col = COLS.indexOf(b.group);
    const row = (perCol[b.group] = (perCol[b.group] ?? 0) + 1) - 1;
    return {
      id: b.id,
      position: { x: col * 240, y: 90 + row * 78 },
      data: { label: `${b.label}${b.sub ? `\n${b.sub}` : ''}` },
      style: {
        width: 190,
        fontSize: 12,
        fontFamily: 'Menlo, monospace',
        borderRadius: 10,
        border: `1px solid #e5e7eb`,
        borderLeft: `4px solid ${COLOR[b.group]}`,
        background: '#fff',
        whiteSpace: 'pre-line',
        textAlign: 'left',
        padding: '8px 10px',
      },
    } as Node;
  });
}

const EXAMPLES = [
  'When a new claim comes in, pull it from the claims connector, mask PII, and have the FNOL agent draft a first-notice-of-loss grounded in the claims SOP.',
  'Summarize top performers from captured sessions and draft an onboarding SOP, grounded in the brain.',
  'On every advisor call, transcribe on-device and surface the right objection playbook.',
];

export function StudioCanvas({ catalog }: { catalog: Catalog }) {
  const base = useMemo(() => layout(catalog.blocks), [catalog]);
  const [nodes, setNodes] = useState<Node[]>(base);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [wf, setWf] = useState<Workflow | null>(null);

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
      setNodes(
        base.map((n) => ({
          ...n,
          style: {
            ...n.style,
            opacity: active.has(n.id) ? 1 : 0.2,
            boxShadow: active.has(n.id) ? '0 0 0 2px #059669' : 'none',
          },
        })),
      );
      setEdges(
        workflow.edges.map((e, i) => ({
          id: `e${i}`,
          source: e.from,
          target: e.to,
          label: e.label,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#059669' },
          style: { stroke: '#059669', strokeWidth: 2 },
          labelStyle: { fontFamily: 'Menlo, monospace', fontSize: 10 },
        })),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-130px)] gap-4">
      {/* left: natural-language input */}
      <div className="flex w-[360px] flex-col gap-3">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the workflow in plain language. The platform wires it from your connected sources, tools, guardrails, and agents…"
          className="min-h-[160px] font-mono text-sm"
        />
        <Button onClick={compose} disabled={busy} className="w-full">
          {busy ? 'Composing…' : 'Compose workflow'}
        </Button>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Try</p>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              className="block w-full rounded-md border border-border p-2 text-left text-xs text-muted-foreground hover:border-primary hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
        {wf ? (
          <div className="mt-1 rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-semibold">{wf.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{wf.summary}</p>
            <p className="mt-2 text-[10px] uppercase tracking-wide text-primary">
              {wf.nodeIds.length} blocks · {wf.edges.length} links wired
            </p>
          </div>
        ) : null}
      </div>
      {/* right: the node graph */}
      <div className="flex-1 rounded-xl border border-border bg-[#fafafa]">
        <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
          <Background gap={20} color="#e5e7eb" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
