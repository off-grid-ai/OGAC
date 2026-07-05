'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

export interface PickableUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

// A small debounced user search + list, used by the Sessions and MFA tabs to choose whose
// sessions/MFA to manage. Selection is lifted to the parent (which drives it from ?user= in the URL).
export function UserPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (u: PickableUser) => void;
}) {
  const [users, setUsers] = useState<PickableUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUsers = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const url = new URL('/api/v1/admin/access/users', window.location.origin);
      if (q) url.searchParams.set('search', q);
      url.searchParams.set('max', '20');
      const res = await fetch(url.toString());
      const data = (await res.json()) as { users?: PickableUser[] };
      setUsers(data.users ?? []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const onSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(val), 400);
  };

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search users…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="max-w-xs"
      />
      {loading ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">No users found.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {users.map((u) => {
            const on = u.id === selectedId;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onSelect(u)}
                className={`rounded border px-2 py-1 text-xs font-mono transition-colors ${
                  on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/60'
                }`}
              >
                {u.email ?? u.username}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
