'use client';

import { PaperPlaneRight } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';

interface Turn { role: 'user' | 'assistant'; text: string; governed?: boolean }

// The runnable surface of a deployed Studio app. Sends input to the public run endpoint
// (which executes through the governed pipeline) and shows the conversation.
export function DeployedApp({ slug }: { slug: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text }]);
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/app/${slug}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: text }),
      });
      const d = (await r.json()) as { output?: string; error?: string; governed?: boolean };
      setTurns((t) => [...t, { role: 'assistant', text: d.output || d.error || '(no response)', governed: d.governed }]);
    } catch {
      setTurns((t) => [...t, { role: 'assistant', text: '(the app is unreachable — try again)' }]);
    } finally {
      setBusy(false);
    }
  };

  // One place for the webhook curl copy (used by the pre's click + keyboard handlers).
  const copyCurl = () => {
    const cmd = `curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/app/${slug}/run -H 'content-type: application/json' -d '{"input":"..."}'`;
    void navigator.clipboard.writeText(cmd).then(() => toast.success('Copied'));
  };

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex-1 space-y-3">
        {turns.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Ask this app anything to get started.</p>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
              <div className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                t.role === 'user' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground'
              }`}>
                <p className="whitespace-pre-wrap">{t.text}</p>
                {t.role === 'assistant' && t.governed ? (
                  <span className="mt-1 block text-[10px] text-primary">✓ governed on-prem</span>
                ) : null}
              </div>
            </div>
          ))
        )}
        {busy ? <p className="text-xs text-muted-foreground">Thinking…</p> : null}
      </div>
      <div className="sticky bottom-4 flex items-end gap-2 rounded-lg border border-border bg-background p-2 shadow-sm">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-40"
        >
          <PaperPlaneRight className="size-4" />
        </button>
      </div>
      {/* Webhook trigger — this app is callable programmatically (S3, sync trigger) */}
      <details className="mt-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Call this app via API (webhook)</summary>
        <button
          type="button"
          aria-label="Copy the curl command to call this app"
          className="mt-1 block w-full cursor-copy text-left"
          onClick={copyCurl}
        >
          <pre className="overflow-x-auto rounded border border-border bg-muted/40 p-2 font-mono">{`curl -X POST /api/v1/app/${slug}/run -H 'content-type: application/json' -d '{"input":"..."}'`}</pre>
        </button>
      </details>
    </div>
  );
}
