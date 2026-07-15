'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { ConfigManager } from '@/components/config/ConfigManager';
import { GatewayApiKeys } from '@/components/gateway/GatewayApiKeys';
import { GatewayControl } from '@/components/gateway/GatewayControl';
import { GatewayFleetConfig } from '@/components/gateway/GatewayFleetConfig';
import { GatewayLogs } from '@/components/gateway/GatewayLogs';
import { GatewayProviders } from '@/components/gateway/GatewayProviders';
import { GatewayRouter } from '@/components/gateway/GatewayRouter';
import { GatewayTokens } from '@/components/gateway/GatewayTokens';
import { GatewayTraffic } from '@/components/gateway/GatewayTraffic';
import { GatewayTuning } from '@/components/gateway/GatewayTuning';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = ['overview', 'router', 'traffic', 'logs', 'control', 'providers', 'tuning', 'keys', 'tokens', 'settings'] as const;
type TabValue = (typeof TABS)[number];

// The gateway page's tabs, with the active tab reflected in the `?tab=` query string
// (shareable, bookmarkable, survives refresh). Overview content is server-rendered and
// passed in as a prop; the other tabs are live client components.
export function GatewayTabs({ overview }: Readonly<{ overview: ReactNode }>) {
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = (params.get('tab') as TabValue) ?? 'overview';
  // Local state drives the active tab so switching is INSTANT. router.replace() would
  // re-navigate this force-dynamic route, re-running the aggregator's live all-nodes health
  // probe (fans out to every node, up to 8s) on EVERY tab click. Reflect the tab in the URL
  // via the History API instead — deep-linkable/bookmarkable, but zero server round-trip.
  const [active, setActive] = useState<TabValue>(TABS.includes(initial) ? initial : 'overview');

  const onChange = (value: string): void => {
    const next = value as TabValue;
    setActive(next);
    const qs = new URLSearchParams(window.location.search);
    qs.set('tab', next);
    window.history.replaceState(null, '', `${pathname}?${qs.toString()}`);
  };

  return (
    <Tabs value={active} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="router">Router</TabsTrigger>
        <TabsTrigger value="traffic">Traffic</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="control">Control</TabsTrigger>
        <TabsTrigger value="providers">Cloud providers</TabsTrigger>
        <TabsTrigger value="tuning">Tuning</TabsTrigger>
        <TabsTrigger value="keys">API keys</TabsTrigger>
        <TabsTrigger value="tokens">Tokens</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-6">
        {overview}
      </TabsContent>
      <TabsContent value="router" className="space-y-4">
        <GatewayRouter />
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
      <TabsContent value="providers" className="space-y-4">
        <GatewayProviders />
      </TabsContent>
      <TabsContent value="tuning" className="space-y-4">
        <GatewayTuning />
      </TabsContent>
      <TabsContent value="keys" className="space-y-6">
        <GatewayApiKeys />
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
