'use client';

import { PlugsConnected, Trash } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { TeamCallbackType } from '@/lib/litellm-callbacks';

// Team-scoped callback lever — the ONE runtime-supported callback write the proxy has. Attach a sink
// (e.g. langfuse / otel) to a team's structured logs, or disable a team's callback logging. Both go
// through the audited admin route. Disabled when the gateway is unreachable.

const TYPES: { value: TeamCallbackType; label: string }[] = [
  { value: 'success_and_failure', label: 'Success + failure' },
  { value: 'success', label: 'Success only' },
  { value: 'failure', label: 'Failure only' },
];

export function CallbacksTeamForm({ disabled }: Readonly<{ disabled?: boolean }>) {
  const [teamId, setTeamId] = useState('');
  const [callbackName, setCallbackName] = useState('');
  const [callbackType, setCallbackType] = useState<TeamCallbackType>('success_and_failure');
  const [varsRaw, setVarsRaw] = useState('');
  const [busy, setBusy] = useState(false);

  function parseVars(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of varsRaw.split(/[\n,]/)) {
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    }
    return out;
  }

  async function attach() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/gateway/callbacks/team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teamId, callbackName, callbackType, callbackVars: parseVars() }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `attach failed (${res.status})`);
      toast.success(`Attached "${callbackName}" callback to team ${teamId}.`);
      setCallbackName('');
      setVarsRaw('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disableLogging() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/gateway/callbacks/team?teamId=${encodeURIComponent(teamId)}`, {
        method: 'DELETE',
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `disable failed (${res.status})`);
      toast.success(`Disabled callback logging for team ${teamId}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canAttach = !disabled && !busy && teamId.trim() !== '' && callbackName.trim() !== '';
  const canDisable = !disabled && !busy && teamId.trim() !== '';

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <PlugsConnected weight="duotone" className="size-4 text-primary" />
          Team callback
        </CardTitle>
        <Badge variant="outline" className="font-mono text-[10px]">
          runtime-settable
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled ? (
          <p className="text-sm text-muted-foreground">
            The gateway is unreachable, so team callbacks can&apos;t be set right now.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Team id">
            <Input
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="team_1a2b…"
              disabled={disabled || busy}
            />
          </Field>
          <Field label="Callback sink">
            <Input
              value={callbackName}
              onChange={(e) => setCallbackName(e.target.value)}
              placeholder="langfuse, otel, s3…"
              disabled={disabled || busy}
            />
          </Field>
        </div>

        <Field label="Stream">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                disabled={disabled || busy}
                onClick={() => setCallbackType(t.value)}
                aria-pressed={t.value === callbackType}
                className={cn(
                  'rounded px-3 py-1 font-mono text-xs transition-colors',
                  t.value === callbackType
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Callback vars (key=value, one per line)">
          <Input
            value={varsRaw}
            onChange={(e) => setVarsRaw(e.target.value)}
            placeholder="langfuse_public_key=pk-…, langfuse_secret_key=sk-…"
            disabled={disabled || busy}
          />
        </Field>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canDisable}
            onClick={() => void disableLogging()}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Trash weight="bold" className="mr-1 size-4" />
            Disable team logging
          </Button>
          <Button size="sm" disabled={!canAttach} onClick={() => void attach()}>
            Attach callback
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="space-y-1.5">
      <Label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
