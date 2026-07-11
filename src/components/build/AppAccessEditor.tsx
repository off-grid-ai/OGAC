'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  APP_ACTIONS,
  type AppAccessPolicy,
  type AppAction,
} from '@/lib/app-access-policy';

// ─── AppAccessEditor — the per-app ACCESS POLICY management surface ────────────────────────────────
//
// Full-width management UI (not a read-only view) for a consumer's access control. It edits, per
// action (run · view · edit · approve · trigger): the allowed ROLES and DEPARTMENTS (comma-separated),
// then the HITL APPROVAL AUTHORITY (approver roles/users + an optional numeric threshold on an
// attribute). Save PUTs the whole policy; Reset to default DELETEs it (reverting to owner + admins).
//
// The pure decision + validation live in app-access-policy.ts; this component only shapes the form
// and calls the admin route — no policy logic is duplicated here.

const ACTION_HINT: Record<AppAction, string> = {
  run: 'Execute this consumer',
  view: 'See its detail, runs, and reports',
  edit: 'Change its steps and this policy',
  approve: 'Satisfy a human-in-the-loop approval',
  trigger: 'Fire it via a webhook or schedule',
};

function csv(list: string[] | undefined): string {
  return (list ?? []).join(', ');
}
function parseCsv(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

type ActionForm = { roles: string; departments: string; attributes: string };

export function AppAccessEditor({
  appId,
  ownerId,
  initialPolicy,
  isDefault,
}: Readonly<{
  appId: string;
  ownerId: string;
  initialPolicy: AppAccessPolicy;
  isDefault: boolean;
}>) {
  const [forms, setForms] = React.useState<Record<AppAction, ActionForm>>(() => {
    const out = {} as Record<AppAction, ActionForm>;
    for (const a of APP_ACTIONS) {
      const rule = initialPolicy.actions[a];
      out[a] = {
        roles: csv(rule?.roles),
        departments: csv(rule?.departments),
        attributes: (rule?.attributes ?? [])
          .map((p) => `${p.attribute} ${p.operator} ${p.value}`)
          .join('\n'),
      };
    }
    return out;
  });

  const [approverRoles, setApproverRoles] = React.useState(csv(initialPolicy.approval?.approverRoles));
  const [approverUsers, setApproverUsers] = React.useState(csv(initialPolicy.approval?.approverUsers));
  const [thresholdAttribute, setThresholdAttribute] = React.useState(
    initialPolicy.approval?.thresholdAttribute ?? '',
  );
  const [maxThreshold, setMaxThreshold] = React.useState(
    initialPolicy.approval?.maxThreshold !== undefined ? String(initialPolicy.approval.maxThreshold) : '',
  );
  const [saving, setSaving] = React.useState(false);
  const [cleared, setCleared] = React.useState(isDefault);

  function setForm(a: AppAction, patch: Partial<ActionForm>) {
    setForms((f) => ({ ...f, [a]: { ...f[a], ...patch } }));
  }

  // Parse the free-text attribute lines ("attr op value" per line) into predicates. Invalid lines are
  // dropped client-side; the server re-validates authoritatively.
  function parseAttributes(text: string) {
    const out: { attribute: string; operator: string; value: string }[] = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/\s+/);
      if (parts.length < 3) continue;
      const [attribute, operator, ...rest] = parts;
      out.push({ attribute, operator, value: rest.join(' ') });
    }
    return out;
  }

  function buildBody() {
    const actions: Record<string, unknown> = {};
    for (const a of APP_ACTIONS) {
      const f = forms[a];
      const roles = parseCsv(f.roles);
      const departments = parseCsv(f.departments);
      const attributes = parseAttributes(f.attributes);
      if (roles.length || departments.length || attributes.length) {
        actions[a] = { roles, departments, attributes };
      }
    }
    const approval: Record<string, unknown> = {};
    const ar = parseCsv(approverRoles);
    const au = parseCsv(approverUsers);
    if (ar.length) approval.approverRoles = ar;
    if (au.length) approval.approverUsers = au;
    if (thresholdAttribute.trim()) approval.thresholdAttribute = thresholdAttribute.trim();
    if (maxThreshold.trim() !== '') approval.maxThreshold = Number(maxThreshold);
    return { actions, approval: Object.keys(approval).length ? approval : undefined };
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/access`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setCleared(false);
      toast.success('Access policy saved');
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function resetDefault() {
    if (!confirm('Clear this policy? Access reverts to the owner and admins only.')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/access`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForms(() => {
        const out = {} as Record<AppAction, ActionForm>;
        for (const a of APP_ACTIONS) out[a] = { roles: '', departments: '', attributes: '' };
        return out;
      });
      setApproverRoles('');
      setApproverUsers('');
      setThresholdAttribute('');
      setMaxThreshold('');
      setCleared(true);
      toast.success('Reverted to least-privilege default');
    } catch (e) {
      toast.error(`Reset failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Access control</h2>
          <p className="text-sm text-muted-foreground">
            Who may act on this consumer, and under what conditions. Owner{' '}
            <span className="font-mono text-xs">{ownerId || '—'}</span> and admins always have full
            access.
            {cleared ? ' No policy bound — least-privilege default (owner + admins only) is in effect.' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={resetDefault} disabled={saving}>
            Reset to default
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save policy'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {APP_ACTIONS.map((a) => (
          <Card key={a}>
            <CardHeader>
              <CardTitle className="capitalize">{a}</CardTitle>
              <CardDescription>{ACTION_HINT[a]}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`${a}-roles`}>Allowed roles</Label>
                <Input
                  id={`${a}-roles`}
                  placeholder="admin, manager, analyst  (or *)"
                  value={forms[a].roles}
                  onChange={(e) => setForm(a, { roles: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${a}-depts`}>Allowed departments</Label>
                <Input
                  id={`${a}-depts`}
                  placeholder="Finance, Risk"
                  value={forms[a].departments}
                  onChange={(e) => setForm(a, { departments: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${a}-attrs`}>Attribute constraints</Label>
                <textarea
                  id={`${a}-attrs`}
                  className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-sm"
                  placeholder={'one per line, e.g.\namount lte 50000\nregion eq IN'}
                  value={forms[a].attributes}
                  onChange={(e) => setForm(a, { attributes: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Format: <span className="font-mono">attribute operator value</span> — ops:
                  eq/neq/in/contains/gt/gte/lt/lte
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approval authority (human-in-the-loop)</CardTitle>
          <CardDescription>
            Who may satisfy a HITL approval on this consumer&apos;s runs, and up to what limit. An
            approver lacking authority is rejected even if they can otherwise approve.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="approver-roles">Approver roles</Label>
            <Input
              id="approver-roles"
              placeholder="manager, admin"
              value={approverRoles}
              onChange={(e) => setApproverRoles(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="approver-users">Approver users</Label>
            <Input
              id="approver-users"
              placeholder="cfo@corp.in"
              value={approverUsers}
              onChange={(e) => setApproverUsers(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="threshold-attr">Threshold attribute</Label>
            <Input
              id="threshold-attr"
              placeholder="amount"
              value={thresholdAttribute}
              onChange={(e) => setThresholdAttribute(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="max-threshold">Max threshold</Label>
            <Input
              id="max-threshold"
              type="number"
              placeholder="50000"
              value={maxThreshold}
              onChange={(e) => setMaxThreshold(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
