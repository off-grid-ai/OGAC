'use client';
import { useCallback, useEffect, useState } from 'react';

type Repo = {
  id: string; url: string; name: string; features: number; cases: number; screens: number;
  hasSession: boolean; runCount: number; latestRunId?: string; latestRunFlagged: number;
};
type Status = { running: boolean; phase: string; message: string; error: string | null; repo: string | null } | null;

// Provit's INTELLIGENCE ENGINE, surfaced through the console: map a public repo (Provit reads the
// code + tests and synthesizes a feature map), watch the live job, and chat with the test copilot
// grounded in a mapped repo. Everything flows through /api/v1/provit/intelligence(/chat).
export function IntelligencePanel({ baseUrl }: { baseUrl: string }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/provit/intelligence');
      const d = await r.json();
      setRepos(d.repos ?? []);
      setStatus(d.status ?? null);
    } catch { /* leave last-known */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Poll while a map job is running so the operator sees progress without a manual refresh.
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [status?.running, load]);

  const map = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/provit/intelligence', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: repoUrl }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? 'map failed');
      else { setRepoUrl(''); load(); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'map failed'); }
    finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Intelligence engine</h2>
        <p className="text-sm text-muted-foreground">
          Point Provit at a public repo. It reads the code and tests, synthesizes a feature map, and
          generates user-story test cases — running on this console&apos;s gateway.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="w-full max-w-md rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button
          onClick={map}
          disabled={busy || !repoUrl.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Map repo'}
        </button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {status && (status.running || status.error || status.phase !== 'idle') && (
        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs">
          <span className="font-medium text-foreground">Map job:</span>{' '}
          <span className={status.error ? 'text-destructive' : 'text-muted-foreground'}>
            {status.error ? status.error : `${status.phase}${status.message ? ` — ${status.message}` : ''}`}
          </span>
          {status.repo && <span className="text-muted-foreground"> ({status.repo})</span>}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mapped by Provit</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{repos.length}</span>
        </div>
        {repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No repos mapped yet — map one above.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {repos.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="break-all text-sm font-medium text-foreground">{r.name}</span>
                  <a href={`${baseUrl}/features?repo=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-primary hover:underline">
                    open →
                  </a>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span><b className="text-foreground">{r.features}</b> features</span>
                  <span><b className="text-foreground">{r.cases}</b> tests</span>
                  <span><b className="text-foreground">{r.screens}</b> screens</span>
                  {r.runCount > 0 && <span><b className="text-foreground">{r.runCount}</b> runs</span>}
                </div>
                <Copilot repo={r.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// The test copilot for one mapped repo — Provit answers on the console's gateway, grounded in that
// repo's feature/batch context. A collapsible ask box per repo (kept simple: one question → reply).
function Copilot({ repo }: { repo: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = async () => {
    if (!q.trim()) return;
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const r = await fetch('/api/v1/provit/intelligence/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo, messages: [{ role: 'user', content: q }] }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? 'copilot unavailable');
      else setAnswer(d.content ?? '');
    } catch (e) { setErr(e instanceof Error ? e.message : 'copilot unavailable'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-2 border-t border-border pt-2">
      <button onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-primary hover:underline">
        {open ? 'Hide copilot' : 'Ask the test copilot'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
              placeholder="e.g. what corner cases are missing?"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
            <button onClick={ask} disabled={busy} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
              {busy ? '…' : 'Ask'}
            </button>
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
          {answer !== null && <p className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs text-foreground">{answer || '(no answer)'}</p>}
        </div>
      )}
    </div>
  );
}
