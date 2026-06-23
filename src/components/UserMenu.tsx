'use client';

import { SignOut as LogOut } from '@phosphor-icons/react/dist/ssr';
import { signOut } from 'next-auth/react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface SessionUser {
  name?: string | null;
  email?: string | null;
  role?: string;
}

export function UserMenu({ user }: { user?: SessionUser }) {
  const { name, email, role } = user ?? {};
  const label = name ?? email ?? 'User';
  const initials = label.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account">
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-[11px] text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="text-sm font-medium text-foreground">{label}</div>
          {email ? <div className="text-xs text-muted-foreground">{email}</div> : null}
          {role ? (
            <div className="mt-1 text-[10px] uppercase tracking-wide text-primary">{role}</div>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/signin' })}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
