'use client';

import { LockKey, LockKeyOpen, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { type SealActionView, validateUnsealKey } from '@/lib/secrets-ops';

// Seal / unseal operator control — DESTRUCTIVE. Sealing a live vault takes secrets offline until an
// operator re-supplies the unseal key shares. Both actions are confirmed. The unseal key share is a
// write-only password field: sent to the server, never rendered back.
// eslint-disable-next-line complexity
export function SealControl({
  sealed,
  threshold,
  shares,
  progress,
}: {
  sealed: boolean | null;
  threshold: number | null;
  shares: number | null;
  progress: number | null;
}) {
  const [status, setStatus] = useState<SealActionView>({
    sealed,
    threshold,
    shares,
    progress,
    version: null,
  });
  const [unsealKey, setUnsealKey] = useState('');
  const [busy, setBusy] = useState(false);

  const isSealed = status.sealed;

  const post = async (body: Record<string, unknown>, ok: string): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/secrets/seal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as { status?: SealActionView; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Action failed.');
      if (d.status) setStatus(d.status);
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const seal = async () => {
    if (
      !window.confirm(
        'SEAL the vault? All secrets become inaccessible until operators re-supply the unseal key shares. This will break every service reading from OpenBao.',
      )
    ) {
      return;
    }
    await post({ action: 'seal' }, 'Vault sealed.');
  };

  const unseal = async () => {
    const v = validateUnsealKey(unsealKey);
    if (!v.ok) {
      toast.error(v.error ?? 'Invalid unseal key share.');
      return;
    }
    await post({ action: 'unseal', key: v.key }, 'Unseal key share accepted.');
    setUnsealKey('');
  };

  const reset = async () => {
    await post({ action: 'unseal', reset: true }, 'Unseal attempt reset.');
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {isSealed ? (
            <LockKey className="size-4 text-destructive" />
          ) : (
            <LockKeyOpen className="size-4 text-primary" />
          )}
          Seal control
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Seal state:{' '}
          <span className={isSealed ? 'font-semibold text-destructive' : 'font-semibold text-primary'}>
            {isSealed === true ? 'SEALED' : isSealed === false ? 'unsealed' : 'unknown'}
          </span>
          {status.threshold !== null && status.shares !== null && (
            <>
              {' '}
              · threshold {status.threshold} of {status.shares} shares
              {isSealed && status.progress !== null && (
                <> · progress {status.progress}/{status.threshold}</>
              )}
            </>
          )}
        </p>

        {isSealed ? (
          <form
            className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void unseal();
            }}
          >
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Warning className="mt-0.5 size-4 shrink-0" />
              <span>
                Submit one unseal key share at a time. {status.threshold ?? '?'} of{' '}
                {status.shares ?? '?'} shares are required to reconstruct the master key. The share is
                write-only and never stored by the console.
              </span>
            </div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Unseal key share
            </label>
            <Input
              type="password"
              autoComplete="off"
              value={unsealKey}
              onChange={(e) => setUnsealKey(e.target.value)}
              placeholder="base64 unseal key share"
            />
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={busy}>
                {busy ? 'Submitting…' : 'Submit share'}
              </Button>
              <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => void reset()}>
                Reset attempt
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:text-destructive"
              disabled={busy || isSealed !== false}
              onClick={() => void seal()}
            >
              <LockKey className="mr-1 size-3.5" />
              Seal vault
            </Button>
            <span className="text-[10px] text-muted-foreground">
              Destructive — takes all secrets offline.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
