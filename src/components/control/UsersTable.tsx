'use client';

import { CaretDown as ChevronDown } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RBAC_ROLES } from '@/lib/roles';
import type { ConsoleUser } from '@/lib/store';

export function UsersTable({ users }: { users: ConsoleUser[] }) {
  const router = useRouter();

  async function setRole(id: string, role: string) {
    const res = await fetch(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      toast.success(`Role updated to ${role}`);
      router.refresh();
    } else {
      toast.error('Failed to update role');
    }
  }

  if (users.length === 0) {
    return (
      <p className="px-1 py-2 text-sm text-muted-foreground">
        No users yet — they appear here after their first SSO sign-in.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="text-right">Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell className="font-medium text-foreground">{u.name ?? '—'}</TableCell>
            <TableCell className="text-muted-foreground">{u.email ?? '—'}</TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      {u.role}
                    </Badge>
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {RBAC_ROLES.map((r) => (
                    <DropdownMenuItem key={r} onClick={() => setRole(u.id, r)}>
                      {r}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
