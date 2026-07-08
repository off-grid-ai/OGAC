'use client';

import { ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// Reassign a device's policy ROLE — the per-device dimension that selects which policy/routing
// bundle applies. URL-driven panel (?panel=reassign-policy) so Back closes it and it's deep-linkable
// — never local-only state (nav rule). Admin-gated route (PATCH /admin/devices/[id]/role), audited.
export function ReassignPolicyButton({
  deviceId,
  name,
  currentRole,
  knownRoles = [],
}: {
  deviceId: string;
  name: string;
  currentRole: string;
  /** Distinct roles already in the fleet, offered as quick-picks. */
  knownRoles?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'reassign-policy';

  const [role, setRole] = useState(currentRole);
  const [loading, setLoading] = useState(false);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (open) setRole(currentRole);
  }, [open, currentRole]);

  const suggestions = [...new Set(knownRoles)].filter((r) => r && r !== role);

  async function save() {
    const next = role.trim();
    if (next.length < 2) {
      toast.error('Role must be at least 2 characters');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/devices/${deviceId}/role`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to reassign policy');
        return;
      }
      toast.success(`${name} reassigned to "${next}"`);
      setPanel(null);
      router.refresh();
    } catch {
      toast.error('Failed to reassign policy');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setPanel('reassign-policy')}>
        <ShieldCheck className="size-4" />
        Reassign policy
      </Button>
      <FormSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Reassign policy"
        description={`Change the policy role for "${name}". The role selects which routing rules and policy bundle this device pulls on its next check-in.`}
        footer={
          <Button onClick={save} disabled={loading} className="w-full">
            {loading ? 'Reassigning…' : 'Reassign policy'}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reassign-role">Policy role</Label>
            <Input
              id="reassign-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Underwriter"
            />
            <p className="text-xs text-muted-foreground">
              Currently <span className="font-medium text-foreground">{currentRole}</span>.
            </p>
          </div>
          {suggestions.length ? (
            <div className="space-y-1.5">
              <Label>Existing roles</Label>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </FormSheet>
    </>
  );
}
