'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type EgressStrictness = 'mask' | 'block';

export interface EgressDecision {
  ts: string;
  actor: string;
  resource: string;
  model: string | null;
  outcome: string;
}

export interface CloudEgressPanelProps {
  enabled: boolean;
  strictness: EgressStrictness;
  updatedBy: string;
  updatedAt: string;
  engine: { name: string; configured: boolean; reachable: boolean };
  decisions: EgressDecision[];
}

const OUTCOME_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  redacted: 'secondary',
  blocked: 'destructive',
  ok: 'default',
};

// Cloud egress protection — the operator control surface for the MANDATORY egress-DLP leash. Toggle
// protection on/off, choose how detected PII is handled (mask vs block), see the guardrail engine's
// honest reachability, and review the most recent egress decisions. URL/route-driven: every mutation
// PATCHes /api/v1/admin/governance/egress then refreshes the server component (single source of truth).
export function CloudEgressPanel({
  enabled,
  strictness,
  updatedBy,
  updatedAt,
  engine,
  decisions,
}: Readonly<CloudEgressPanelProps>) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const save = async (patch: { enabled?: boolean; strictness?: EgressStrictness }) => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/governance/egress', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `request failed (${res.status})`);
      }
      toast.success('Cloud egress protection updated');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update policy');
    } finally {
      setSaving(false);
    }
  };

  const engineReady = engine.configured && engine.reachable;

  return (
    <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Control column */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-sm">
            Cloud egress protection
            <Badge variant={enabled ? 'default' : 'destructive'}>{enabled ? 'ON' : 'OFF'}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm">
          <p className="max-w-2xl text-xs text-muted-foreground">
            When a request routes to an outside (cloud / frontier) model, sensitive data — names,
            PAN, Aadhaar, card numbers, emails, secrets — is stripped before it leaves your network.
            On-prem requests never leave the box and are never touched. If the detector cannot screen
            a request, the cloud call is refused rather than sent unprotected.
          </p>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="font-medium">Protect data on cloud routes</p>
              <p className="text-xs text-muted-foreground">
                Default ON. Turning this off lets requests leave to cloud providers unmasked.
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={saving}
              onCheckedChange={(v) => void save({ enabled: v })}
              aria-label="Toggle cloud egress protection"
            />
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="font-medium">When sensitive data is detected on a cloud route</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant={strictness === 'mask' ? 'default' : 'outline'}
                size="sm"
                disabled={saving || !enabled}
                onClick={() => void save({ strictness: 'mask' })}
              >
                Mask & send
              </Button>
              <Button
                variant={strictness === 'block' ? 'default' : 'outline'}
                size="sm"
                disabled={saving || !enabled}
                onClick={() => void save({ strictness: 'block' })}
              >
                Block the call
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {strictness === 'block'
                ? 'Block: any request containing sensitive data is refused — nothing leaves, even masked.'
                : 'Mask & send: sensitive spans are replaced with placeholders, then the sanitized request is sent.'}
            </p>
          </div>

          {updatedBy ? (
            <p className="text-xs text-muted-foreground">
              Last changed by {updatedBy}
              {updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Using the secure default (ON · mask).</p>
          )}
        </CardContent>
      </Card>

      {/* Engine status column (deploy-owned — honest read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            Detector engine
            <Badge variant={engineReady ? 'default' : 'destructive'}>
              {engineReady ? 'ready' : engine.configured ? 'unreachable' : 'not configured'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            Engine: <span className="font-mono text-foreground">{engine.name}</span>
          </p>
          <p>
            The detector is managed at deploy time (fleet configuration). Protection fails closed: if
            it is <span className="text-foreground">not ready</span>, cloud calls are blocked until it
            is reachable again.
          </p>
          {!engineReady ? (
            <p className="text-destructive">
              Cloud routes are currently blocked — no data can leave until the detector is reachable.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Recent decisions — full width */}
      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Recent egress decisions</CardTitle>
          <Badge variant="secondary">{decisions.length}</Badge>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cloud egress decisions recorded yet. Masked, blocked, and unprotected cloud sends
              appear here once they happen.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisions.map((d, i) => (
                    <TableRow key={`${d.ts}-${i}`}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {d.ts ? new Date(d.ts).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{d.actor}</TableCell>
                      <TableCell className="font-mono text-xs">{d.resource}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {d.model ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={OUTCOME_VARIANT[d.outcome] ?? 'outline'}>{d.outcome}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
