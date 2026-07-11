'use client';

import {
  Background,
  Controls,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FloppyDisk, Play, Plus, Trash, Warning } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { RedactionAction } from '@/lib/data-redaction';
import {
  addNode,
  connectNodes,
  disconnectNodes,
  moveNode,
  relabelNode,
  removeNode,
  setTrigger,
  updateNodeConfig,
} from '@/lib/etl-dag-edit';
import {
  validateDagSpec,
  type EtlDagSpec,
  type EtlNode,
  type EtlNodeConfig,
  type EtlNodeKind,
  type EtlTransformKind,
  type FilterOp,
  type CastType,
  type AggFn,
  type EtlRunView,
} from '@/lib/etl-job';
import { EtlRunHistory } from './EtlRunHistory';

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// The transform palette (product language — no engine names).
const TRANSFORMS: { kind: EtlTransformKind; label: string; hint: string }[] = [
  { kind: 'filter', label: 'Filter', hint: 'Keep rows matching a condition' },
  { kind: 'select', label: 'Select', hint: 'Keep only chosen columns' },
  { kind: 'rename', label: 'Rename', hint: 'Rename a column' },
  { kind: 'cast', label: 'Cast', hint: 'Change a column type' },
  { kind: 'derive', label: 'Derive', hint: 'Add a computed column' },
  { kind: 'redact', label: 'Redact', hint: 'Mask/hash/drop a sensitive column' },
  { kind: 'join', label: 'Join', hint: 'Enrich from a second source' },
  { kind: 'aggregate', label: 'Aggregate', hint: 'Group + summarize' },
  { kind: 'dedupe', label: 'Dedupe', hint: 'Drop duplicate rows' },
  { kind: 'limit', label: 'Limit', hint: 'Cap the row count' },
];

const REDACT_ACTIONS: { value: RedactionAction; label: string }[] = [
  { value: 'mask', label: 'Mask (keep last 4)' },
  { value: 'hash', label: 'Hash (join-safe)' },
  { value: 'tokenize', label: 'Tokenize' },
  { value: 'drop', label: 'Drop' },
  { value: 'detect', label: 'Detect PII + redact' },
];

// Node fill by kind — emerald for the source/destination endpoints, neutral for transforms.
function nodeColor(kind: string): string {
  if (kind === 'source') return '#059669';
  if (kind === 'destination') return '#047857';
  return '#6b7280';
}

// Per-kind one-line config summaries. Split from the old switch into a dispatch table so each
// arm's ternary lives in its own tiny formatter (flat cognitive complexity) — behaviour-identical
// to the previous switch, arm for arm.
type ConfigSummary = (c: EtlNodeConfig) => string;
const NODE_SUMMARY_BY_KIND: Partial<Record<EtlNodeKind, ConfigSummary>> = {
  source: (c) =>
    c.resource ? `${c.connectorId ?? '?'} · ${c.resource}` : 'pick a connector + table',
  destination: (c) =>
    c.database && c.table ? `${c.database}.${c.table}` : 'pick a warehouse table',
  filter: (c) => (c.column ? `${c.column} ${c.op ?? ''} ${c.value ?? ''}` : 'set a condition'),
  select: (c) => (c.columns ?? []).join(', ') || 'choose columns',
  dedupe: (c) => (c.columns ?? []).join(', ') || 'choose columns',
  rename: (c) => (c.from && c.to ? `${c.from} → ${c.to}` : 'from → to'),
  cast: (c) => (c.column ? `${c.column} → ${c.castType}` : 'column + type'),
  derive: (c) => (c.target ? `${c.target} = ${c.expression ?? ''}` : 'target = expression'),
  redact: (c) => (c.column ? `${c.column}: ${c.action}` : 'column + action'),
  join: (c) => (c.joinResource ? `+ ${c.joinResource}` : 'second source'),
  aggregate: (c) =>
    c.aggFn
      ? `${c.aggFn}(${c.aggColumn ?? '*'}) by ${(c.groupBy ?? []).join(',')}`
      : 'group + measure',
  limit: (c) => (c.limit ? `${c.limit} rows` : 'row cap'),
};

// One-line summary of a node's config for the card.
function nodeSummary(n: EtlNode): string {
  return NODE_SUMMARY_BY_KIND[n.kind]?.(n.config) ?? '';
}

type EtlNodeData = {
  label: string;
  kind: string;
  summary: string;
  color: string;
  selected: boolean;
  incomplete: boolean;
};

function DagNode({ data }: NodeProps) {
  const d = data as unknown as EtlNodeData;
  return (
    <div
      className="w-[190px] rounded-lg border bg-white px-3 py-2 shadow-sm dark:bg-neutral-900"
      style={{
        borderColor: d.selected ? d.color : '#e5e7eb',
        borderLeft: `4px solid ${d.color}`,
        boxShadow: d.selected ? `0 0 0 2px ${d.color}` : undefined,
      }}
    >
      {d.kind !== 'source' ? (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: d.color, width: 9, height: 9 }}
        />
      ) : null}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] font-medium uppercase tracking-wide" style={{ color: d.color }}>
          {d.kind}
        </span>
        {d.incomplete ? <Warning className="size-3 text-amber-500" /> : <span className="w-3" />}
      </div>
      <p
        className="mt-1 truncate font-mono text-[11px] font-medium text-foreground"
        title={d.label}
      >
        {d.label}
      </p>
      <p className="truncate text-[10px] text-muted-foreground" title={d.summary}>
        {d.summary}
      </p>
      {d.kind !== 'destination' ? (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: d.color, width: 9, height: 9 }}
        />
      ) : null}
    </div>
  );
}

const NODE_TYPES = { dag: DagNode };

export function EtlBuilder({
  jobId,
  jobName,
  initialDag,
  connectors,
  initialRuns,
}: Readonly<{
  jobId: string;
  jobName: string;
  initialDag: EtlDagSpec;
  connectors: { id: string; name: string; type: string }[];
  initialRuns: EtlRunView[];
}>) {
  const [spec, setSpec] = useState<EtlDagSpec>(initialDag);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false);

  const validation = useMemo(() => validateDagSpec(spec), [spec]);
  const selected = spec.nodes.find((n) => n.id === selectedId) ?? null;

  const edit = useCallback((fn: (s: EtlDagSpec) => EtlDagSpec) => {
    setSpec((s) => fn(s));
    setDirty(true);
  }, []);

  // Derive the React-Flow graph.
  const { rfNodes, rfEdges } = useMemo(() => {
    const nodes: Node[] = spec.nodes.map((n, i) => {
      const incomplete = validation.errors.some(
        (e) => e.includes(n.label ?? n.id) || e.includes(n.kind),
      );
      return {
        id: n.id,
        type: 'dag',
        position: n.position ?? { x: 80 + i * 220, y: 120 },
        data: {
          label: n.label ?? n.kind,
          kind: n.kind,
          summary: nodeSummary(n),
          color: nodeColor(n.kind),
          selected: n.id === selectedId,
          incomplete,
        },
        draggable: true,
      };
    });
    const edges: Edge[] = spec.edges.map((e) => ({
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      animated: true,
      deletable: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#059669' },
      style: { stroke: '#059669', strokeWidth: 2 },
    }));
    return { rfNodes: nodes, rfEdges: edges };
  }, [spec, selectedId, validation]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Persist position changes (incl. interim drag frames, so dragging renders smoothly) back into
    // the spec — the spec stays the single source of truth. Selection/dimension changes are UI-only.
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        const nc = c;
        setSpec((s) => moveNode(s, nc.id, nc.position!));
      }
    }
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      edit((s) => connectNodes(s, c.source!, c.target!));
    },
    [edit],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      edit((s) => deleted.reduce((acc, e) => disconnectNodes(acc, e.source, e.target), s));
    },
    [edit],
  );

  const addTransform = useCallback((kind: EtlTransformKind) => {
    setSpec((s) => {
      const pos = { x: 120 + s.nodes.length * 60, y: 260 };
      const { spec: next, id } = addNode(s, kind, pos);
      setSelectedId(id);
      return next;
    });
    setDirty(true);
  }, []);

  async function save(): Promise<boolean> {
    const v = validateDagSpec(spec);
    if (!v.ok) {
      toast.error(v.errors[0]);
      return false;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/etl/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: jobName, dag: spec }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        toast.error(b.error ?? 'Could not save the job.');
        return false;
      }
      setDirty(false);
      toast.success('Saved.');
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    // Persist any unsaved edits first so the run uses the current DAG.
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setRunning(true);
    try {
      const res = await fetch(`/api/v1/admin/etl/jobs/${jobId}/run`, { method: 'POST' });
      const run = (await res.json().catch(() => null)) as EtlRunView | { error?: string } | null;
      if (!res.ok) {
        const msg =
          (run && 'message' in run && run.message) ||
          (run && 'error' in run && run.error) ||
          'Run failed.';
        toast.error(String(msg));
      } else if (run && 'status' in run) {
        if (run.status === 'failed') toast.error(run.message ?? 'Run failed.');
        else toast.success(run.message ?? `Run ${run.status}.`);
      }
      // The run-history component polls the runs endpoint; nudge it by reloading its data.
      window.dispatchEvent(new CustomEvent('etl-run-refresh'));
    } finally {
      setRunning(false);
    }
  }

  // Save-button label: mid-save, unsaved changes to save, or already saved.
  let saveLabel: string;
  if (saving) saveLabel = 'Saving…';
  else if (dirty) saveLabel = 'Save';
  else saveLabel = 'Saved';

  return (
    <div className="w-full space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TriggerControls
            spec={spec}
            onChange={(t, cron) => edit((s) => setTrigger(s, t, cron))}
          />
        </div>
        <div className="flex items-center gap-2">
          {!validation.ok ? (
            <Badge className="bg-amber-500/10 text-amber-600">
              {validation.errors.length} issue{validation.errors.length === 1 ? '' : 's'}
            </Badge>
          ) : (
            <Badge className="bg-primary/10 text-primary">Valid</Badge>
          )}
          <Button variant="outline" size="sm" onClick={save} disabled={saving}>
            <FloppyDisk className="mr-1 size-4" />
            {saveLabel}
          </Button>
          <Button size="sm" onClick={runNow} disabled={running || !validation.ok}>
            <Play className="mr-1 size-4" />
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>
      </div>

      {/* Palette */}
      <div className="flex flex-wrap gap-1.5">
        <span className="mr-1 self-center text-[10px] uppercase tracking-wide text-muted-foreground/60">
          Add transform
        </span>
        {TRANSFORMS.map((t) => (
          <button
            key={t.kind}
            type="button"
            title={t.hint}
            onClick={() => addTransform(t.kind)}
            className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="size-3" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Canvas + config panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[460px] rounded-lg border bg-muted/20">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <div className="rounded-lg border p-3">
          {selected ? (
            <NodeConfigPanel
              node={selected}
              connectors={connectors}
              onLabel={(label) => edit((s) => relabelNode(s, selected.id, label))}
              onConfig={(patch) => edit((s) => updateNodeConfig(s, selected.id, patch))}
              onRemove={
                selected.kind === 'source' || selected.kind === 'destination'
                  ? undefined
                  : () => {
                      edit((s) => removeNode(s, selected.id));
                      setSelectedId(null);
                    }
              }
            />
          ) : (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Select a node to configure it.</p>
              <p>
                Drag from a node&apos;s right edge to its target&apos;s left edge to connect steps.
                The source (left) reads your data; the destination (right) lands it in the
                warehouse.
              </p>
              {!validation.ok ? (
                <ul className="mt-2 space-y-1 text-amber-600">
                  {validation.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Run history + logs */}
      <EtlRunHistory jobId={jobId} initialRuns={initialRuns} />
    </div>
  );
}

// ── the trigger (manual / schedule) control ─────────────────────────────────────
function TriggerControls({
  spec,
  onChange,
}: Readonly<{
  spec: EtlDagSpec;
  onChange: (trigger: EtlDagSpec['trigger'], cron?: string) => void;
}>) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <select
        className={`${SELECT_CLASS} w-32`}
        value={spec.trigger}
        onChange={(e) => onChange(e.target.value as EtlDagSpec['trigger'], spec.cron)}
      >
        <option value="manual">Manual</option>
        <option value="schedule">Scheduled</option>
      </select>
      {spec.trigger === 'schedule' ? (
        <Input
          className="h-9 w-40 font-mono"
          placeholder="0 2 * * *"
          value={spec.cron ?? ''}
          onChange={(e) => onChange('schedule', e.target.value)}
        />
      ) : null}
    </div>
  );
}

// ── per-node-kind config form ────────────────────────────────────────────────
function NodeConfigPanel({
  node,
  connectors,
  onLabel,
  onConfig,
  onRemove,
}: Readonly<{
  node: EtlNode;
  connectors: { id: string; name: string; type: string }[];
  onLabel: (label: string) => void;
  onConfig: (patch: Partial<EtlNodeConfig>) => void;
  onRemove?: () => void;
}>) {
  const c = node.config;
  const cols = (v: string): string[] =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
          {node.kind}
        </span>
        {onRemove ? (
          <button type="button" onClick={onRemove} className="text-destructive hover:underline">
            <Trash className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div>
        <Label className="text-xs">Label</Label>
        <Input
          className="mt-1 h-8"
          value={node.label ?? ''}
          onChange={(e) => onLabel(e.target.value)}
        />
      </div>

      {node.kind === 'source' ? (
        <>
          <Field label="Source connector">
            <select
              className={SELECT_CLASS}
              value={c.connectorId ?? ''}
              onChange={(e) => onConfig({ connectorId: e.target.value })}
            >
              <option value="">Choose a connector…</option>
              {connectors.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.type})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Table / resource">
            <Input
              className="h-8"
              value={c.resource ?? ''}
              onChange={(e) => onConfig({ resource: e.target.value })}
              placeholder="customers"
            />
          </Field>
        </>
      ) : null}

      {node.kind === 'destination' ? (
        <>
          <Field label="Warehouse database">
            <Input
              className="h-8"
              value={c.database ?? ''}
              onChange={(e) => onConfig({ database: e.target.value })}
              placeholder="analytics"
            />
          </Field>
          <Field label="Warehouse table">
            <Input
              className="h-8"
              value={c.table ?? ''}
              onChange={(e) => onConfig({ table: e.target.value })}
              placeholder="customers_clean"
            />
          </Field>
        </>
      ) : null}

      {node.kind === 'filter' ? (
        <>
          <Field label="Column">
            <Input
              className="h-8"
              value={c.column ?? ''}
              onChange={(e) => onConfig({ column: e.target.value })}
            />
          </Field>
          <Field label="Operator">
            <select
              className={SELECT_CLASS}
              value={c.op ?? 'eq'}
              onChange={(e) => onConfig({ op: e.target.value as FilterOp })}
            >
              {(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'] as FilterOp[]).map(
                (o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Value">
            <Input
              className="h-8"
              value={c.value ?? ''}
              onChange={(e) => onConfig({ value: e.target.value })}
            />
          </Field>
        </>
      ) : null}

      {node.kind === 'select' || node.kind === 'dedupe' ? (
        <Field label="Columns (comma-separated)">
          <Input
            className="h-8"
            value={(c.columns ?? []).join(', ')}
            onChange={(e) => onConfig({ columns: cols(e.target.value) })}
          />
        </Field>
      ) : null}

      {node.kind === 'rename' ? (
        <>
          <Field label="From column">
            <Input
              className="h-8"
              value={c.from ?? ''}
              onChange={(e) => onConfig({ from: e.target.value })}
            />
          </Field>
          <Field label="To column">
            <Input
              className="h-8"
              value={c.to ?? ''}
              onChange={(e) => onConfig({ to: e.target.value })}
            />
          </Field>
        </>
      ) : null}

      {node.kind === 'cast' ? (
        <>
          <Field label="Column">
            <Input
              className="h-8"
              value={c.column ?? ''}
              onChange={(e) => onConfig({ column: e.target.value })}
            />
          </Field>
          <Field label="Type">
            <select
              className={SELECT_CLASS}
              value={c.castType ?? 'string'}
              onChange={(e) => onConfig({ castType: e.target.value as CastType })}
            >
              {(['string', 'int', 'float', 'bool', 'date'] as CastType[]).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}

      {node.kind === 'derive' ? (
        <>
          <Field label="New column">
            <Input
              className="h-8"
              value={c.target ?? ''}
              onChange={(e) => onConfig({ target: e.target.value })}
              placeholder="gst_amount"
            />
          </Field>
          <Field label="Expression">
            <Input
              className="h-8 font-mono"
              value={c.expression ?? ''}
              onChange={(e) => onConfig({ expression: e.target.value })}
              placeholder="amount * 0.18"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Arithmetic + comparisons only (e.g. amount * 1.18). Code is rejected.
            </p>
          </Field>
        </>
      ) : null}

      {node.kind === 'redact' ? (
        <>
          <Field label="Column">
            <Input
              className="h-8"
              value={c.column ?? ''}
              onChange={(e) => onConfig({ column: e.target.value })}
              placeholder="pan"
            />
          </Field>
          <Field label="Action">
            <select
              className={SELECT_CLASS}
              value={c.action ?? 'mask'}
              onChange={(e) => onConfig({ action: e.target.value as RedactionAction })}
            >
              {REDACT_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}

      {node.kind === 'join' ? (
        <>
          <Field label="Second source connector">
            <select
              className={SELECT_CLASS}
              value={c.joinConnectorId ?? ''}
              onChange={(e) => onConfig({ joinConnectorId: e.target.value })}
            >
              <option value="">Choose…</option>
              {connectors.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.type})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Second resource">
            <Input
              className="h-8"
              value={c.joinResource ?? ''}
              onChange={(e) => onConfig({ joinResource: e.target.value })}
            />
          </Field>
          <Field label="Left key">
            <Input
              className="h-8"
              value={c.leftKey ?? ''}
              onChange={(e) => onConfig({ leftKey: e.target.value })}
            />
          </Field>
          <Field label="Right key">
            <Input
              className="h-8"
              value={c.rightKey ?? ''}
              onChange={(e) => onConfig({ rightKey: e.target.value })}
            />
          </Field>
        </>
      ) : null}

      {node.kind === 'aggregate' ? (
        <>
          <Field label="Group by (comma-separated)">
            <Input
              className="h-8"
              value={(c.groupBy ?? []).join(', ')}
              onChange={(e) => onConfig({ groupBy: cols(e.target.value) })}
            />
          </Field>
          <Field label="Function">
            <select
              className={SELECT_CLASS}
              value={c.aggFn ?? 'count'}
              onChange={(e) => onConfig({ aggFn: e.target.value as AggFn })}
            >
              {(['count', 'sum', 'avg', 'min', 'max'] as AggFn[]).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          {c.aggFn && c.aggFn !== 'count' ? (
            <Field label="Measure column">
              <Input
                className="h-8"
                value={c.aggColumn ?? ''}
                onChange={(e) => onConfig({ aggColumn: e.target.value })}
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {node.kind === 'limit' ? (
        <Field label="Max rows">
          <Input
            className="h-8"
            type="number"
            value={c.limit ?? ''}
            onChange={(e) => onConfig({ limit: Number(e.target.value) })}
          />
        </Field>
      ) : null}
    </div>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
