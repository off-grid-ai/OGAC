'use client';

import { Pencil, Plus, ShieldCheck, Trash, Warning } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { type EdgeIntent, type WafRule, diffIntent } from '@/lib/edge-intent';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// WAF control surface for the edge page: turn the WAF on/off and create / edit / delete custom
// rules. The console cannot reload Caddy safely from inside the app, so every change is persisted
// as INTENT and honestly labelled "pending — applies on next edge reload" until the live edge
// (parsed from the Caddyfile) matches. Admin-gated write routes under /api/v1/admin/edge/waf.
//
// The edit panel's open state lives in the URL (?panel=waf-rule[&rule=<id>]) per the nav rule.
export function WafControls({
  liveWafEnabled,
  liveRuleNames,
}: Readonly<{
  liveWafEnabled: boolean;
  liveRuleNames: string[];
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'waf-rule';
  const editId = params.get('rule');

  const [intent, setIntent] = useState<EdgeIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/admin/edge/waf', { cache: 'no-store' });
      if (r.ok) setIntent((await r.json()) as EdgeIntent);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Hydrate the edit form when the panel opens for an existing rule.
  useEffect(() => {
    if (!open) return;
    const rule = intent?.rules.find((r) => r.id === editId);
    setName(rule?.name ?? '');
    setPattern(rule?.pattern ?? '');
    setEnabled(rule?.enabled ?? true);
  }, [open, editId, intent]);

  const setPanel = useCallback(
    (panel: string | null, ruleId?: string) => {
      const qs = withPanelParams(params.toString(), {
        panel,
        rule: panel ? (ruleId ?? null) : null,
      });
      router.push(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const diff = intent ? diffIntent(intent, { wafEnabled: liveWafEnabled, liveRuleNames }) : null;

  async function toggleWaf(next: boolean) {
    if (!intent) return;
    setBusy(true);
    const prev = intent;
    setIntent({ ...intent, wafEnabled: next }); // optimistic
    try {
      const r = await fetch('/api/v1/admin/edge/waf', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) throw new Error();
      setIntent((await r.json()) as EdgeIntent);
      toast.success(`WAF ${next ? 'enabled' : 'disabled'} — applies on next edge reload`);
    } catch {
      setIntent(prev);
      toast.error('Failed to update WAF');
    } finally {
      setBusy(false);
    }
  }

  async function saveRule() {
    if (name.trim().length < 2 || pattern.trim().length < 1) {
      toast.error('Name and pattern are required');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/v1/admin/edge/waf/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: editId || undefined,
          name: name.trim(),
          pattern: pattern.trim(),
          enabled,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string; intent?: EdgeIntent };
      if (!r.ok) {
        toast.error(data.error ?? 'Failed to save rule');
        return;
      }
      if (data.intent) setIntent(data.intent);
      toast.success('Rule saved — applies on next edge reload');
      setPanel(null);
    } catch {
      toast.error('Failed to save rule');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(rule: WafRule) {
    if (!window.confirm(`Delete WAF rule "${rule.name}"?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/admin/edge/waf/rules/${encodeURIComponent(rule.id)}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error();
      setIntent((await r.json()) as EdgeIntent);
      toast.success('Rule deleted — applies on next edge reload');
    } catch {
      toast.error('Failed to delete rule');
    } finally {
      setBusy(false);
    }
  }

  // Save-button label: mid-save, editing an existing rule, or adding a new one.
  let saveRuleLabel: string;
  if (busy) saveRuleLabel = 'Saving…';
  else saveRuleLabel = editId ? 'Save rule' : 'Add rule';

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <span className="text-sm font-medium text-foreground">WAF control</span>
          {diff && !diff.inSync ? (
            <Badge variant="outline" className="gap-1 text-[10px] text-amber-600">
              <Warning className="size-3" /> pending — applies on next edge reload
            </Badge>
          ) : intent ? (
            <Badge variant="secondary" className="bg-primary/10 text-[10px] text-primary">
              in sync
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="waf-toggle" className="text-xs text-muted-foreground">
              WAF
            </Label>
            <Switch
              id="waf-toggle"
              checked={intent?.wafEnabled ?? false}
              disabled={!intent || busy}
              onCheckedChange={(v) => void toggleWaf(v)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!intent}
            onClick={() => setPanel('waf-rule')}
          >
            <Plus className="size-4" /> Add rule
          </Button>
        </div>
      </div>

      <div className="px-4 py-3">
        {!intent ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading WAF intent…</p>
        ) : intent.rules.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No custom rules. The baseline Caddy ruleset still applies. Add a rule to layer on your
            own.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {intent.rules.map((rule) => {
              const live = liveRuleNames.includes(rule.name);
              return (
                <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-foreground">{rule.name}</span>
                      {!rule.enabled && (
                        <Badge variant="outline" className="text-[10px]">
                          disabled
                        </Badge>
                      )}
                      {rule.enabled && !live && (
                        <Badge variant="outline" className="text-[10px] text-amber-600">
                          pending
                        </Badge>
                      )}
                      {rule.enabled && live && (
                        <Badge
                          variant="secondary"
                          className="bg-primary/10 text-[10px] text-primary"
                        >
                          live
                        </Badge>
                      )}
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {rule.pattern}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit rule"
                      onClick={() => setPanel('waf-rule', rule.id)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete rule"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => void deleteRule(rule)}
                    >
                      <Trash className="size-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <FormSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        title={editId ? 'Edit WAF rule' : 'Add WAF rule'}
        description="A custom rule layered on the baseline Caddy WAF. Persisted as intent — it applies on the next edge reload."
        footer={
          <Button onClick={saveRule} disabled={busy} className="w-full">
            {saveRuleLabel}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="waf-name">Name</Label>
            <Input
              id="waf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Block admin scanners"
            />
            <p className="text-xs text-muted-foreground">
              Shown as the block reason in the edge log.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="waf-pattern">Pattern</Label>
            <Input
              id="waf-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. path starts with /wp-admin"
            />
            <p className="text-xs text-muted-foreground">
              What the rule matches (path / user-agent / etc.).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="waf-rule-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="waf-rule-enabled" className="text-sm">
              Armed
            </Label>
          </div>
        </div>
      </FormSheet>
    </div>
  );
}
