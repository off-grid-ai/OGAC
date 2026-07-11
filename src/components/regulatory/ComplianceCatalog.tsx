'use client';

import { ArrowsLeftRight, CheckCircle, Circle, CircleDashed } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CONTROL_STATUSES,
  type CatalogControl,
  type CatalogFramework,
  type ControlTrackStatus,
  type CrossMapEntry,
  type FrameworkId,
} from '@/lib/compliance-catalog';

// The Regulatory control-tracking surface. Browse the three bundled frameworks (ISO 42001 / NIST
// AI RMF / EU AI Act), adopt one (seeds its controls as tracked), set each control's status
// (new → in-progress → met), and see the cross-framework mapping ("this control also satisfies…").
// Nav (active framework tab) lives in the URL (?fw=) so Back is coherent and the tab is deep-linkable.

export interface FrameworkView {
  id: FrameworkId;
  name: string;
  total: number;
  met: number;
  inProgress: number;
  coverage: number;
  adopted: boolean;
}

const STATUS_META: Record<
  ControlTrackStatus,
  { label: string; cls: string; Icon: typeof Circle }
> = {
  new: { label: 'new', cls: 'text-muted-foreground', Icon: Circle },
  'in-progress': { label: 'in progress', cls: 'text-amber-600', Icon: CircleDashed },
  met: { label: 'met', cls: 'text-primary', Icon: CheckCircle },
};

export function ComplianceCatalog({
  catalog,
  overview,
  statuses,
  crossMap,
}: Readonly<{
  catalog: CatalogFramework[];
  overview: FrameworkView[];
  statuses: Record<string, ControlTrackStatus>;
  crossMap: CrossMapEntry[];
}>) {
  const router = useRouter();
  const params = useSearchParams();
  const active = (params.get('fw') as FrameworkId) || catalog[0]?.id;
  const [busy, setBusy] = useState<string | null>(null);

  const crossMapById = new Map(crossMap.map((e) => [e.control.id, e.satisfies]));
  const ovById = new Map(overview.map((o) => [o.id, o]));

  const setTab = useCallback(
    (fw: string) => {
      const p = new URLSearchParams(params.toString());
      p.set('fw', fw);
      router.replace(`?${p.toString()}`, { scroll: false });
    },
    [params, router],
  );

  async function adopt(frameworkId: FrameworkId, name: string) {
    setBusy(`adopt:${frameworkId}`);
    try {
      const res = await fetch('/api/v1/admin/compliance/frameworks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ frameworkId }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Adopted ${name} — controls now tracked`);
      router.refresh();
    } catch {
      toast.error('Failed to adopt framework');
    } finally {
      setBusy(null);
    }
  }

  async function unadopt(frameworkId: FrameworkId, name: string) {
    setBusy(`adopt:${frameworkId}`);
    try {
      const res = await fetch(
        `/api/v1/admin/compliance/frameworks?frameworkId=${encodeURIComponent(frameworkId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('failed');
      toast.success(`Stopped tracking ${name}`);
      router.refresh();
    } catch {
      toast.error('Failed to un-adopt framework');
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(controlId: string, status: ControlTrackStatus) {
    setBusy(`ctl:${controlId}`);
    try {
      const res = await fetch(
        `/api/v1/admin/compliance/controls/${encodeURIComponent(controlId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      toast.error('Failed to update status');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Framework catalog — adopt & track controls</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Three real AI-governance frameworks ship in the box. Adopt one to start tracking its
          controls, set each control&apos;s status, and see where a control satisfies another
          framework at the same time.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs value={active} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            {catalog.map((f) => {
              const ov = ovById.get(f.id);
              return (
                <TabsTrigger key={f.id} value={f.id}>
                  {f.name}
                  {ov?.adopted && (
                    <Badge variant="secondary" className="ml-1.5 bg-primary/10 text-primary">
                      {ov.coverage}%
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {catalog.map((f) => {
            const ov = ovById.get(f.id);
            const isBusy = busy === `adopt:${f.id}`;
            return (
              <TabsContent key={f.id} value={f.id} className="space-y-4 pt-3">
                <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{f.name}</span>
                      <span className="text-xs text-muted-foreground">{f.authority}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{f.summary}</p>
                    {ov && (
                      <div className="mt-2 flex items-center gap-3">
                        <Progress value={ov.coverage} className="h-1.5 w-40" />
                        <span className="text-xs text-muted-foreground">
                          {ov.met} met · {ov.inProgress} in progress · {ov.total} controls
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {ov?.adopted ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => unadopt(f.id, f.name)}
                      >
                        {isBusy ? 'Working…' : 'Stop tracking'}
                      </Button>
                    ) : (
                      <Button size="sm" disabled={isBusy} onClick={() => adopt(f.id, f.name)}>
                        {isBusy ? 'Adopting…' : 'Adopt framework'}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {f.controls.map((c) => (
                    <ControlRow
                      key={c.id}
                      control={c}
                      status={statuses[c.id]}
                      tracked={statuses[c.id] !== undefined}
                      satisfies={crossMapById.get(c.id) ?? []}
                      busy={busy === `ctl:${c.id}`}
                      onSetStatus={(s) => setStatus(c.id, s)}
                    />
                  ))}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ControlRow({
  control,
  status,
  tracked,
  satisfies,
  busy,
  onSetStatus,
}: Readonly<{
  control: CatalogControl;
  status: ControlTrackStatus | undefined;
  tracked: boolean;
  satisfies: CrossMapEntry['satisfies'];
  busy: boolean;
  onSetStatus: (s: ControlTrackStatus) => void;
}>) {
  const meta = STATUS_META[status ?? 'new'];
  const StatusIcon = meta.Icon;
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[11px]">
              {control.ref}
            </Badge>
            <span className="text-sm font-medium text-foreground">{control.title}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{control.description}</p>
          {satisfies.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <ArrowsLeftRight className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">also satisfies</span>
              {satisfies.map((s) => (
                <Badge key={s.id} variant="secondary" className="text-[11px]">
                  {s.ref}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                className={`gap-1.5 ${meta.cls}`}
              >
                <StatusIcon className="size-4" />
                {tracked ? meta.label : 'track'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CONTROL_STATUSES.map((s) => (
                <DropdownMenuItem key={s} onClick={() => onSetStatus(s)}>
                  {STATUS_META[s].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
