'use client';

import { TreeStructure } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Decision {
  action: string;
  effective: string;
  model: string | null;
  fallback: string | null;
  matched: string | null;
  reason: string;
}

const ACTION_STYLE: Record<string, string> = {
  local: 'bg-primary/10 text-primary',
  cloud: 'bg-blue-500/10 text-blue-600',
  block: 'bg-destructive/10 text-destructive',
};

// Test routing as `attribute=value` pairs (e.g. "data_class=pii task=chat").
export function RoutingTester() {
  const [input, setInput] = useState('data_class=pii');
  const [result, setResult] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    const attributes: Record<string, string> = {};
    for (const pair of input.trim().split(/\s+/)) {
      const [k, v] = pair.split('=');
      if (k && v) attributes[k] = v;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/routing/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attributes }),
      });
      if (!res.ok) throw new Error('failed');
      setResult((await res.json()) as Decision);
    } catch {
      toast.error('Evaluate failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={input}
          placeholder="data_class=pii task=chat"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
        />
        <Button onClick={run} disabled={busy} className="shrink-0">
          <TreeStructure className="size-4" />
          {busy ? 'Evaluating…' : 'Evaluate'}
        </Button>
      </div>
      {result ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
          <Badge variant="secondary" className={ACTION_STYLE[result.effective]}>
            {result.effective}
          </Badge>
          {result.model ? <Badge variant="outline">{result.model}</Badge> : null}
          {result.fallback ? (
            <span className="text-xs text-muted-foreground">fallback: {result.fallback}</span>
          ) : null}
          <span className="text-xs text-muted-foreground">· {result.reason}</span>
        </div>
      ) : null}
    </div>
  );
}
