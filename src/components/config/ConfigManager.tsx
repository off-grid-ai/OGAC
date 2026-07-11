'use client';

import {
  ArrowClockwise,
  Eye,
  EyeSlash,
  FloppyDisk,
  Lock,
  MagnifyingGlass,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfigEntry {
  key: string;
  group: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'url';
  secret: boolean;
  restartRequired: boolean;
  description: string;
  value: string;
  isSet: boolean;
  source: 'env-file' | 'process' | 'default';
  /** Suggested mDNS default, shown as a placeholder when the key is unset. */
  default?: string;
  /** Host-bearing value — displayed/edited in mDNS form. */
  hostValue?: boolean;
}

const SECRET_SENTINEL = '••••••••';

/** The value shown in a field: a pending edit wins; otherwise secrets mask (or reveal), plain values show as-is. */
function fieldDisplay(entry: ConfigEntry, pending: string | undefined, revealed: string | undefined): string {
  if (pending !== undefined) return pending;
  if (!entry.secret) return entry.value;
  if (revealed !== undefined) return revealed;
  return entry.isSet ? SECRET_SENTINEL : '';
}

/** Placeholder for an unset field: secrets say "not set", others hint the mDNS default; set fields have none. */
function fieldPlaceholder(entry: ConfigEntry): string {
  if (entry.isSet) return '';
  if (entry.secret) return 'not set';
  return entry.default ?? '';
}

function Field({
  entry,
  pending,
  revealed,
  onChange,
  onReveal,
}: Readonly<{
  entry: ConfigEntry;
  pending: string | undefined;
  revealed: string | undefined;
  onChange: (key: string, value: string | undefined) => void;
  onReveal: (key: string) => void;
}>) {
  const dirty = pending !== undefined;

  if (entry.type === 'boolean') {
    const on = (pending ?? entry.value) === 'true';
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(entry.key, on ? 'false' : 'true')}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted'}`}
      >
        <span className={`inline-block size-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    );
  }

  // For secrets: masked until revealed. Once revealed (or edited), show the text.
  const showText = !entry.secret || dirty || revealed !== undefined;
  const display = fieldDisplay(entry, pending, revealed);
  // When unset, hint the mDNS default (never a raw IP). Secrets just say "not set".
  const placeholder = fieldPlaceholder(entry);

  return (
    <div className="relative w-full">
      <Input
        type={showText ? 'text' : 'password'}
        value={display}
        placeholder={placeholder}
        onChange={(e) => onChange(entry.key, e.target.value)}
        className={`h-8 font-mono text-xs ${entry.secret ? 'pr-8' : ''} ${dirty ? 'border-amber-400' : ''}`}
      />
      {entry.secret && (
        <button
          type="button"
          title={showText ? 'Hide' : 'Reveal'}
          onClick={() => onReveal(entry.key)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showText ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

export function ConfigManager({ only }: { only?: string[] } = {}) {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const toggleReveal = async (key: string) => {
    if (revealed[key] !== undefined) {
      setRevealed((r) => { const next = { ...r }; delete next[key]; return next; });
      return;
    }
    try {
      const res = await fetch(`/api/v1/admin/config/reveal?key=${encodeURIComponent(key)}`);
      const body = (await res.json().catch(() => ({}))) as { value?: string; error?: string };
      if (!res.ok) { toast.error(body.error ?? 'Reveal failed.'); return; }
      setRevealed((r) => ({ ...r, [key]: body.value ?? '' }));
    } catch {
      toast.error('Reveal failed.');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const r = await fetch('/api/v1/admin/config');
      const body = (await r.json().catch(() => ({}))) as { entries?: ConfigEntry[]; error?: string };
      if (!r.ok) { setApiError(body.error ?? `HTTP ${r.status}`); return; }
      setEntries(body.entries ?? []);
    } catch {
      setApiError('unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onChange = (key: string, value: string | undefined) => {
    setPending((p) => {
      const next = { ...p };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const dirtyKeys = Object.keys(pending);
  const dirtyCount = dirtyKeys.length ? ` (${dirtyKeys.length})` : '';

  const save = async () => {
    if (!dirtyKeys.length) return;
    setSaving(true);
    try {
      const r = await fetch('/api/v1/admin/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: pending }),
      });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; restartRequired?: string[] };
      if (!r.ok || !body.ok) { toast.error(body.error ?? 'Save failed.'); return; }
      toast.success(
        body.restartRequired?.length
          ? `Saved. Restart the console to apply ${body.restartRequired.length} setting(s).`
          : 'Saved.',
      );
      setPending({});
      void load();
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    let base = only?.length ? entries.filter((e) => only.includes(e.group)) : entries;
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter((e) => e.key.toLowerCase().includes(q) || e.label.toLowerCase().includes(q) || e.group.toLowerCase().includes(q));
    }
    return base;
  }, [entries, search, only]);

  const groups = useMemo(() => [...new Set(filtered.map((e) => e.group))], [filtered]);

  if (apiError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <Warning className="mt-0.5 size-4 shrink-0" />
        <div>
          {apiError === 'forbidden' ? (
            <><span className="font-medium">Admin access required.</span> Configuration is admin-only — your account needs the <code className="rounded bg-muted px-1">admin</code> role (or be listed in OFFGRID_ADMIN_EMAILS).</>
          ) : apiError === 'unreachable' ? (
            <><span className="font-medium">Couldn&apos;t reach the config API.</span> Retry.</>
          ) : (
            <><span className="font-medium">Failed to load:</span> {apiError}</>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-background/80 py-1 backdrop-blur">
        <div className="relative min-w-[200px] flex-1">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter settings…" className="h-8 pl-7 text-xs" />
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {dirtyKeys.length > 0 ? `${dirtyKeys.length} unsaved` : `${entries.length} settings`}
        </span>
        {dirtyKeys.length > 0 && (
          <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setPending({})}>
            <ArrowClockwise className="size-3.5" /> Discard
          </Button>
        )}
        <Button size="sm" className="h-8 gap-1.5" disabled={!dirtyKeys.length || saving} onClick={save}>
          <FloppyDisk className="size-3.5" />
          {saving ? 'Saving…' : `Save${dirtyCount}`}
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Lock className="size-3" /> secret (write-only)</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-400" /> unsaved change</span>
        <span>changes apply on restart</span>
      </div>

      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">Loading…</p>
      ) : (
        groups.map((group) => (
          <div key={group} className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.filter((e) => e.group === group).map((entry) => (
                <div
                  key={entry.key}
                  className={`flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm transition-colors ${
                    pending[entry.key] !== undefined ? 'border-amber-400' : 'border-border'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{entry.label}</span>
                      {entry.secret && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                      {pending[entry.key] !== undefined && <span className="size-2 shrink-0 rounded-full bg-amber-400" />}
                    </div>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{entry.key}</p>
                  </div>
                  <Field
                    entry={entry}
                    pending={pending[entry.key]}
                    revealed={revealed[entry.key]}
                    onChange={onChange}
                    onReveal={toggleReveal}
                  />
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">{entry.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
