'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DestinationSource } from '@/lib/qa/quality-alert-dispatch';

// Manage where answer-quality alerts are delivered, and prove the destination works before a real
// regression depends on it. This is the CRUD surface for a setting that used to live only in a
// server env file.

export interface AlertDestinationView {
  url: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

interface Props {
  destination: AlertDestinationView | null;
  activeSource: DestinationSource;
  paused: boolean;
}

type Feedback = { tone: 'ok' | 'error'; text: string } | null;

export function AlertDestinationCard({ destination, activeSource, paused }: Readonly<Props>) {
  const router = useRouter();
  const [url, setUrl] = useState(destination?.url ?? '');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const call = async (
    kind: 'save' | 'test' | 'remove',
    run: () => Promise<{ ok: boolean; text: string }>,
  ) => {
    setBusy(kind);
    setFeedback(null);
    try {
      const { ok, text } = await run();
      setFeedback({ tone: ok ? 'ok' : 'error', text });
      if (ok && kind !== 'test') router.refresh();
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const save = (enabled: boolean) =>
    call('save', async () => {
      const res = await fetch('/api/v1/admin/qa/alert-destination', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, enabled }),
      });
      const body = await res.json().catch(() => ({}));
      return {
        ok: res.ok,
        text: res.ok
          ? enabled
            ? 'Saved. Quality alerts will be delivered here.'
            : 'Saved and paused. No alerts will be sent until you resume.'
          : (body.error ?? `Could not save (HTTP ${res.status}).`),
      };
    });

  const sendTest = () =>
    call('test', async () => {
      const res = await fetch('/api/v1/admin/qa/alert-destination/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(url ? { url } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, text: body.error ?? `Test failed (HTTP ${res.status}).` };
      // The request can succeed while the destination refuses — report what actually happened.
      return {
        ok: Boolean(body.delivered),
        text: body.delivered
          ? 'Test alert delivered. Check that it arrived where you expect.'
          : `Not delivered — ${body.reason}`,
      };
    });

  const remove = () =>
    call('remove', async () => {
      const res = await fetch('/api/v1/admin/qa/alert-destination', { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, text: body.error ?? `Could not remove (HTTP ${res.status}).` };
      setUrl('');
      return { ok: true, text: 'Destination removed. Quality alerts will stop.' };
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Where quality alerts go</CardTitle>
        <CardDescription className="text-xs">
          You get told once when an app&apos;s answers start slipping, and once when they recover —
          not every time the check runs. Send a test first so you know it works before a real problem
          depends on it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {paused ? (
            <Badge variant="secondary" className="bg-muted text-foreground">
              paused
            </Badge>
          ) : activeSource === 'none' ? (
            <Badge variant="secondary" className="bg-muted text-foreground">
              no destination — alerts are off
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              alerts on
            </Badge>
          )}
          {/* An env-configured destination is invisible in this form; say so rather than show a
              blank field that reads as "alerts are off". */}
          {activeSource === 'env' ? (
            <span>Set on the server. Save one here to manage it in the console instead.</span>
          ) : null}
          {destination?.updatedBy ? <span>Last changed by {destination.updatedBy}</span> : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="alert-destination" className="text-xs">
              Destination URL
            </Label>
            <Input
              id="alert-destination"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.example.com/quality-alerts"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => save(true)} disabled={busy !== null || !url.trim()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={sendTest}
              disabled={busy !== null || (!url.trim() && activeSource === 'none')}
            >
              {busy === 'test' ? 'Sending…' : 'Send test'}
            </Button>
            {destination ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => save(!destination.enabled)}
                  disabled={busy !== null}
                >
                  {destination.enabled ? 'Pause' : 'Resume'}
                </Button>
                <Button size="sm" variant="outline" onClick={remove} disabled={busy !== null}>
                  {busy === 'remove' ? 'Removing…' : 'Remove'}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {feedback ? (
          <p
            className={`text-xs ${feedback.tone === 'ok' ? 'text-primary' : 'text-destructive'}`}
            role="status"
          >
            {feedback.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
