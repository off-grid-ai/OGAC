'use client';

import { Copy, Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// The enroll panel's open/closed state lives in the URL (?panel=enroll-device) so Back closes it
// and it's deep-linkable — never in local useState.
export function EnrollDeviceButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'enroll-device';

  const [role, setRole] = useState('Field Advisor');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  // Reset the form (and clear any one-time token) each time the panel opens.
  useEffect(() => {
    if (open) {
      setRole('Field Advisor');
      setToken(null);
    }
  }, [open]);

  async function issue() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/enroll-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setToken(data.token as string);
      toast.success('Enrollment token issued');
    } catch {
      toast.error('Failed to issue token');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setPanel('enroll-device')}>
        <Plus className="size-4" />
        Enroll device
      </Button>
      <FormSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Enroll a device"
        description="Issue a one-time token for a role. A node uses it once to register itself."
        footer={
          <Button onClick={issue} disabled={loading} className="w-full">
            {loading ? 'Issuing…' : 'Issue token'}
          </Button>
        }
      >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <Input id="role" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
            {token ? (
              <div className="space-y-1.5">
                <Label>Token (one-time)</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border border-border bg-muted px-2 py-1.5 text-xs">
                    {token}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copy token"
                    onClick={() => {
                      void navigator.clipboard.writeText(token);
                      toast.success('Copied');
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
      </FormSheet>
    </>
  );
}
