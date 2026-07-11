'use client';

import {
  Background,
  Controls,
  type Connection,
  type Edge,
  type EdgeChange,
  Handle,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowSquareOut,
  ArrowsOutCardinal,
  FloppyDisk,
  Play,
  Plus,
  Sparkle,
  Warning,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AppStepEditor, type StepEditorHandlers } from '@/components/build/AppStepEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { BindingNames } from '@/lib/app-builder';
import {
  addEdge,
  addStep,
  addStepNoRechain,
  moveStep,
  rebindAgent,
  rebindDomain,
  relabelStep,
  removeEdge,
  removeStep,
  removeStepAndEdges,
  setAgentPrompt,
  setOutputSink,
  toggleGrounding,
} from '@/lib/app-builder';
import {
  type AppSpec,
  type AppStepKind,
  type OutputStep,
  validateAppSpec,
} from '@/lib/app-model';
import type { StepResult } from '@/lib/app-run';
import {
  KIND_LABEL,
  emptySpec,
  graphSummary,
  specToGraph,
  stepById,
} from '@/lib/canvas-graph';

// ─── StudioCanvas (Builder Epic Phase 3B) — the WORKING visual editor of an AppSpec ──────────────
//
// This is the visual half of the dual-mode builder (screen 1, §7 of the plan). It is NO LONGER
// decorative: every node the operator sees IS an `AppStep`, every edge IS an `AppEdge`, and every
// structural/binding edit goes through the SAME pure reducers in `app-builder.ts` that the text
// builder (3A `AppBuilder.tsx`) uses. So canvas-mode and text-mode are two views of ONE AppSpec —
// they can never drift.
//
// FLOW:
//   • Seed — describe a process → POST /api/v1/admin/apps/compile → an AppSpec skeleton renders as a
//     node graph. OR start from a blank single-agent app ("Start blank") and add steps visually.
//   • Edit — click a node → the SAME AppStepEditor the text builder uses opens in the side panel; all
//     its controls call app-builder reducers on the spec. Add a step from the palette; reorder/remove
//     from the node card. The graph re-derives from the spec via canvas-graph.specToGraph.
//   • Save — POST /api/v1/admin/apps (the 3A CRUD route) → the spec is persisted + re-validated
//     server-side by validateAppSpec. Publish flips a slug via PATCH { publish:true }.
//   • Run — POST /api/v1/admin/apps/[id]/run → the Phase 2A multi-step executor (runApp) actually
//     walks the graph, each step governed. We render the per-step trace it returns. (We do NOT import
//     worker files — the inline run route owns that.)
//
// SOLID: this component holds the AppSpec in state and is a thin caller. Graph geometry + the spec↔RF
// mapping are pure in `canvas-graph.ts`; edit rules are pure in `app-builder.ts`; validity is
// `validateAppSpec`. Nothing here re-implements a rule.

// ─── The custom React-Flow node — renders an AppStep as a labeled, colored card ──────────────────
type StepNodeData = ReturnType<typeof specToGraph>['nodes'][number]['data'] & { selected?: boolean };

function StepNode({ data }: NodeProps) {
  const d = data as unknown as StepNodeData;
  return (
    <div
      className="w-[188px] rounded-lg border bg-white px-3 py-2 shadow-sm dark:bg-neutral-900"
      style={{
        borderColor: d.selected ? d.color : '#e5e7eb',
        borderLeft: `4px solid ${d.color}`,
        boxShadow: d.selected ? `0 0 0 2px ${d.color}` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: d.color, width: 9, height: 9 }}
      />
      <div className="flex items-center justify-between gap-1">
        <span
          className="flex size-4 items-center justify-center rounded-full text-[9px] font-semibold text-white"
          style={{ background: d.color }}
        >
          {d.index}
        </span>
        <span className="text-[9px] font-medium uppercase tracking-wide" style={{ color: d.color }}>
          {KIND_LABEL[d.kind]}
        </span>
        {d.incomplete ? <Warning className="size-3 text-amber-500" /> : <span className="w-3" />}
      </div>
      <p className="mt-1 truncate font-mono text-[11px] font-medium text-foreground" title={d.label}>
        {d.label}
      </p>
      <p className="truncate text-[10px] text-muted-foreground" title={d.binding}>
        {d.binding}
      </p>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: d.color, width: 9, height: 9 }}
      />
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

const STEP_KINDS: { kind: AppStepKind; label: string }[] = [
  { kind: 'connector-query', label: 'Read data' },
  { kind: 'agent', label: 'Agent' },
  { kind: 'guardrail', label: 'Guardrail' },
  { kind: 'human', label: 'Human review' },
  { kind: 'output', label: 'Output' },
];

const EXAMPLES = [
  'Reimbursement approval — read the invoice, check the employee\'s quota, decide if they\'re eligible, then have a manager approve or reject.',
  'Read the customer\'s recent tickets, classify the issue and urgency, draft a reply grounded in our policies, then email it.',
  'Answer employee questions about our HR policies and always cite the policy document you used.',
];

export function StudioCanvas({
  domains = [],
  agents = [],
  initialSpec,
  onSpecChange,
}: {
  domains?: { id: string; label: string }[];
  agents?: { id: string; name: string }[];
  /** CONTROLLED MODE (Builder Epic #115): when the parent (AppBuilder) owns the spec and only wants
   *  the canvas as an editing VIEW, it passes the current spec here + a change callback below. In
   *  that mode the canvas seeds from this spec and mirrors every edit up, so guided + visual edit ONE
   *  AppSpec. The canvas's own describe/save/publish/run chrome is hidden (the parent owns it). */
  initialSpec?: AppSpec | null;
  onSpecChange?: (spec: AppSpec) => void;
}) {
  const controlled = onSpecChange !== undefined;
  // The AppSpec is the single source of truth. In controlled mode we seed from initialSpec.
  const [spec, setSpec] = useState<AppSpec | null>(initialSpec ?? null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  // ── Canvas VIEW state (not part of the AppSpec — there is no position column on the apps table).
  //    `positions` are the operator's manual node placements, keyed by step id; they persist for the
  //    editing session and override the derived vertical-column layout. `editTopology` flips the
  //    canvas from read-only (linear preview) to a full editor: draggable nodes + drawable/deletable
  //    edges. Edges themselves ARE persisted (spec.edges → the DB), so a branching topology survives a
  //    reload; only the manual x/y placement is session-local. ──
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [editTopology, setEditTopology] = useState(false);

  const [description, setDescription] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [saving, setSaving] = useState(false);

  // Persisted-app state (set after a save; enables Run + Publish).
  const [savedId, setSavedId] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  // Run state.
  const [running, setRunning] = useState(false);
  const [runInput, setRunInput] = useState('');
  const [runSteps, setRunSteps] = useState<StepResult[]>([]);
  const [runOutcome, setRunOutcome] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);

  const names: BindingNames = useMemo(() => ({ domains, agents }), [domains, agents]);
  const validation = useMemo(() => (spec ? validateAppSpec(spec) : null), [spec]);
  const summary = useMemo(() => (spec ? graphSummary(spec) : null), [spec]);

  // Derive the React-Flow graph from the spec. Mark the selected node so the card highlights.
  const { nodes, edges } = useMemo(() => {
    if (!spec) return { nodes: [] as Node[], edges: [] as Edge[] };
    const g = specToGraph(spec, names);
    const rfNodes: Node[] = g.nodes.map((n) => ({
      id: n.id,
      type: 'step',
      // A manual placement (from a drag) overrides the derived vertical-column layout.
      position: positions[n.id] ?? n.position,
      data: { ...n.data, selected: n.id === selectedStepId },
      // Draggable only in edit mode — read-only mode keeps the tidy linear preview stable.
      draggable: editTopology,
    }));
    const rfEdges: Edge[] = g.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: true,
      // In edit mode edges are deletable (select + Backspace / the delete affordance).
      deletable: editTopology,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#059669' },
      style: { stroke: '#059669', strokeWidth: 2 },
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [spec, names, selectedStepId, positions, editTopology]);

  // Keep the latest nodes in a ref so the drag handler (a stable callback) applies changes against
  // the current node set without stale closures.
  const nodesRef = useRef<Node[]>(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // A structural/binding edit invalidates the persisted-run affordances (the saved copy is stale).
  const markDirty = useCallback(() => {
    setSavedId(null);
    setPublishedUrl(null);
    setRunSteps([]);
    setRunOutcome(null);
    setRunStatus(null);
  }, []);

  const edit = useCallback(
    (fn: (s: AppSpec) => AppSpec) => {
      setSpec((s) => (s ? fn(s) : s));
      markDirty();
    },
    [markDirty],
  );

  // ── React-Flow topology handlers — the visual editor's write path. Each drives a PURE reducer
  //    (app-builder addEdge/removeEdge) so the AppSpec stays the single source of truth and cycles are
  //    refused at the reducer, never drawn. A rejected connect returns the SAME spec (identity) → we
  //    toast why. Positions are tracked separately (view-only). ──

  // Draw an edge: React-Flow gives us {source,target}; addEdge validates (real steps, no dup, no
  // self-loop, no cycle) and no-ops on rejection.
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      setSpec((s) => {
        if (!s) return s;
        const next = addEdge(s, c.source!, c.target!);
        if (next === s) {
          // Rejected — the only interesting reason to surface is a cycle (dup/self are silent no-ops).
          if (c.source !== c.target && !s.edges.some((e) => e.from === c.source && e.to === c.target)) {
            toast.error('That connection would create a loop — steps must flow forward.');
          }
          return s;
        }
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  // Edge changes: React-Flow emits a 'remove' change when the operator deletes a selected edge. We
  // translate each removal to removeEdge on the spec (by parsing the edge id back to from/to — the id
  // is `e_<from>__<to>_<i>`, but we already carry source/target on the RF edge, so map by id).
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((ch): ch is EdgeChange & { id: string } => ch.type === 'remove');
      if (removed.length === 0) return;
      setSpec((s) => {
        if (!s) return s;
        let next = s;
        for (const ch of removed) {
          const rfEdge = edges.find((e) => e.id === ch.id);
          if (rfEdge) next = removeEdge(next, rfEdge.source, rfEdge.target);
        }
        return next;
      });
      markDirty();
    },
    [edges, markDirty],
  );

  // Node drags: track the manual placement per step id (view-only — not persisted to the spec).
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // applyNodeChanges keeps RF's internal bookkeeping correct; we only harvest final positions.
    setPositions((prev) => {
      const applied = applyNodeChanges(changes, nodesRef.current);
      const next = { ...prev };
      for (const n of applied) next[n.id] = n.position;
      return next;
    });
  }, []);

  // ── Controlled mode: mirror every spec change up to the parent (AppBuilder). Guard against loops
  //    by only propagating when the spec object identity actually changed here. ──
  const lastSent = useRef<AppSpec | null>(initialSpec ?? null);
  useEffect(() => {
    if (!controlled || !onSpecChange || !spec) return;
    if (spec === lastSent.current) return;
    lastSent.current = spec;
    onSpecChange(spec);
  }, [controlled, onSpecChange, spec]);

  // If the parent seeds/replaces the spec (e.g. a fresh compile), adopt it — but ignore the
  // parent's echo of a spec we ourselves just emitted (identity match) so edits aren't clobbered.
  useEffect(() => {
    if (!controlled || initialSpec == null) return;
    if (initialSpec === lastSent.current) return;
    lastSent.current = initialSpec;
    setSpec(initialSpec);
    setSelectedStepId(initialSpec.steps[0]?.id ?? null);
  }, [controlled, initialSpec]);

  // ─── Seed: compile a description → AppSpec skeleton ──────────────────────────────────────────
  async function compile() {
    if (description.trim().length < 8 || compiling) return;
    setCompiling(true);
    try {
      const res = await fetch('/api/v1/admin/apps/compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error('Compile failed — the gateway may be offline.');
      const data = (await res.json()) as { spec: AppSpec; gaps: string[] };
      setSpec(data.spec);
      setGaps(data.gaps ?? []);
      setPositions({}); // fresh spec → derived layout
      setSelectedStepId(data.spec.steps[0]?.id ?? null);
      markDirty();
      toast.success('Carved a step graph — click a node to edit it, then Save.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Compile failed');
    } finally {
      setCompiling(false);
    }
  }

  function startBlank() {
    const s = emptySpec();
    setSpec(s);
    setGaps([]);
    setPositions({});
    setSelectedStepId(s.steps[0].id);
    markDirty();
  }

  function clear() {
    setSpec(null);
    setGaps([]);
    setPositions({});
    setSelectedStepId(null);
    setDescription('');
    markDirty();
  }

  // ─── Save: persist the spec via the 3A CRUD route (re-validated server-side) ─────────────────
  async function save(): Promise<string | null> {
    if (!spec) return null;
    const check = validateAppSpec(spec);
    if (!check.ok) {
      toast.error(check.errors[0] ?? 'Fix the flagged steps first');
      return null;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: spec.title,
          summary: spec.summary,
          visibility: spec.visibility,
          trigger: spec.trigger,
          inputForm: spec.inputForm,
          steps: spec.steps,
          edges: spec.edges,
        }),
      });
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
        throw new Error(body.errors?.[0] ?? 'The app spec did not validate');
      }
      if (!res.ok) throw new Error('Could not save the app');
      const app = (await res.json()) as { id: string };
      setSavedId(app.id);
      toast.success(`"${spec.title}" saved — you can run or publish it now.`);
      return app.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  }

  // ─── Publish: mint a shareable /app/<slug> ────────────────────────────────────────────────────
  async function publish() {
    const id = savedId ?? (await save());
    if (!id) return;
    try {
      const res = await fetch(`/api/v1/admin/apps/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publish: true }),
      });
      if (!res.ok) throw new Error('Publish failed');
      const app = (await res.json()) as { slug?: string };
      if (app.slug) {
        setPublishedUrl(`/app/${app.slug}`);
        toast.success('Published — shareable app URL is ready.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed');
    }
  }

  // ─── Run: save (if needed) then hit the inline executor route ────────────────────────────────
  async function run() {
    if (running) return;
    const id = savedId ?? (await save());
    if (!id) return;
    setRunning(true);
    setRunSteps([]);
    setRunOutcome(null);
    setRunStatus(null);
    try {
      const res = await fetch(`/api/v1/admin/apps/${id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: runInput.trim() ? { input: runInput.trim() } : {} }),
      });
      if (!res.ok) throw new Error('Run failed');
      const data = (await res.json()) as {
        status: string;
        steps: StepResult[];
        outcome: string;
      };
      setRunStatus(data.status);
      setRunSteps(data.steps ?? []);
      setRunOutcome(data.outcome ?? '');
      if (data.status === 'awaiting_human') {
        toast.info('Run paused at a human-review step — resume it from the Review screen.');
      } else if (data.status === 'error') {
        toast.error('A step failed — see the trace.');
      } else {
        toast.success('Run complete.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  // Per-step handlers — each wraps a PURE app-builder reducer (identical to AppBuilder 3A).
  function handlersFor(stepId: string): StepEditorHandlers {
    return {
      onRelabel: (label) => edit((s) => relabelStep(s, stepId, label)),
      onMoveUp: () => edit((s) => moveStep(s, stepId, -1)),
      onMoveDown: () => edit((s) => moveStep(s, stepId, 1)),
      onRemove: () => {
        // In edit-connections mode, delete the node + only its own edges (keep the branches);
        // otherwise the text-mode behaviour rechains the survivors into a linear flow.
        edit((s) => (editTopology ? removeStepAndEdges(s, stepId) : removeStep(s, stepId)));
        setPositions((p) => {
          const { [stepId]: _drop, ...rest } = p;
          return rest;
        });
        setSelectedStepId((cur) => (cur === stepId ? null : cur));
      },
      onRebindDomain: (d) => edit((s) => rebindDomain(s, stepId, d)),
      onRebindAgent: (a) => edit((s) => rebindAgent(s, stepId, a)),
      onSetPrompt: (p) => edit((s) => setAgentPrompt(s, stepId, p)),
      onToggleGrounding: (g) => edit((s) => toggleGrounding(s, stepId, g)),
      onSetSink: (sink: OutputStep['sink']) => edit((s) => setOutputSink(s, stepId, sink)),
    };
  }

  const selectedStep = spec && selectedStepId ? stepById(spec, selectedStepId) : undefined;
  const selectedIndex =
    spec && selectedStepId ? spec.steps.findIndex((s) => s.id === selectedStepId) : -1;

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[560px] gap-3">
      {/* ── Left: describe / seed / save-run.  In CONTROLLED mode the parent (AppBuilder) owns the
             describe/save/publish/run chrome, so we render only the graph summary + add-step palette. ── */}
      <div className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-3">
        {!spec && controlled ? (
          <p className="text-xs text-muted-foreground">
            Add a step from the palette once the app has been described.
          </p>
        ) : !spec ? (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">Describe the process</p>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what triggers it, what it reads/decides, and where the result goes…"
                className="min-h-[110px] resize-none font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void compile();
                }}
              />
              <Button
                onClick={compile}
                disabled={compiling || description.trim().length < 8}
                className="w-full gap-2"
              >
                <Sparkle className="size-4" />
                {compiling ? 'Carving steps…' : 'Build the graph'}
              </Button>
              <Button onClick={startBlank} variant="outline" className="w-full gap-2">
                <Plus className="size-4" />
                Start blank
              </Button>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Examples</p>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setDescription(ex)}
                  className="block w-full rounded-md border border-border p-2 text-left text-[11px] text-muted-foreground hover:border-primary/50 hover:bg-muted/30 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Graph summary */}
            <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
              <p className="truncate text-sm font-semibold text-foreground">{spec.title}</p>
              <p className="text-[10px] uppercase tracking-wide text-primary">
                {summary?.stepCount} steps · {summary?.edgeCount} edges
                {summary?.hasHuman ? ' · human review' : ''}
              </p>
              {validation && !validation.ok ? (
                <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                  <Warning className="size-3" /> {validation.errors[0]}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">Ready to save + run.</p>
              )}
            </div>

            {/* Add-step palette */}
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Add a step</p>
              <div className="flex flex-wrap gap-1.5">
                {STEP_KINDS.map((k) => (
                  <Button
                    key={k.kind}
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => {
                      let newId = '';
                      setSpec((s) => {
                        if (!s) return s;
                        // In edit-connections mode, add a DISCONNECTED node (preserve the branching
                        // topology the operator drew) — they then wire its edges. Otherwise keep the
                        // one-click linear behaviour (auto-appends to the chain).
                        if (editTopology) {
                          const r = addStepNoRechain(s, k.kind);
                          newId = r.id;
                          return r.spec;
                        }
                        const next = addStep(s, k.kind);
                        newId = next.steps[next.steps.length - 1].id;
                        return next;
                      });
                      markDirty();
                      if (newId) setSelectedStepId(newId);
                    }}
                  >
                    <Plus className="size-3" />
                    {k.label}
                  </Button>
                ))}
              </div>
            </div>

            {!controlled && gaps.length > 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2">
                <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  <Warning className="size-3" /> {gaps.length} thing{gaps.length === 1 ? '' : 's'} to
                  resolve
                </p>
                <ul className="mt-1 space-y-0.5 text-[10px] text-amber-800 dark:text-amber-300/90">
                  {gaps.map((g, i) => (
                    <li key={i}>• {g}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Run — hidden in controlled mode (the parent AppBuilder owns save/run/publish). */}
            {!controlled ? (
            <div className="space-y-1.5 border-t border-border pt-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Try it</p>
              <Textarea
                value={runInput}
                onChange={(e) => setRunInput(e.target.value)}
                placeholder="Sample input (optional)…"
                className="min-h-[54px] resize-none font-mono text-[11px]"
              />
              <div className="flex gap-1.5">
                <Button
                  onClick={run}
                  disabled={running || !validation?.ok}
                  size="sm"
                  className="flex-1 gap-1.5"
                >
                  <Play className="size-3.5" />
                  {running ? 'Running…' : 'Run'}
                </Button>
                <Button
                  onClick={() => void save()}
                  disabled={saving}
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                >
                  <FloppyDisk className="size-3.5" />
                  Save
                </Button>
              </div>
              <Button
                onClick={publish}
                disabled={saving}
                size="sm"
                variant="ghost"
                className="w-full gap-1.5"
              >
                <ArrowSquareOut className="size-3.5" /> Publish shareable app
              </Button>
              {publishedUrl ? (
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-all rounded border border-primary/40 bg-primary/5 p-1.5 font-mono text-[10px] text-primary underline"
                >
                  {publishedUrl}
                </a>
              ) : null}
            </div>
            ) : null}

            {/* Run trace */}
            {runSteps.length > 0 || runOutcome !== null ? (
              <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-2">
                <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Result
                  {runStatus ? (
                    <Badge
                      variant="secondary"
                      className={
                        runStatus === 'done'
                          ? 'bg-primary/10 text-primary'
                          : runStatus === 'awaiting_human'
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-destructive/10 text-destructive'
                      }
                    >
                      {runStatus}
                    </Badge>
                  ) : null}
                </p>
                {runOutcome ? (
                  <p className="whitespace-pre-wrap text-[11px] text-foreground">{runOutcome}</p>
                ) : null}
                <ol className="space-y-0.5 border-l border-border pl-2">
                  {runSteps.map((s, i) => (
                    <li key={i} className="text-[10px] text-muted-foreground">
                      <span
                        className={
                          s.status === 'error'
                            ? 'font-mono text-destructive'
                            : s.status === 'awaiting_human'
                              ? 'font-mono text-amber-600'
                              : 'font-mono text-foreground'
                        }
                      >
                        {s.kind}
                      </span>
                      {s.detail ? ` — ${s.detail}` : ''}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ── Center: the React-Flow graph ── */}
      <div className="relative flex-1 overflow-hidden rounded-xl border border-border bg-[#fafafa] dark:bg-neutral-950">
        {!spec ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Sparkle className="size-10 text-muted-foreground/30" />
            <p className="max-w-xs text-sm text-muted-foreground">
              Describe your process on the left, or start blank. Every node is a real step — click one
              to configure it, and Run to execute the whole governed graph.
            </p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.3}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={editTopology}
            nodesConnectable={editTopology}
            elementsSelectable
            onConnect={onConnect}
            onEdgesChange={editTopology ? onEdgesChange : undefined}
            onNodesChange={editTopology ? onNodesChange : undefined}
            onNodeClick={(_, n) => setSelectedStepId(n.id)}
            onPaneClick={() => setSelectedStepId(null)}
          >
            <Background gap={20} color="#e5e7eb" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {/* Edit-topology toggle — flips the canvas between the tidy linear preview and a full editor
            where the operator drags nodes and draws/deletes connections to BRANCH the flow. */}
        {spec ? (
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <button
              onClick={() => setEditTopology((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm ${
                editTopology
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background/90 text-muted-foreground hover:text-foreground'
              }`}
              title="Drag nodes, and drag between the dots to connect / re-wire steps"
            >
              <ArrowsOutCardinal className="size-3.5" />
              {editTopology ? 'Editing connections' : 'Edit connections'}
            </button>
            {editTopology ? (
              <span className="rounded-md border border-border bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
                Drag a dot to connect · select an arrow + Delete to remove
              </span>
            ) : null}
          </div>
        ) : null}
        {spec && !controlled ? (
          <button
            onClick={clear}
            className="absolute right-3 top-3 rounded-md border border-border bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
            title="Clear canvas"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* ── Right: the selected node's config (the SAME AppStepEditor the text builder uses) ── */}
      {spec && selectedStep && selectedIndex >= 0 ? (
        <div className="w-[320px] shrink-0 overflow-y-auto rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-foreground">Configure step</p>
            <button
              onClick={() => setSelectedStepId(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close config"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <AppStepEditor
            step={selectedStep}
            index={selectedIndex}
            total={spec.steps.length}
            names={names}
            handlers={handlersFor(selectedStep.id)}
          />
        </div>
      ) : null}
    </div>
  );
}
