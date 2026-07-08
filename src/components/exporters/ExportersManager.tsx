'use client';

import { Plus, Trash, ArrowSquareOut, CheckCircle, XCircle, CircleNotch, Broadcast } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// The shapes the server hands us (mirror ExportTargetView + catalog; kept local for a lean bundle).
export interface ExporterCardData {
  id: string;
  kind: 'audit' | 'lineage' | 'metrics';
  label: string;
  target: string;
  endpoint: string;
  enabled: boolean;
  secretRef: string | null;
  runnable: boolean;
  lastStatus: 'ok' | 'fail' | null;
  lastDetail: string | null;
  lastAt: string | null;
}

export interface CatalogEntry {
  kind: 'audit' | 'lineage' | 'metrics';
  id: string;
  label: string;
  target: string;
  endpointRequired: boolean;
  secretRequired: boolean;
}

function StatusBadge({ t }: { t: ExporterCardData }) {
  if (t.lastStatus === 'ok') {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
        <CheckCircle className="size-3" /> Last: OK
      </Badge>
    );
  }
  if (t.lastStatus === 'fail') {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
        <XCircle className="size-3" /> Last: failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Never tested
    </Badge>
  );
}

function ExporterCard({
  t,
  onDelete,
  onTest,
  onRun,
  onToggle,
  busyId,
}: {
  t: ExporterCardData;
  onDelete: (t: ExporterCardData) => void;
  onTest: (t: ExporterCardData) => void;
  onRun: (t: ExporterCardData) => void;
  onToggle: (t: ExporterCardData, enabled: boolean) => void;
  busyId: string | null;
}) {
  const busy = busyId === t.id;
  return (
    <Card className="flex flex-col shadow-sm transition-colors hover:border-primary/40">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 truncate text-sm">
            <Broadcast className="size-4 text-primary" /> {t.label}
          </CardTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">{t.target}</p>
        </div>
        <Badge variant="outline" className="shrink-0 uppercase tracking-wide text-[10px]">
          {t.kind}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-xs text-muted-foreground">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <ArrowSquareOut className="size-3 shrink-0" />
            <span className="truncate font-mono text-[11px]">
              {t.endpoint || (t.kind === 'metrics' ? 'scrape mode (/metrics)' : '— no endpoint —')}
            </span>
          </div>
          {t.secretRef ? (
            <div className="truncate font-mono text-[11px]">token: vault:{t.secretRef}</div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge t={t} />
          {!t.runnable ? (
            <Badge variant="outline" className="text-amber-500 border-amber-500/40">
              Not ready
            </Badge>
          ) : null}
        </div>
        {t.lastDetail ? (
          <p className="line-clamp-2 leading-4">{t.lastDetail}</p>
        ) : null}
        {t.lastAt ? (
          <p className="text-[10px] text-muted-foreground/70">
            {new Date(t.lastAt).toLocaleString()}
          </p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={t.enabled}
              onCheckedChange={(v) => onToggle(t, v)}
              aria-label="Enabled"
            />
            <span className="text-[11px]">{t.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onTest(t)}>
              {busy ? <CircleNotch className="size-3 animate-spin" /> : 'Test'}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !t.runnable} onClick={() => onRun(t)}>
              Run
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(t)}
            >
              <Trash className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AddExporterSheet({
  open,
  onOpenChange,
  onSaved,
  catalog,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  catalog: CatalogEntry[];
}) {
  const [kind, setKind] = useState<CatalogEntry['kind']>(catalog[0]?.kind ?? 'audit');
  const [endpoint, setEndpoint] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cat = catalog.find((c) => c.kind === kind);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/admin/exporters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind,
        endpoint: endpoint.trim(),
        secretRef: secretRef.trim() || null,
        enabled: true,
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`${cat?.label ?? kind} exporter added`);
      setEndpoint('');
      setSecretRef('');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to add exporter');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New export target"
      description="Send a slice of the governance spine to your own tooling. The token is stored as a vault reference — never as a raw value."
      footer={
        <Button onClick={save} disabled={busy} className="w-full">
          Add exporter
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ex-kind">What to export</Label>
          <select
            id="ex-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as CatalogEntry['kind'])}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {catalog.map((c) => (
              <option key={c.kind} value={c.kind}>
                {c.label} — {c.target}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex-endpoint">
            Endpoint URL{cat && !cat.endpointRequired ? ' (optional)' : ''}
          </Label>
          <Input
            id="ex-endpoint"
            placeholder={
              kind === 'audit'
                ? 'https://splunk.example.com:8088'
                : kind === 'lineage'
                  ? 'https://purview.example.com/api/v1/lineage'
                  : 'https://otel-collector.example.com  (blank = Prometheus scrape mode)'
            }
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
          {kind === 'metrics' ? (
            <p className="text-[11px] text-muted-foreground">
              Leave blank to serve metrics at <span className="font-mono">/api/v1/exporters/metrics</span>{' '}
              for Prometheus to scrape. Set an OTLP collector URL to push instead.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex-secret">
            Token vault reference{cat && !cat.secretRequired ? ' (optional)' : ''}
          </Label>
          <Input
            id="ex-secret"
            placeholder="splunk/hec-token"
            value={secretRef}
            onChange={(e) => setSecretRef(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            The OpenBao key path holding the auth token (e.g. <span className="font-mono">splunk/hec-token</span>). The
            raw token is never stored here — write it in Secrets, then reference its key.
          </p>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

// Full-width export-targets surface: a grid of exporter cards + a URL-driven New sheet. Each card
// tests its connection for real, runs an export now, toggles enabled, and deletes with confirm.
export function ExportersManager({
  targets,
  catalog,
}: {
  targets: ExporterCardData[];
  catalog: CatalogEntry[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-exporter';
  const [busyId, setBusyId] = useState<string | null>(null);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const onDelete = useCallback(
    async (t: ExporterCardData) => {
      if (!confirm(`Delete the ${t.label} export target? Records will stop flowing to it.`)) return;
      const res = await fetch(`/api/v1/admin/exporters/${t.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`${t.label} exporter deleted`);
        router.refresh();
      } else {
        toast.error('Failed to delete exporter');
      }
    },
    [router],
  );

  const onTest = useCallback(
    async (t: ExporterCardData) => {
      setBusyId(t.id);
      const res = await fetch(`/api/v1/admin/exporters/${t.id}/test`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; detail?: string } | null;
      setBusyId(null);
      if (body?.ok) toast.success(body.detail ?? 'Connection OK');
      else toast.error(body?.detail ?? 'Connection failed');
      router.refresh();
    },
    [router],
  );

  const onRun = useCallback(
    async (t: ExporterCardData) => {
      setBusyId(t.id);
      const res = await fetch(`/api/v1/admin/exporters/${t.id}/run`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; detail?: string; count?: number }
        | null;
      setBusyId(null);
      if (body?.ok) toast.success(body.detail ?? 'Export complete');
      else toast.error(body?.detail ?? 'Export failed');
      router.refresh();
    },
    [router],
  );

  const onToggle = useCallback(
    async (t: ExporterCardData, enabled: boolean) => {
      const res = await fetch(`/api/v1/admin/exporters/${t.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) router.refresh();
      else toast.error('Failed to update exporter');
    },
    [router],
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">Export to your stack</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Stream the platform&apos;s audit trail, data lineage, and cost/usage metrics into your own
            SIEM, data catalog, and observability tools. Bring your own Splunk, Purview/Collibra, and
            Grafana — the platform is a good citizen of what you already run.
          </p>
        </div>
        <Button size="sm" onClick={() => setPanel('new-exporter')}>
          <Plus className="size-4" />
          New exporter
        </Button>
      </div>

      {targets.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No exporters yet. Add one to send audit → Splunk, lineage → Purview/Collibra, or metrics →
            Grafana/Prometheus.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {targets.map((t) => (
            <ExporterCard
              key={t.id}
              t={t}
              onDelete={onDelete}
              onTest={onTest}
              onRun={onRun}
              onToggle={onToggle}
              busyId={busyId}
            />
          ))}
        </div>
      )}

      <AddExporterSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        onSaved={() => router.refresh()}
        catalog={catalog}
      />
    </div>
  );
}
