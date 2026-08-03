'use client';

import { UserSwitch } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { explainResponse } from '@/lib/api-failure';
import { isActive, type CoverWindow } from '@/lib/cover';

interface CoverRow extends CoverWindow {
  id: string;
}

// ─── Cover — who handles the queue while someone is away ─────────────────────────────────────────────
//
// There was no delegation, no out-of-office and no reassignment, so one person on leave meant their queue
// silently stalled. On this tenant that is not hypothetical: it is what the ten-day-old cases under
// "nobody has picked this up" actually were.
//
// Deliberately small. The failure is nobody knowing who is covering — not a shortage of leave-management
// features — so this records the absence, names the stand-in, and shows it beside the work.
export function CoverPanel({
  initial,
  today,
  canEdit,
}: Readonly<{ initial: CoverRow[]; today: string; canEdit: boolean }>) {
  const router = useRouter();
  const [rows, setRows] = useState<CoverRow[]>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ away: '', coveredBy: '', from: today, until: '', note: '' });

  const active = rows.filter((r) => isActive(r, today));

  async function save() {
    setBusy(true);
    const res = await fetch('/api/v1/admin/cover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { reasons?: string[] };
      if (data.reasons?.length) {
        // The pure rules say exactly what is wrong; showing them beats a generic failure.
        toast.error(data.reasons.join(' '));
        return;
      }
      const f = await explainResponse(res, 'save this cover');
      (f.refusal ? toast.info : toast.error)(f.message);
      return;
    }
    const { cover } = (await res.json()) as { cover: CoverRow };
    setRows((r) => [cover, ...r]);
    setOpen(false);
    setForm({ away: '', coveredBy: '', from: today, until: '', note: '' });
    toast.success('Cover recorded — their work goes to the person covering.');
    router.refresh();
  }

  async function end(id: string) {
    const res = await fetch('/api/v1/admin/cover', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const f = await explainResponse(res, 'end this cover');
      (f.refusal ? toast.info : toast.error)(f.message);
      return;
    }
    setRows((r) => r.map((x) => (x.id === id ? { ...x, until: today } : x)));
    toast.success('Cover ended today.');
    router.refresh();
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UserSwitch className="size-4 text-muted-foreground" />
            Who is covering
          </CardTitle>
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
              {open ? 'Cancel' : 'Someone is away'}
            </Button>
          ) : null}
        </div>
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nobody is marked away. If someone goes on leave, say so here — otherwise their cases sit in
            the queue with nobody watching them.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {open ? (
          <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Who is away</span>
              <Input
                value={form.away}
                placeholder="name@company.com"
                onChange={(e) => setForm((f) => ({ ...f, away: e.target.value }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Who covers for them</span>
              <Input
                value={form.coveredBy}
                placeholder="name@company.com"
                onChange={(e) => setForm((f) => ({ ...f, coveredBy: e.target.value }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">From</span>
              <Input
                type="date"
                value={form.from}
                onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
              />
            </label>
            <label className="space-y-1">
              {/* Required, and the rules refuse a blank one: cover with no end date never ends, and
                  becomes permanent without anyone deciding that. */}
              <span className="text-[11px] text-muted-foreground">Until (required)</span>
              <Input
                type="date"
                value={form.until}
                onChange={(e) => setForm((f) => ({ ...f, until: e.target.value }))}
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[11px] text-muted-foreground">Anything the stand-in should know</span>
              <Input
                value={form.note}
                placeholder="Approve up to ₹50,000; anything larger, hold it for me"
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </label>
            <div className="sm:col-span-2">
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Record cover'}
              </Button>
            </div>
          </div>
        ) : null}

        {active.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
          >
            <div className="min-w-0 text-xs">
              <p className="text-foreground">
                <b>{r.away}</b> is away until {r.until} ·{' '}
                {r.coveredBy ? (
                  <>
                    covered by <b>{r.coveredBy}</b>
                  </>
                ) : (
                  // Named nobody: the honest state, and the one that leaves a queue unwatched.
                  <span className="text-amber-700 dark:text-amber-500">nobody named to cover</span>
                )}
              </p>
              {r.note ? <p className="text-muted-foreground">{r.note}</p> : null}
            </div>
            {canEdit ? (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => end(r.id)}>
                They&apos;re back
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
