'use client';

import { TestTube } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Decision {
  allow: boolean;
  reason: string;
  engine: string;
}

// Interactive ABAC tester (POST /admin/abac/evaluate) — preview an access decision against the
// live policy before relying on it. Attributes are entered as key=value lines.
export function AbacTester() {
  const [role, setRole] = useState('operator');
  const [resource, setResource] = useState('agent:sop-synth');
  const [attrs, setAttrs] = useState('region=in\ndata_class=pii');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);

  function parseAttrs(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of attrs.split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k.trim() && rest.length) out[k.trim()] = rest.join('=').trim();
    }
    return out;
  }

  async function evaluate() {
    setBusy(true);
    setDecision(null);
    try {
      const res = await fetch('/api/v1/admin/abac/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, resource, attributes: parseAttrs() }),
      });
      if (!res.ok) throw new Error('failed');
      setDecision((await res.json()) as Decision);
    } catch {
      toast.error('Evaluation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="abac-role">Role</Label>
          <Input id="abac-role" value={role} onChange={(e) => setRole(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="abac-resource">Resource</Label>
          <Input
            id="abac-resource"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="abac-attrs">Attributes (key=value per line)</Label>
        <Textarea
          id="abac-attrs"
          rows={2}
          value={attrs}
          onChange={(e) => setAttrs(e.target.value)}
        />
      </div>
      <Button size="sm" onClick={evaluate} disabled={busy} className="w-full sm:w-auto">
        <TestTube className="size-4" />
        {busy ? 'Evaluating…' : 'Evaluate decision'}
      </Button>

      {decision ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <Badge
            variant="secondary"
            className={
              decision.allow ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
            }
          >
            {decision.allow ? 'allow' : 'deny'}
          </Badge>
          <span className="text-muted-foreground">{decision.reason}</span>
          <Badge variant="outline" className="ml-auto">
            {decision.engine}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
