'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IdpList } from '@/components/access/IdpList';
import { MachineClientsList } from '@/components/access/MachineClientsList';
import { MfaPanel } from '@/components/access/MfaPanel';
import { RealmLifetimes } from '@/components/access/RealmLifetimes';
import { RolesList } from '@/components/access/RolesList';
import { SessionsPanel } from '@/components/access/SessionsPanel';
import { TeamsDepartments } from '@/components/access/TeamsDepartments';
import { UsersList } from '@/components/access/UsersList';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = ['users', 'teams', 'clients', 'roles', 'sessions', 'mfa', 'idp', 'realm'] as const;
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
        <TabsTrigger value="teams">Teams &amp; Departments</TabsTrigger>
        <TabsTrigger value="clients">Machine Clients</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
        <TabsTrigger value="sessions">Sessions</TabsTrigger>
        <TabsTrigger value="mfa">MFA</TabsTrigger>
        <TabsTrigger value="idp">Federation</TabsTrigger>
        <TabsTrigger value="realm">Realm</TabsTrigger>
      </TabsList>
      <TabsContent value="users" className="space-y-4">
        <UsersList />
      </TabsContent>
      <TabsContent value="teams" className="space-y-4">
        <TeamsDepartments />
      </TabsContent>
      <TabsContent value="clients" className="space-y-4">
        <MachineClientsList />
      </TabsContent>
      <TabsContent value="roles" className="space-y-4">
        <RolesList />
      </TabsContent>
      <TabsContent value="sessions" className="space-y-4">
        <SessionsPanel />
      </TabsContent>
      <TabsContent value="mfa" className="space-y-4">
        <MfaPanel />
      </TabsContent>
      <TabsContent value="idp" className="space-y-4">
        <IdpList />
      </TabsContent>
      <TabsContent value="realm" className="space-y-4">
        <RealmLifetimes />
      </TabsContent>
    </Tabs>
  );
}
