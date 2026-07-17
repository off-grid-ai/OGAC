'use client';

import { Play } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface RunStep {
  kind: string;
  label: string;
  detail: string;
}
interface Check {
  name: string;
  verdict: string;
}
interface Run {
  id: string;
  status: string;
  answer: string;
  steps: RunStep[];
  checks: Check[];
  citations: { ref: string; title: string }[];
  provenance: { algorithm: string } | null;
}

const VERDICT_COLOR: Record<string, string> = {
  pass: 'bg-primary/10 text-primary',
  ok: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  fail: 'bg-destructive/10 text-destructive',
};

// The recorded trace of a run — proof the governed pipeline fired end-to-end.
function RunTrace({ run }: Readonly<{ run: Run }>) {
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</span>
        <Badge
          variant="secondary"
          className={VERDICT_COLOR[run.status === 'done' ? 'ok' : run.status] ?? ''}
        >
          {run.status}
        </Badge>
        {run.provenance ? (
          <Badge variant="outline">signed · {run.provenance.algorithm}</Badge>
        ) : null}
      </div>

      <div className="rounded-md bg-muted/50 p-3 text-sm text-foreground">
        {run.answer || '— (no answer; the gateway may be offline)'}
      </div>

      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Pipeline steps
        </span>
        <div className="space-y-1">
          {run.steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <Badge variant="outline" className="shrink-0">
                {s.kind}
              </Badge>
              <span className="text-muted-foreground">
                {s.label} — {s.detail}
              </span>
            </div>
          ))}
        </div>
      </div>

      {run.checks.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Checks</span>
          {run.checks.map((c, i) => (
            <Badge key={i} variant="secondary" className={VERDICT_COLOR[c.verdict] ?? ''}>
              {c.name}:{c.verdict}
            </Badge>
          ))}
        </div>
      ) : null}

      {run.citations.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Cited</span>
          {run.citations.map((c) => (
            <Badge key={c.ref} variant="outline">
              {c.title}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Run an agent through the full governed pipeline and show the trace — proof that policy,
// guardrails, retrieval/routing, grounding and provenance all fired in-path. Runtime agents are
// runnable here. Authored-agent editing/deletion belongs to the owning AppSpec
// lifecycle, so this component intentionally exposes no second set of mutation controls.
export function AgentCardActions({ agentId }: Readonly<{ agentId: string }>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);

  async function execute() {
    if (!query.trim()) return;
    setBusy(true);
    setRun(null);
    try {
      const res = await fetch('/api/v1/admin/agents/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, query }),
      });
      if (!res.ok) throw new Error('failed');
      setRun((await res.json()) as Run);
    } catch {
      toast.error('Run failed — is the console reachable?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Play className="size-3.5" />
            Run
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run through the governed pipeline</DialogTitle>
            <DialogDescription>
              policy → guardrails → retrieve/route → answer → ground → guardrails → sign. Every step
              is recorded below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask this agent something…"
            />
            <Button onClick={execute} disabled={busy || !query.trim()} className="w-full">
              {busy ? 'Running…' : 'Run'}
            </Button>

            {run ? <RunTrace run={run} /> : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
