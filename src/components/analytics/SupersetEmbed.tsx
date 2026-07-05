'use client';

import { ArrowSquareOut, Warning } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { EmbedGuard } from '@/components/control/EmbedGuard';
import { Button } from '@/components/ui/button';

interface TokenResult {
  configured: boolean;
  state: 'not-configured' | 'not-provisioned' | 'ready';
  token?: string;
  embedUuid?: string;
  supersetDomain?: string;
  reason?: string;
  error?: string;
}

// Superset dashboard embed with an honest not-provisioned state. It mints a guest token via the
// admin route, which verifies the dashboard UUID exists BEFORE handing back a token — so a missing
// dashboard shows a "not provisioned" CTA (with a one-click provision action) instead of a blank
// iframe. When ready, it frames the dashboard through EmbedGuard (probes X-Frame-Options first).
export function SupersetEmbed({ supersetBase }: { supersetBase?: string }) {
  const [tok, setTok] = useState<TokenResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch('/api/v1/admin/superset-token', { method: 'POST' })
      .then((r) => r.json())
      .then((j: TokenResult) => setTok(j))
      .catch((e) => setTok({ configured: true, state: 'not-provisioned', error: String(e) }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const provision = useCallback(async () => {
    setProvisioning(true);
    setProvisionError(null);
    try {
      const r = await fetch('/api/v1/admin/superset/provision', { method: 'POST' });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!j.ok) {
        setProvisionError(j.error ?? 'provisioning failed');
        return;
      }
      refresh();
    } catch (e) {
      setProvisionError(String(e));
    } finally {
      setProvisioning(false);
    }
  }, [refresh]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading Superset dashboard…</p>;
  }

  if (!tok || tok.state === 'not-configured') {
    return (
      <p className="text-xs text-muted-foreground">
        Superset not configured — set OFFGRID_SUPERSET_URL and credentials to surface dashboards here.
      </p>
    );
  }

  if (tok.state === 'not-provisioned') {
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex items-center gap-2 text-sm text-amber-700">
          <Warning className="size-4" />
          <span>
            Dashboard not provisioned{' '}
            <span className="text-xs text-muted-foreground">
              ({tok.reason ?? tok.error ?? 'the configured embed UUID does not exist in Superset'})
            </span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Provision a starter dashboard (requests over time, tokens by model) over the audit data.
          This is idempotent — it reuses an existing dashboard if one is present.
        </p>
        <Button size="sm" onClick={provision} disabled={provisioning}>
          {provisioning ? 'Provisioning…' : 'Provision dashboard'}
        </Button>
        {provisionError ? <p className="text-xs text-destructive">{provisionError}</p> : null}
        {supersetBase ? (
          <a
            href={supersetBase}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowSquareOut className="size-4" />
            Open Superset in a new tab
          </a>
        ) : null}
      </div>
    );
  }

  // Ready: dashboard verified. Frame the Superset UI (guest-token embedding handled by the SDK
  // consumer; here we frame the verified dashboard through the reachability/frameability guard).
  const dashboardUrl =
    tok.supersetDomain && tok.embedUuid
      ? `${tok.supersetDomain}/superset/dashboard/${tok.embedUuid}/?standalone=1`
      : supersetBase;
  return <EmbedGuard url={dashboardUrl} title="Superset" height={720} />;
}
