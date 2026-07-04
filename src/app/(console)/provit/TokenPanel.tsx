'use client';
import { useEffect, useState } from 'react';

type Tok = { id: string; label: string; ownerId: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };

// Mint a Provit integration token, hand it to a Provit instance (PROVIT_CONSOLE_TOKEN), and that
// instance's maps/runs push into THIS org as team data. Plaintext is shown once.
export function TokenPanel() {
  const [tokens, setTokens] = useState<Tok[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/v1/provit/tokens').then((r) => r.json()).then((d) => setTokens(d.tokens ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const mint = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/v1/provit/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) });
      const d = await r.json();
      if (d.token) { setFresh(d.token); setLabel(''); load(); }
    } finally { setBusy(false); }
  };
  const revoke = async (id: string) => { await fetch(`/api/v1/provit/tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); load(); };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Connect a Provit instance</h2>
      <p className="text-sm text-muted-foreground">
        Without a token, Provit runs are public and land in the showcase. Mint a token, set it on your
        Provit instance (hosted or self-hosted), and its repos and runs stay private to your org.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. CI, laptop)"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm" />
        <button onClick={mint} disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? 'Minting…' : 'Mint token'}
        </button>
      </div>

      {fresh && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-medium text-foreground">Copy it now — it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{fresh}</code>
            <button onClick={() => navigator.clipboard?.writeText(fresh)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Copy</button>
          </div>
          <pre className="overflow-x-auto rounded bg-background p-2 text-xs text-muted-foreground">{`PROVIT_CONSOLE_TOKEN=${fresh}`}</pre>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">{t.label || t.id}</span>
              <span className="text-xs text-muted-foreground">{t.lastUsedAt ? 'used' : 'unused'}</span>
              {t.revoked ? (
                <span className="ml-auto text-xs text-muted-foreground">revoked</span>
              ) : (
                <button onClick={() => revoke(t.id)} className="ml-auto text-xs text-destructive hover:underline">Revoke</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
