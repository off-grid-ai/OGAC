'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { GatewayControl } from '@/components/gateway/GatewayControl';
import { GatewayFleetConfig } from '@/components/gateway/GatewayFleetConfig';
import { GatewayLogs } from '@/components/gateway/GatewayLogs';
import { ConfigManager } from '@/components/config/ConfigManager';
import { GatewayTokens } from '@/components/gateway/GatewayTokens';
import { GatewayTraffic } from '@/components/gateway/GatewayTraffic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = ['overview', 'traffic', 'logs', 'control', 'tokens', 'settings'] as const;
type TabValue = (typeof TABS)[number];

// The gateway page's tabs, with the active tab reflected in the `?tab=` query string
// (shareable, bookmarkable, survives refresh). Overview content is server-rendered and
// passed in as a prop; the other tabs are live client components.
export function GatewayTabs({ overview }: { overview: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get('tab') as TabValue) ?? 'overview';
  const active = TABS.includes(current) ? current : 'overview';

  const onChange = (value: string): void => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={active} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="traffic">Traffic</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="control">Control</TabsTrigger>
        <TabsTrigger value="tokens">Tokens</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-6">
        {overview}
      </TabsContent>
      <TabsContent value="traffic" className="space-y-6">
        <GatewayTraffic />
      </TabsContent>
      <TabsContent value="logs">
        <GatewayLogs />
      </TabsContent>
      <TabsContent value="control" className="space-y-6">
        <GatewayFleetConfig />
        <GatewayControl />
      </TabsContent>
      <TabsContent value="tokens" className="space-y-6">
        <GatewayTokens />
      </TabsContent>
      <TabsContent value="settings" className="space-y-4">
        <ConfigManager only={['AI Gateway']} />
      </TabsContent>
    </Tabs>
  );
}
