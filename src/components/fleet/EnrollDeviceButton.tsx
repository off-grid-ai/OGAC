'use client';

import { Copy, Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function EnrollDeviceButton() {
  const [role, setRole] = useState('Field Advisor');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <Dialog
      onOpenChange={(open) => {
        if (!open) setToken(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Enroll device
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enroll a device</DialogTitle>
          <DialogDescription>
            Issue a one-time token for a role. A node uses it once to register itself.
          </DialogDescription>
        </DialogHeader>
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
          <Button onClick={issue} disabled={loading} className="w-full">
            {loading ? 'Issuing…' : 'Issue token'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
