'use client';

import { ArrowClockwise, EnvelopeSimple, Plus, Prohibit, Trash } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const ORG_ROLES = ['viewer', 'compliance', 'admin'] as const;
const APP_ROLES = ['viewer', 'runner', 'approver', 'editor'] as const;

interface InviteAppGrant {
  appId: string;
  appRole: string;
}

interface Invite {
  id: string;
  email: string;
  invitedBy: string;
  role: string;
  appGrants: InviteAppGrant[];
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string | null;
  createdAt: string | null;
  acceptedAt: string | null;
}

const STATUS_VARIANT: Record<Invite['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'default',
  accepted: 'secondary',
  revoked: 'destructive',
  expired: 'outline',
};

// ─── Invite form (FormSheet) ────────────────────────────────────────────────────────────────────────
function InviteForm({ open, onOpenChange, onDone }: Readonly<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}>) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('viewer');
  const [appId, setAppId] = useState('');
  const [appRole, setAppRole] = useState<string>('viewer');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setEmail('');
    setRole('viewer');
    setAppId('');
    setAppRole('viewer');
  };

  const submit = async () => {
    if (!email.trim()) {
      toast.error('An email address is required.');
      return;
    }
    setSaving(true);
    try {
      const appGrants = appId.trim() ? [{ appId: appId.trim(), appRole }] : [];
      const res = await fetch('/api/v1/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role, appGrants }),
      });
      const data = (await res.json()) as { error?: string; emailed?: boolean; emailReason?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create the invitation.');
      if (data.emailed) toast.success(`Invitation sent to ${email.trim()}.`);
      else toast.warning(`Invitation created, but the email was not sent: ${data.emailReason ?? 'email not configured'}.`);
      reset();
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a person"
      description="Send an email invitation. They'll set up their account and land with the access you choose here."
      footer={
        <Button className="w-full gap-1.5" onClick={() => void submit()} disabled={saving}>
          {saving ? (
            <>
              <Spinner /> Sending…
            </>
          ) : (
            <>
              <EnvelopeSimple className="size-4" /> Send invitation
            </>
          )}
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email address</Label>
          <Input
            id="invite-email"
            type="email"
            placeholder="person@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Console role</Label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            What they can do across the console. Viewer is read-only; admin manages everything.
          </p>
        </div>

        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
          <Label htmlFor="invite-app">Grant access to an app (optional)</Label>
          <Input
            id="invite-app"
            placeholder="App ID (leave blank for none)"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
          />
          {appId.trim() && (
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="invite-app-role" className="text-xs">App role</Label>
              <select
                id="invite-app-role"
                value={appRole}
                onChange={(e) => setAppRole(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {APP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            They&apos;ll land already able to use this app at the chosen level.
          </p>
        </div>
      </div>
    </FormSheet>
  );
}

// ─── Main list ────────────────────────────────────────────────────────────────────────────────────
export function InvitesList() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetchInvites = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await fetch('/api/v1/admin/invites');
      const data = (await res.json()) as { data?: Invite[]; error?: string };
      if (!res.ok) {
        setApiError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setInvites(data.data ?? []);
    } catch {
      setApiError('Failed to reach the invites API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInvites();
  }, [fetchInvites]);

  const patch = async (id: string, action: 'revoke' | 'resend') => {
    try {
      const res = await fetch(`/api/v1/admin/invites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = (await res.json()) as { error?: string; emailed?: boolean };
      if (!res.ok) throw new Error(d.error ?? `Failed to ${action} the invitation.`);
      toast.success(action === 'revoke' ? 'Invitation revoked.' : 'A fresh invitation was sent.');
      void fetchInvites();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async (invite: Invite) => {
    if (!window.confirm(`Delete the invitation for ${invite.email}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/v1/admin/invites/${invite.id}`, { method: 'DELETE' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to delete the invitation.');
      toast.success('Invitation deleted.');
      void fetchInvites();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <EnvelopeSimple className="size-4 text-primary" />
          Invitations
        </CardTitle>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="size-3.5 mr-1" />
          Invite a person
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Invite people by email. They accept, set up their account, and land with the console role and
          app access you choose — no shared passwords, no admin tokens.
        </p>

        {apiError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            <span className="font-medium">Error:</span> {apiError}
          </div>
        )}

        {loading ? (
          <LoadingBlock />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>App access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                      No invitations yet. Invite your first person to get them onto the platform.
                    </TableCell>
                  </TableRow>
                ) : (
                  invites.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs text-foreground">{inv.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {inv.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inv.appGrants.length === 0
                          ? '—'
                          : inv.appGrants.map((g) => `${g.appId} (${g.appRole})`).join(', ')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[inv.status]} className="text-xs">
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {inv.status === 'pending' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void patch(inv.id, 'resend')}
                                title="Resend invitation"
                              >
                                <ArrowClockwise className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void patch(inv.id, 'revoke')}
                                title="Revoke invitation"
                              >
                                <Prohibit className="size-3.5" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void remove(inv)}
                            title="Delete invitation"
                          >
                            <Trash className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <InviteForm open={showForm} onOpenChange={setShowForm} onDone={fetchInvites} />
    </Card>
  );
}
