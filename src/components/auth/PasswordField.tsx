'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

// Password input with a reveal toggle. Client component so it can flip the input
// type; the `name="password"` value still submits with the server-action form.
export function PasswordField() {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        name="password"
        type={show ? 'text' : 'password'}
        placeholder="Password"
        autoComplete="current-password"
        required
        className="pr-9 font-mono text-sm"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-2 flex items-center text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
