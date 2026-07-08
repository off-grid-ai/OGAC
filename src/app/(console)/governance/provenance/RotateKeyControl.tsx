'use client';

import { Key, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RotationPlan } from '@/lib/provenance-verify';

interface RotateResult {
  plan: RotationPlan;
  generated?: { publicKeyPem: string; privateKeyPem: string };
  currentPublicKey: string | null;
  algorithm: string;
}

// Rotate the provenance signing key. HONEST by construction: the console cannot durably swap the
// live key from a web request, so it generates a fresh keypair for the operator to install and shows
// the exact remaining step. The generated PRIVATE key is shown once, for the operator to copy.
export function RotateKeyControl({
  algorithm,
  currentPublicKey,
}: {
  algorithm: string;
  currentPublicKey: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RotateResult | null>(null);

  const rotate = async () => {
    if (
      !window.confirm(
        'Rotate the provenance signing key?\n\nThis generates a NEW keypair for you to install. It does NOT swap the live key by itself — you must install the private key on the server and restart. Existing records stay verifiable with the CURRENT public key.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/provenance/rotate-key', { method: 'POST' });
      const d = (await res.json()) as RotateResult & { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Rotation failed.');
      setResult(d);
      toast.success('New signing keypair generated — install it to complete rotation.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error('Copy failed — select and copy manually.');
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Key className="size-4 text-primary" />
          Signing key
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Provenance is signed with <span className="font-mono">{algorithm}</span>. Rotate the key to
          re-key future signatures — an admin, audited action.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentPublicKey ? (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Active public key</div>
            <pre className="mt-1 max-h-24 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] leading-tight text-muted-foreground">
              {currentPublicKey}
            </pre>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            <Warning className="mt-0.5 size-4 shrink-0" />
            <span>
              The active adapter has no public key (shared-secret HMAC). Switch to the ed25519 adapter
              for asymmetric, publicly verifiable provenance before rotating.
            </span>
          </div>
        )}

        <Button size="sm" variant="outline" disabled={busy} onClick={() => void rotate()}>
          <Key className="mr-1 size-3.5" />
          {busy ? 'Generating…' : 'Rotate signing key'}
        </Button>

        {result && (
          <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <Warning className="mt-0.5 size-4 shrink-0" />
              <span>{result.plan.remainingStep}</span>
            </div>

            {result.generated ? (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      New private key — install as OFFGRID_ED25519_PRIVATE_KEY
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void copy(result.generated!.privateKeyPem, 'Private key')}
                    >
                      Copy
                    </Button>
                  </div>
                  <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-tight text-foreground">
                    {result.generated.privateKeyPem}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      New public key — publish to verifiers
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void copy(result.generated!.publicKeyPem, 'Public key')}
                    >
                      Copy
                    </Button>
                  </div>
                  <pre className="max-h-24 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-tight text-muted-foreground">
                    {result.generated.publicKeyPem}
                  </pre>
                </div>
              </>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
