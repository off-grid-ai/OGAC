'use client';

import { Database, Info, ShieldCheck, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { LoadingBlock } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  AliasSummary,
  DetectorSummary,
  IndexTemplateSummary,
} from '@/lib/opensearch-admin';

// READ-ONLY index-lifecycle + security-analytics context surface, complementing the writable
// Alerting/ISM manager. URL-driven: `?ipanel=index-admin` opens it, `?itab=` switches
// templates↔aliases↔detectors, `?isel=` opens a row's detail — so every position is deep-linkable and
// Back-coherent (nav-in-URL rule). Index templates + aliases are deploy-owned (read-only); detectors
// are surfaced with firing state. Degrades honestly when the security-analytics plugin isn't
// installed (the route reports supported:false and we render a note — never faking data).

type Tab = 'templates' | 'aliases' | 'detectors';
const TABS: { id: Tab; label: string }[] = [
  { id: 'templates', label: 'Templates' },
  { id: 'aliases', label: 'Aliases' },
  { id: 'detectors', label: 'Detectors' },
];

export function IndexAdminManager() {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('ipanel') === 'index-admin';
  const rawTab = params.get('itab');
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : 'templates';

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value == null) next.delete(key);
      else next.set(key, value);
      router.push(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-primary" />
            <CardTitle className="text-sm">Index lifecycle &amp; threat detection</CardTitle>
          </div>
          {open ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setParam('ipanel', null)}
              className="gap-1.5"
            >
              <X className="size-4" />
              Close
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setParam('ipanel', 'index-admin')}>
              Inspect
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          The index templates + write-aliases that back the audit/gateway indices (read-only,
          bootstrapped with the cluster) and the native security-analytics detectors with their
          firing state.
        </p>
      </CardHeader>
      {open && (
        <CardContent className="space-y-5">
          <div className="flex gap-2 text-xs">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setParam('itab', t.id)}
                className={`rounded-md border px-3 py-1.5 ${tab === t.id ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'templates' && <TemplatesTab />}
          {tab === 'aliases' && <AliasesTab />}
          {tab === 'detectors' && <DetectorsTab />}
        </CardContent>
      )}
    </Card>
  );
}

// Shared: drive the row-detail selection from `?isel=` so it's deep-linkable + Back-coherent.
function useDetailParam() {
  const router = useRouter();
  const params = useSearchParams();
  const sel = params.get('isel');
  const setSel = useCallback(
    (value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value == null) next.delete('isel');
      else next.set('isel', value);
      router.push(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );
  return { sel, setSel };
}

// ── Templates ────────────────────────────────────────────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState<IndexTemplateSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { sel, setSel } = useDetailParam();

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetch('/api/v1/admin/siem/templates', { cache: 'no-store' });
      const d = (await res.json().catch(() => ({}))) as {
        templates?: IndexTemplateSummary[];
        error?: string;
      };
      setTemplates(d.templates ?? []);
      setError(d.error ?? null);
      setLoading(false);
    })();
  }, []);

  const active = templates.find((t) => t.name === sel) ?? null;

  if (loading) return <LoadingBlock label="Loading index templates…" />;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Template</TableHead>
            <TableHead>Patterns</TableHead>
            <TableHead>Shards / replicas</TableHead>
            <TableHead>Fields</TableHead>
            <TableHead>Rollover alias</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.length ? (
            templates.map((t) => (
              <TableRow
                key={t.name}
                className="cursor-pointer"
                onClick={() => setSel(t.name)}
              >
                <TableCell className="font-mono text-xs text-foreground">{t.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {t.indexPatterns.join(', ') || '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t.numberOfShards ?? '—'} / {t.numberOfReplicas ?? '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.mappedFields}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {t.rolloverAlias ? (
                    <Badge variant="secondary">{t.rolloverAlias}</Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                No index templates found on this cluster.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <FormSheet
        open={!!active}
        onOpenChange={(o) => !o && setSel(null)}
        title={active?.name ?? ''}
        description="Index template — read-only. Governs the mappings/settings a matching new index inherits."
        size="md"
        footer={
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setSel(null)}>
              Close
            </Button>
          </div>
        }
      >
        {active && (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Index patterns" value={active.indexPatterns.join(', ') || '—'} mono />
            <Field label="Priority" value={active.priority?.toString() ?? '—'} />
            <Field label="Shards" value={active.numberOfShards?.toString() ?? '—'} />
            <Field label="Replicas" value={active.numberOfReplicas?.toString() ?? '—'} />
            <Field label="Mapped fields" value={active.mappedFields.toString()} />
            <Field label="Data stream" value={active.dataStream ? 'yes' : 'no'} />
            <Field label="Rollover alias" value={active.rolloverAlias ?? '—'} mono />
            <Field label="Composed of" value={active.composedOf.join(', ') || '—'} mono />
          </dl>
        )}
      </FormSheet>
    </div>
  );
}

// ── Aliases ──────────────────────────────────────────────────────────────────────────────────────

function AliasesTab() {
  const [aliases, setAliases] = useState<AliasSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetch('/api/v1/admin/siem/aliases', { cache: 'no-store' });
      const d = (await res.json().catch(() => ({}))) as {
        aliases?: AliasSummary[];
        error?: string;
      };
      setAliases(d.aliases ?? []);
      setError(d.error ?? null);
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingBlock label="Loading aliases…" />;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Alias</TableHead>
            <TableHead>Indices</TableHead>
            <TableHead>Write index</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {aliases.length ? (
            aliases.map((a) => (
              <TableRow key={a.alias}>
                <TableCell className="font-mono text-xs text-foreground">
                  {a.alias}
                  {a.system && (
                    <Badge variant="secondary" className="ml-2">
                      system
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {a.members.map((m) => m.index).join(', ')}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {a.members.find((m) => m.isWriteIndex)?.index ?? '—'}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-xs text-muted-foreground">
                No aliases found on this cluster.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Detectors ────────────────────────────────────────────────────────────────────────────────────

function DetectorsTab() {
  const [detectors, setDetectors] = useState<DetectorSummary[]>([]);
  const [supported, setSupported] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { sel, setSel } = useDetailParam();

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetch('/api/v1/admin/siem/detectors', { cache: 'no-store' });
      const d = (await res.json().catch(() => ({}))) as {
        supported?: boolean;
        detectors?: DetectorSummary[];
        note?: string;
        error?: string;
      };
      setSupported(d.supported !== false);
      setDetectors(d.detectors ?? []);
      setNote(d.note ?? null);
      setError(d.error ?? null);
      setLoading(false);
    })();
  }, []);

  const active = detectors.find((d) => d.id === sel) ?? null;

  if (loading) return <LoadingBlock label="Loading detectors…" />;

  return (
    <div className="space-y-4">
      {!supported && (
        <p className="flex items-start gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          {note ??
            'The OpenSearch security-analytics plugin is not installed on this build — threat detectors are unavailable.'}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {supported && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Detector</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Rules</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Firing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detectors.length ? (
              detectors.map((d) => (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => setSel(d.id)}>
                  <TableCell className="font-mono text-xs text-foreground">{d.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.detectorType || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.customRuleCount + d.prePackagedRuleCount}
                  </TableCell>
                  <TableCell>
                    <Badge variant={d.enabled ? 'default' : 'secondary'}>
                      {d.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {d.activeAlerts > 0 ? (
                      <Badge variant="destructive">{d.activeAlerts} active</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">clear</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                  No detectors configured. Define them in OpenSearch Dashboards security-analytics.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <FormSheet
        open={!!active}
        onOpenChange={(o) => !o && setSel(null)}
        title={active?.name ?? ''}
        description="Security-analytics detector — read-only, with firing state."
        size="md"
        footer={
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setSel(null)}>
              Close
            </Button>
          </div>
        }
      >
        {active && (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Type" value={active.detectorType || '—'} />
            <Field label="State" value={active.enabled ? 'enabled' : 'disabled'} />
            <Field label="Indices" value={active.indices.join(', ') || '—'} mono />
            <Field label="Custom rules" value={active.customRuleCount.toString()} />
            <Field label="Pre-packaged rules" value={active.prePackagedRuleCount.toString()} />
            <Field label="Triggers" value={active.triggerCount.toString()} />
            <Field label="Active alerts" value={active.activeAlerts.toString()} />
            <Field label="Acknowledged alerts" value={active.acknowledgedAlerts.toString()} />
            <Field
              label="Last updated"
              value={active.lastUpdate ? new Date(active.lastUpdate).toLocaleString() : '—'}
            />
          </dl>
        )}
      </FormSheet>

      {supported && detectors.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Firing state reflects active alerts from the security-analytics alerts API.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-foreground' : 'text-foreground'}>{value}</dd>
    </div>
  );
}
