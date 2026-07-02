'use client';

import { Plus, ShieldCheck, Trash } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface KcRole {
  id: string;
  name: string;
  description?: string;
}

const PROTECTED_ROLES = new Set(['admin', 'viewer', 'editor', 'compliance']);

export function RolesList() {
  const [roles, setRoles] = useState<KcRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/access/roles');
      const data = (await res.json()) as { roles?: KcRole[] };
      setRoles(data.roles ?? []);
    } catch {
      toast.error('Failed to load roles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  const addRole = async () => {
    if (!newName.trim()) {
      toast.error('Role name is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/access/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
        }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to create role.');
      toast.success(`Role "${newName.trim()}" created.`);
      setNewName('');
      setNewDesc('');
      setShowAdd(false);
      void fetchRoles();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (role: KcRole) => {
    const isBuiltin = PROTECTED_ROLES.has(role.name);
    const warning = isBuiltin
      ? `"${role.name}" is a built-in role. Removing it may break existing users. Continue?`
      : `Delete role "${role.name}"? Users with this role will lose it.`;

    if (!window.confirm(warning)) return;

    try {
      const res = await fetch(`/api/v1/admin/access/roles/${encodeURIComponent(role.name)}`, {
        method: 'DELETE',
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to delete role.');
      toast.success(`Deleted role "${role.name}".`);
      void fetchRoles();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-primary" />
          Roles
        </CardTitle>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="size-3.5 mr-1" />
          Add role
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              New role
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                placeholder="Role name (required)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addRole()}
                autoFocus
              />
              <Input
                placeholder="Description"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addRole()}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addRole} disabled={saving}>
                {saving ? 'Creating…' : 'Create role'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAdd(false);
                  setNewName('');
                  setNewDesc('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-xs text-muted-foreground">
                      No realm roles defined yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  roles.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {r.name}
                        {PROTECTED_ROLES.has(r.name) && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            built-in
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.description || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void deleteRole(r)}
                          title="Delete role"
                        >
                          <Trash className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
