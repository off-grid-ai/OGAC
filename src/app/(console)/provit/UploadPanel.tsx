'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Upload = { id: string; name: string; mime: string; size: number; createdAt: string; url: string };

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// File upload for Provit — stores in the console's SeaweedFS (public) and returns a URL Provit can
// fetch. Honest note in the copy: Provit's public intake maps a repo from a public URL, so this is
// how you hand it a file (e.g. a repo zip) via the console's own storage, not a parallel store.
export function UploadPanel() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/provit/upload');
      const d = await r.json();
      setUploads(d.uploads ?? []);
    } catch { /* keep last */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upload = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/v1/provit/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? 'upload failed');
      else load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'upload failed'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const remove = async (id: string) => {
    await fetch(`/api/v1/provit/upload?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  };

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Send a file to Provit</h2>
        <p className="text-sm text-muted-foreground">
          Upload a file (e.g. a repo zip) to the console&apos;s storage and get a public URL to hand
          to Provit. Provit maps repos from a public URL — this is the console-brokered way to feed
          it one, reusing the same SeaweedFS store as the rest of the console.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          disabled={busy}
          className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        {busy && <span className="text-xs text-muted-foreground">Uploading…</span>}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {uploads.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {uploads.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <a href={u.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-primary hover:underline">
                {u.name}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground">{human(u.size)}</span>
              <button
                onClick={() => navigator.clipboard?.writeText(u.url)}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                Copy URL
              </button>
              <button onClick={() => remove(u.id)} className="shrink-0 text-xs text-destructive hover:underline">Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
