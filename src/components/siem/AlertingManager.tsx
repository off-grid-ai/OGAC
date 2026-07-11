'use client';

import { Bell, FloppyDisk, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  IsmPolicySummary,
  MonitorSummary,
  ThresholdOp,
} from '@/lib/opensearch-alerting-shape';

// SIEM alerting + retention management surface. URL-driven: `?panel=alerting` opens it, `?atab=`
// switches monitors↔retention — so both are deep-linkable and Back-coherent (no client-only nav
// state). Full CRUD: create/edit/delete monitors + view/set/delete the ISM retention policy.
// Destructive actions confirm. Degrades gracefully when the alerting/ISM plugins aren't installed
// (the routes report supported:false and we render a note — never fake success).

const OPS: ThresholdOp[] = ['gt', 'gte', 'lt', 'lte'];
const OP_LABEL: Record<ThresholdOp, string> = {
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
};

interface MonitorForm {
  id?: string;
  name: string;
  index: string;
  outcome: string;
  windowMinutes: number;
  intervalMinutes: number;
  threshold: number;
  op: ThresholdOp;
  enabled: boolean;
}

const BLANK_MONITOR: MonitorForm = {
  name: '',
  index: 'offgrid-audit',
  outcome: 'blocked',
  windowMinutes: 5,
  intervalMinutes: 5,
  threshold: 5,
  op: 'gt',
  enabled: true,
};

interface IsmForm {
  policyId: string;
  indexPatterns: string;
  rolloverAgeDays: number;
  rolloverSizeGb: number;
  retentionDays: number;
  description: string;
}

const BLANK_ISM: IsmForm = {
  policyId: 'offgrid-audit-retention',
  indexPatterns: 'offgrid-audit*',
  rolloverAgeDays: 1,
  rolloverSizeGb: 25,
  retentionDays: 90,
  description: '',
};

export function AlertingManager() {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === 'alerting';
  const tab = params.get('atab') === 'ism' ? 'ism' : 'monitors';

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
            <Bell className="size-4 text-primary" />
            <CardTitle className="text-sm">Alerting &amp; retention</CardTitle>
          </div>
          {open ? (
            <Button variant="ghost" size="sm" onClick={() => setParam('panel', null)} className="gap-1.5">
              <X className="size-4" />
              Close
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setParam('panel', 'alerting')}>
              Manage
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          OpenSearch alerting monitors (threshold triggers over the audit/gateway indices) and the
          index-lifecycle (ISM) retention policy.
        </p>
      </CardHeader>
      {open && (
        <CardContent className="space-y-5">
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setParam('atab', 'monitors')}
              className={`rounded-md border px-3 py-1.5 ${tab === 'monitors' ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
            >
              Monitors
            </button>
            <button
              onClick={() => setParam('atab', 'ism')}
              className={`rounded-md border px-3 py-1.5 ${tab === 'ism' ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
            >
              Retention (ISM)
            </button>
          </div>
          {tab === 'monitors' ? <MonitorsTab /> : <IsmTab />}
        </CardContent>
      )}
    </Card>
  );
}

// ── Monitors ─────────────────────────────────────────────────────────────────────────────────────

function MonitorsTab() {
  const router = useRouter();
  const params = useSearchParams();
  const [monitors, setMonitors] = useState<MonitorSummary[]>([]);
  const [supported, setSupported] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MonitorForm | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MonitorSummary | null>(null);
  const [busy, setBusy] = useState(false);

  // The monitor create/edit panel is a "place" — driven by `?monitor=new|<id>` so it's
  // deep-linkable and Back-coherent (nav-in-URL rule). `editing` holds the form draft.
  const monitorParam = params.get('monitor');
  const setMonitorParam = useCallback(
    (value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value == null) next.delete('monitor');
      else next.set('monitor', value);
      router.push(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );
  const openEditor = useCallback(
    (form: MonitorForm) => {
      setEditing(form);
      setMonitorParam(form.id ?? 'new');
    },
    [setMonitorParam],
  );
  const closeEditor = useCallback(() => {
    setEditing(null);
    setMonitorParam(null);
  }, [setMonitorParam]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/v1/admin/siem/alerting', { cache: 'no-store' });
    const d = (await res.json().catch(() => ({}))) as {
      supported?: boolean;
      monitors?: MonitorSummary[];
      note?: string;
      error?: string;
    };
    setSupported(d.supported !== false);
    setMonitors(d.monitors ?? []);
    setNote(d.note ?? null);
    setError(d.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toForm = useCallback(
    (m: MonitorSummary): MonitorForm => ({
      id: m.id,
      name: m.name,
      index: m.index || 'offgrid-audit',
      outcome: 'blocked',
      windowMinutes: 5,
      intervalMinutes: m.intervalMinutes ?? 5,
      threshold: m.threshold ?? 1,
      op: m.op ?? 'gt',
      enabled: m.enabled,
    }),
    [],
  );

  // Deep-link: if the URL asks for a monitor panel but we have no draft yet (e.g. page loaded
  // straight to `?monitor=<id>`), reconstruct the draft once monitors are loaded.
  useEffect(() => {
    if (!monitorParam || editing) return;
    if (monitorParam === 'new') {
      setEditing({ ...BLANK_MONITOR });
      return;
    }
    const m = monitors.find((x) => x.id === monitorParam);
    if (m) setEditing(toForm(m));
  }, [monitorParam, editing, monitors, toForm]);

  function startEdit(m: MonitorSummary) {
    openEditor(toForm(m));
  }

  async function save(form: MonitorForm) {
    setBusy(true);
    const path = form.id
      ? `/api/v1/admin/siem/alerting/${encodeURIComponent(form.id)}`
      : '/api/v1/admin/siem/alerting';
    const res = await fetch(path, {
      method: form.id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const d = (await res.json().catch(() => ({}))) as { supported?: boolean; note?: string; error?: string };
    setBusy(false);
    if (res.ok && d.supported !== false) {
      toast.success(form.id ? 'Monitor updated' : 'Monitor created');
      setEditing(null);
      void load();
    } else if (d.supported === false) {
      toast.error(d.note ?? 'Alerting plugin not available');
    } else {
      toast.error(d.error ?? 'Failed to save monitor');
    }
  }

  async function doDelete(m: MonitorSummary) {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/siem/alerting/${encodeURIComponent(m.id)}`, {
      method: 'DELETE',
    });
    setBusy(false);
    setConfirmDelete(null);
    if (res.ok) {
      toast.success(`Deleted monitor "${m.name}"`);
      void load();
    } else {
      const d = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
      toast.error(d.note ?? d.error ?? 'Failed to delete monitor');
    }
  }

  if (loading) return <LoadingBlock label="Loading monitors…" />;

  return (
    <div className="space-y-4">
      {!supported && (
        <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
          {note ?? 'The OpenSearch alerting plugin is not installed on this build — monitors are unavailable.'}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">{error}</p>
      )}

      {supported && (
        <div className="flex justify-end">
          <Button size="sm" className="gap-1.5" onClick={() => openEditor({ ...BLANK_MONITOR })}>
            <Plus className="size-4" />
            New monitor
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Index</TableHead>
            <TableHead>Condition</TableHead>
            <TableHead>Every</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {monitors.length ? (
            monitors.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs text-foreground">{m.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{m.index || '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {m.op && m.threshold != null ? `${OP_LABEL[m.op]} ${m.threshold}` : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {m.intervalMinutes != null ? `${m.intervalMinutes}m` : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant={m.enabled ? 'default' : 'secondary'}>
                    {m.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                </TableCell>
                <TableCell className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    onClick={() => startEdit(m)}
                    aria-label="Edit monitor"
                  >
                    <PencilSimple className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDelete(m)}
                    aria-label="Delete monitor"
                  >
                    <Trash className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                {supported ? 'No monitors yet. Create one to alert on audit thresholds.' : 'Unavailable.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <MonitorEditor
        form={editing}
        busy={busy}
        onClose={closeEditor}
        onSave={save}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete monitor?</DialogTitle>
            <DialogDescription>
              This permanently removes the monitor{' '}
              <span className="font-mono">{confirmDelete?.name}</span> from OpenSearch. It will no
              longer fire alerts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && doDelete(confirmDelete)}
              disabled={busy}
              className="gap-1.5"
            >
              {busy ? <Spinner /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MonitorEditor({
  form,
  busy,
  onClose,
  onSave,
}: Readonly<{
  form: MonitorForm | null;
  busy: boolean;
  onClose: () => void;
  onSave: (f: MonitorForm) => void;
}>) {
  const [draft, setDraft] = useState<MonitorForm>(BLANK_MONITOR);
  useEffect(() => {
    if (form) setDraft(form);
  }, [form]);

  const set = <K extends keyof MonitorForm>(k: K, v: MonitorForm[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <FormSheet
      open={!!form}
      onOpenChange={(o) => !o && onClose()}
      title={draft.id ? 'Edit monitor' : 'New monitor'}
      description="Alert when matching audit docs cross a threshold within a look-back window."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="gap-1.5"
            onClick={() => onSave(draft)}
            disabled={busy || !draft.name.trim() || !draft.index.trim()}
          >
            {busy ? <Spinner /> : <FloppyDisk className="size-4" />}
            Save
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="blocked-spike" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Index</Label>
            <Input value={draft.index} onChange={(e) => set('index', e.target.value)} placeholder="offgrid-audit" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Outcome (blank = all)</Label>
            <Input value={draft.outcome} onChange={(e) => set('outcome', e.target.value)} placeholder="blocked" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Window (minutes)</Label>
            <Input
              type="number"
              min={1}
              value={draft.windowMinutes}
              onChange={(e) => set('windowMinutes', Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Run every (minutes)</Label>
            <Input
              type="number"
              min={1}
              value={draft.intervalMinutes}
              onChange={(e) => set('intervalMinutes', Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Comparison</Label>
            <select
              value={draft.op}
              onChange={(e) => set('op', e.target.value as ThresholdOp)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
            >
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Threshold</Label>
            <Input
              type="number"
              min={0}
              value={draft.threshold}
              onChange={(e) => set('threshold', Number(e.target.value))}
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            <span>Enabled</span>
          </label>
        </div>
    </FormSheet>
  );
}

// ── ISM retention ────────────────────────────────────────────────────────────────────────────────

function IsmTab() {
  const [form, setForm] = useState<IsmForm>(BLANK_ISM);
  const [current, setCurrent] = useState<IsmPolicySummary | null>(null);
  const [supported, setSupported] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async (policyId: string) => {
    setLoading(true);
    const res = await fetch(`/api/v1/admin/siem/ism?policyId=${encodeURIComponent(policyId)}`, {
      cache: 'no-store',
    });
    const d = (await res.json().catch(() => ({}))) as {
      supported?: boolean;
      policy?: IsmPolicySummary | null;
      note?: string;
      error?: string;
    };
    setSupported(d.supported !== false);
    setNote(d.note ?? null);
    setError(d.error ?? null);
    if (d.policy) {
      setCurrent(d.policy);
      setForm({
        policyId: d.policy.policyId || policyId,
        indexPatterns: d.policy.indexPatterns.join(', ') || 'offgrid-audit*',
        rolloverAgeDays: d.policy.rolloverAgeDays ?? 0,
        rolloverSizeGb: d.policy.rolloverSizeGb ?? 0,
        retentionDays: d.policy.retentionDays ?? 90,
        description: d.policy.description ?? '',
      });
    } else {
      setCurrent(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(BLANK_ISM.policyId);
  }, [load]);

  async function save() {
    setBusy(true);
    const res = await fetch('/api/v1/admin/siem/ism', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        indexPatterns: form.indexPatterns
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    const d = (await res.json().catch(() => ({}))) as { supported?: boolean; note?: string; error?: string };
    setBusy(false);
    if (res.ok && d.supported !== false) {
      toast.success('Retention policy saved');
      void load(form.policyId);
    } else if (d.supported === false) {
      toast.error(d.note ?? 'ISM plugin not available');
    } else {
      toast.error(d.error ?? 'Failed to save policy');
    }
  }

  async function doDelete() {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/siem/ism?policyId=${encodeURIComponent(form.policyId)}`, {
      method: 'DELETE',
    });
    setBusy(false);
    setConfirmDelete(false);
    if (res.ok) {
      toast.success('Retention policy deleted');
      void load(form.policyId);
    } else {
      const d = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
      toast.error(d.note ?? d.error ?? 'Failed to delete policy');
    }
  }

  const set = <K extends keyof IsmForm>(k: K, v: IsmForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (loading) return <LoadingBlock label="Loading retention policy…" />;

  return (
    <div className="space-y-4">
      {!supported && (
        <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
          {note ?? 'The OpenSearch ISM plugin is not installed on this build — retention policies are unavailable.'}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">{error}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {current
          ? 'A retention policy is set. Edit and save to update it.'
          : 'No retention policy set for these indices yet. Fill in the window and save to create one.'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Policy id</Label>
          <Input value={form.policyId} onChange={(e) => set('policyId', e.target.value)} disabled={!supported} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Index patterns (comma-sep)</Label>
          <Input
            value={form.indexPatterns}
            onChange={(e) => set('indexPatterns', e.target.value)}
            placeholder="offgrid-audit*, offgrid-gateway*"
            disabled={!supported}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Delete after (days) — retention</Label>
          <Input
            type="number"
            min={1}
            value={form.retentionDays}
            onChange={(e) => set('retentionDays', Number(e.target.value))}
            disabled={!supported}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rollover at age (days, 0=off)</Label>
          <Input
            type="number"
            min={0}
            value={form.rolloverAgeDays}
            onChange={(e) => set('rolloverAgeDays', Number(e.target.value))}
            disabled={!supported}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rollover at size (GB, 0=off)</Label>
          <Input
            type="number"
            min={0}
            value={form.rolloverSizeGb}
            onChange={(e) => set('rolloverSizeGb', Number(e.target.value))}
            disabled={!supported}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Description</Label>
          <Input
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            disabled={!supported}
          />
        </div>
      </div>

      <div className="flex justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          disabled={busy || !supported || !current}
        >
          <Trash className="size-4" />
          Delete policy
        </Button>
        <Button className="gap-1.5" onClick={save} disabled={busy || !supported || !form.policyId.trim()}>
          {busy ? <Spinner /> : <FloppyDisk className="size-4" />}
          Save retention policy
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete retention policy?</DialogTitle>
            <DialogDescription>
              This removes the ISM policy <span className="font-mono">{form.policyId}</span>. Indices
              already managed by it keep their current lifecycle until re-evaluated, but no new
              rollover/deletion will be scheduled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={doDelete} disabled={busy} className="gap-1.5">
              {busy ? <Spinner /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
