'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MachineClientsList } from '@/components/access/MachineClientsList';
import { RolesList } from '@/components/access/RolesList';
import { UsersList } from '@/components/access/UsersList';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = ['users', 'clients', 'roles'] as const;
type TabValue = (typeof TABS)[number];

export function AccessTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get('tab') as TabValue) ?? 'users';
  const active = TABS.includes(current) ? current : 'users';

  const onChange = (value: string): void => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={active} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="clients">Machine Clients</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
      </TabsList>
      <TabsContent value="users" className="space-y-4">
        <UsersList />
      </TabsContent>
      <TabsContent value="clients" className="space-y-4">
        <MachineClientsList />
      </TabsContent>
      <TabsContent value="roles" className="space-y-4">
        <RolesList />
      </TabsContent>
    </Tabs>
  );
}
