'use client';

import { ArrowCounterClockwise, FloppyDisk, Lightning, Lock, Warning } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface ConfigEntry {
  key: string;
  group: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  liveReload: boolean;
  secret: boolean;
  description: string;
  value: string;       // current live value from gateway (*** if secret)
  current: string;     // runtime effective value (post live-reload)
  savedValue: string;  // last value saved via console
  updatedAt: string | null;
  updatedBy: string;
}

interface ConfigResponse {
  available: boolean;
  entries: ConfigEntry[];
}

interface SaveResult {
  ok: boolean;
  applied: string[];
  restartRequired: string[];
}

// Editable field for a single config entry.
// eslint-disable-next-line complexity
function ConfigField({
  entry,
  pending,
  onChange,
}: {
  entry: ConfigEntry;
  pending: string | undefined;
  onChange: (key: string, value: string) => void;
}) {
  const displayValue = pending ?? entry.savedValue ?? entry.current ?? '';

  if (entry.type === 'boolean') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={displayValue === 'true'}
        onClick={() => onChange(entry.key, displayValue === 'true' ? 'false' : 'true')}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          displayValue === 'true' ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            displayValue === 'true' ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    );
  }

  return (
    <Input
      type={entry.secret ? 'password' : entry.type === 'number' ? 'number' : 'text'}
      value={displayValue}
      placeholder={entry.secret ? '(set — masked)' : `default`}
      onChange={(e) => onChange(entry.key, e.target.value)}
      className="h-7 max-w-xs font-mono text-xs"
    />
  );
}

// One group of related settings.
function SettingsGroup({
  group,
  entries,
  pending,
  saving,
  onSave,
  onChange,
}: {
  group: string;
  entries: ConfigEntry[];
  pending: Record<string, string>;
  saving: boolean;
  onSave: (keys: string[]) => void;
  onChange: (key: string, value: string) => void;
}) {
  const dirty = entries.filter((e) => pending[e.key] !== undefined);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">{group}</CardTitle>
        {dirty.length > 0 && (
          <Button size="sm" disabled={saving} onClick={() => onSave(dirty.map((e) => e.key))}>
            <FloppyDisk size={13} className="mr-1" />
            Save {dirty.length} change{dirty.length > 1 ? 's' : ''}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {entries.map((e) => {
          const isDirty = pending[e.key] !== undefined;
          return (
            <div key={e.key} className="grid grid-cols-[1fr_auto] items-start gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-medium">{e.label}</span>
                  {e.secret && <Lock size={10} className="text-muted-foreground shrink-0" />}
                  {e.liveReload && (
                    <span title="Applies without restart">
                      <Lightning size={10} className="text-primary shrink-0" />
                    </span>
                  )}
                  {isDirty && <span className="size-1.5 rounded-full bg-amber-400 shrink-0" />}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{e.description}</p>
                <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">{e.key}</p>
                {e.updatedBy && (
                  <p className="text-[10px] text-muted-foreground/60">
                    Last set by {e.updatedBy}
                    {e.updatedAt ? ` · ${new Date(e.updatedAt).toLocaleString()}` : ''}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <ConfigField entry={e} pending={pending[e.key]} onChange={onChange} />
                {isDirty && (
                  <button
                    type="button"
                    title="Discard"
                    onClick={() => onChange(e.key, '\x00')} // sentinel = discard
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ArrowCounterClockwise size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// eslint-disable-next-line complexity
export function GatewaySettings() {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<SaveResult | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/v1/gateway/config');
      setData((await r.json()) as ConfigResponse);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleChange = (key: string, value: string) => {
    if (value === '\x00') {
      setPending((p) => { const next = { ...p }; delete next[key]; return next; });
    } else {
      setPending((p) => ({ ...p, [key]: value }));
    }
  };

  const handleSave = async (keys: string[]) => {
    setSaving(true);
    try {
      const settings = Object.fromEntries(keys.map((k) => [k, pending[k]]));
      const r = await fetch('/api/v1/gateway/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const result = (await r.json()) as SaveResult;
      setLastResult(result);
      setPending((p) => { const next = { ...p }; keys.forEach((k) => delete next[k]); return next; });
      void load();
      if (resultTimer.current) clearTimeout(resultTimer.current);
      resultTimer.current = setTimeout(() => setLastResult(null), 6000);
    } finally {
      setSaving(false);
    }
  };

  const entries = data?.entries ?? [];
  const groups = [...new Set(entries.map((e) => e.group))];

  return (
    <div className="space-y-4">
      {/* Status banner */}
      {!loading && data && !data.available && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <Warning size={13} />
          Gateway is offline — showing last saved values. Changes will be applied on next start.
        </div>
      )}

      {/* Save result */}
      {lastResult && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs space-y-0.5">
          {lastResult.applied.length > 0 && (
            <p className="flex items-center gap-1 text-primary">
              <Lightning size={11} />
              Applied live: {lastResult.applied.join(', ')}
            </p>
          )}
          {lastResult.restartRequired.length > 0 && (
            <p className="text-amber-600 dark:text-amber-400">
              Restart required: {lastResult.restartRequired.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Lightning size={10} className="text-primary" /> Applies without restart</span>
        <span className="flex items-center gap-1"><Lock size={10} /> Secret (write-only)</span>
        <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-amber-400 inline-block" /> Unsaved change</span>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading gateway config…</p>
      ) : (
        groups.map((group) => (
          <SettingsGroup
            key={group}
            group={group}
            entries={entries.filter((e) => e.group === group)}
            pending={pending}
            saving={saving}
            onSave={handleSave}
            onChange={handleChange}
          />
        ))
      )}

      {/* Save all dirty */}
      {Object.keys(pending).length > 0 && (
        <div className="flex justify-end">
          <Button disabled={saving} onClick={() => void handleSave(Object.keys(pending))}>
            <FloppyDisk size={13} className="mr-1.5" />
            Save all {Object.keys(pending).length} changes
          </Button>
        </div>
      )}
    </div>
  );
}
