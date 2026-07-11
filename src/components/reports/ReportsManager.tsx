'use client';

import {
  DownloadSimple as Download,
  FileText,
  Lightning,
  PencilSimple,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  REPORT_FRAMEWORKS,
  REPORT_SCHEDULES,
  REPORT_SECTIONS,
  REPORT_SOURCES,
} from '@/lib/reports-template';

interface Template {
  id: string;
  name: string;
  description: string;
  source: string;
  kind: 'builtin' | 'custom';
  sections: string[];
  frameworks: string[];
  schedule: string;
  createdAt: string;
  updatedAt: string;
}

type Draft = {
  id?: string;
  name: string;
  description: string;
  source: string;
  sections: string[];
  frameworks: string[];
  schedule: string;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  source: REPORT_SOURCES[0],
  sections: [],
  frameworks: [],
  schedule: 'none',
};

export function ReportsManager({ initial }: Readonly<{ initial: Template[] }>) {
  const router = useRouter();
  const params = useSearchParams();
  const [templates, setTemplates] = useState<Template[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ name: string; body: string } | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  // Navigation lives in the URL: ?edit=new | ?edit=<id> drives the form; ?preview=<id> the run view.
  const editParam = params.get('edit');
  const previewParam = params.get('preview');

  const reload = useCallback(async () => {
    const r = await fetch('/api/v1/admin/reports');
    if (r.ok) setTemplates((await r.json()).data ?? []);
  }, []);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      router.push(`/insights/reports?${next.toString()}`);
    },
    [params, router],
  );

  // Sync the form draft from the URL.
  useEffect(() => {
    if (!editParam) {
      setDraft(null);
      return;
    }
    if (editParam === 'new') {
      setDraft((d) => d ?? { ...EMPTY_DRAFT });
      return;
    }
    const t = templates.find((x) => x.id === editParam);
    if (t) {
      setDraft({
        id: t.id,
        name: t.name,
        description: t.description,
        source: t.source,
        sections: [...t.sections],
        frameworks: [...t.frameworks],
        schedule: t.schedule,
      });
    }
  }, [editParam, templates]);

  // Sync the preview from the URL — run the report when ?preview lands.
  useEffect(() => {
    if (!previewParam) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await fetch(`/api/v1/admin/reports/${previewParam}/generate`, { method: 'POST' });
      if (cancelled) return;
      if (r.ok) {
        const d = await r.json();
        setPreview({ name: d.filename, body: d.body });
      } else {
        toast.error('Could not generate report');
        setParam('preview', null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewParam, setParam]);

  const isEditingBuiltin = useMemo(
    () => draft?.id && templates.find((t) => t.id === draft.id)?.kind === 'builtin',
    [draft, templates],
  );

  async function save() {
    if (!draft) return;
    setSaving(true);
    const payload = {
      name: draft.name,
      description: draft.description,
      source: draft.source,
      sections: draft.sections,
      frameworks: draft.frameworks,
      schedule: draft.schedule,
    };
    const r = draft.id
      ? await fetch(`/api/v1/admin/reports/${draft.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/v1/admin/reports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (r.ok) {
      toast.success(draft.id ? 'Template updated' : 'Template created');
      await reload();
      setParam('edit', null);
    } else {
      const d = await r.json().catch(() => ({}));
      toast.error(d.details?.join(', ') || 'Could not save template');
    }
  }

  async function remove(t: Template) {
    if (!confirm(`Delete report template “${t.name}”? This cannot be undone.`)) return;
    const r = await fetch(`/api/v1/admin/reports/${t.id}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Template deleted');
      await reload();
    } else {
      toast.error('Could not delete');
    }
  }

  async function run(t: Template) {
    setRunning(t.id);
    setParam('preview', t.id);
    setRunning(null);
  }

  const builtins = templates.filter((t) => t.kind === 'builtin');
  const customs = templates.filter((t) => t.kind === 'custom');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-lg font-semibold">Reports</h1>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Manage report templates. Each report is generated live from the control plane —
            traceable end to end — and exported as signed Markdown/PDF you can hand to a regulator.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setParam('edit', 'new')}>
          <Plus className="size-4" /> New template
        </Button>
      </div>

      {draft ? (
        <TemplateForm
          draft={draft}
          saving={saving}
          builtin={!!isEditingBuiltin}
          onChange={setDraft}
          onSave={save}
          onCancel={() => setParam('edit', null)}
        />
      ) : null}

      {customs.length > 0 ? (
        <Section title="Custom templates">
          <Grid templates={customs} onRun={run} running={running} onEdit={(id) => setParam('edit', id)} onDelete={remove} />
        </Section>
      ) : null}

      <Section title="Built-in reports">
        <Grid templates={builtins} onRun={run} running={running} onEdit={(id) => setParam('edit', id)} onDelete={remove} />
      </Section>

      <Dialog open={!!previewParam} onOpenChange={(o) => !o && setParam('preview', null)}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {preview ? preview.name : 'Generating…'}
            </DialogTitle>
          </DialogHeader>
          {preview ? (
            <>
              <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-xs">
                {preview.body}
              </pre>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/v1/admin/reports/${previewParam}/export`}>
                    <Download className="size-4" /> Markdown
                  </a>
                </Button>
                <Button size="sm" asChild>
                  <a href={`/api/v1/admin/reports/${previewParam}/export?format=pdf`}>
                    <Download className="size-4" /> PDF
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Running report…</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <div className="space-y-3">
      <h2 className="font-mono text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Grid({
  templates,
  onRun,
  running,
  onEdit,
  onDelete,
}: Readonly<{
  templates: Template[];
  onRun: (t: Template) => void;
  running: string | null;
  onEdit: (id: string) => void;
  onDelete: (t: Template) => void;
}>) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {templates.map((t) => (
        <Card key={t.id} className="flex flex-col shadow-sm">
          <CardContent className="flex flex-1 flex-col gap-3 p-4">
            <div className="flex items-center gap-2.5">
              <FileText className="size-5 shrink-0 text-primary" />
              <span className="font-mono text-sm font-medium">{t.name}</span>
              {t.kind === 'builtin' ? (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  built-in
                </Badge>
              ) : (
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  custom
                </Badge>
              )}
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{t.description || '—'}</p>
            <div className="flex flex-wrap gap-1">
              {t.sections.map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px]">
                  {s}
                </Badge>
              ))}
              {t.schedule && t.schedule !== 'none' ? (
                <Badge variant="outline" className="text-[10px] text-primary">
                  {t.schedule}
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {t.source}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1"
                  disabled={running === t.id}
                  onClick={() => onRun(t)}
                >
                  <Lightning className="size-3" /> Run
                </Button>
                <Button size="xs" variant="outline" className="gap-1" asChild>
                  <a href={`/api/v1/admin/reports/${t.id}/export`}>
                    <Download className="size-3" /> Export
                  </a>
                </Button>
                <button
                  onClick={() => onEdit(t.id)}
                  aria-label="Edit template"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <PencilSimple className="size-3.5" />
                </button>
                {t.kind === 'custom' ? (
                  <button
                    onClick={() => onDelete(t)}
                    aria-label="Delete template"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function TemplateForm({
  draft,
  saving,
  builtin,
  onChange,
  onSave,
  onCancel,
}: Readonly<{
  draft: Draft;
  saving: boolean;
  builtin: boolean;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}>) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm font-semibold">
            {draft.id ? (builtin ? 'Edit built-in report' : 'Edit template') : 'New report template'}
          </h2>
          <button onClick={onCancel} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {builtin ? (
          <p className="text-xs text-muted-foreground">
            Built-in reports are generation-locked (their sections are code-defined). You can edit
            the description, source, and schedule.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input
            value={draft.name}
            disabled={builtin}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="e.g. Quarterly board pack"
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Textarea
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            placeholder="What this report contains and who it's for."
            rows={2}
            className="text-xs"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Data source</Label>
            <select
              value={draft.source}
              onChange={(e) => onChange({ ...draft, source: e.target.value })}
              className="h-9 w-full rounded-md border bg-background px-2 font-mono text-xs"
            >
              {REPORT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Schedule</Label>
            <select
              value={draft.schedule}
              onChange={(e) => onChange({ ...draft, schedule: e.target.value })}
              className="h-9 w-full rounded-md border bg-background px-2 font-mono text-xs"
            >
              {REPORT_SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Sections {builtin ? '(code-defined)' : '(compose from live data)'}</Label>
          <div className="flex flex-wrap gap-1.5">
            {REPORT_SECTIONS.map((s) => (
              <Badge
                key={s}
                variant={draft.sections.includes(s) ? 'default' : 'outline'}
                className={builtin ? 'opacity-50' : 'cursor-pointer'}
                onClick={() => !builtin && onChange({ ...draft, sections: toggle(draft.sections, s) })}
              >
                {s}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Framework mapping (optional)</Label>
          <div className="flex flex-wrap gap-1.5">
            {REPORT_FRAMEWORKS.map((f) => (
              <Badge
                key={f}
                variant={draft.frameworks.includes(f) ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => onChange({ ...draft, frameworks: toggle(draft.frameworks, f) })}
              >
                {f}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving || (!builtin && (!draft.name.trim() || draft.sections.length === 0))}
          >
            {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
