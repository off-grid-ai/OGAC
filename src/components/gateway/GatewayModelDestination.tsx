import { GatewayControl } from '@/components/gateway/GatewayControl';
import { GatewayFleetConfig } from '@/components/gateway/GatewayFleetConfig';
import { GatewayLogs } from '@/components/gateway/GatewayLogs';
import { GatewayOverview } from '@/components/gateway/GatewayOverview';
import { GatewayProviderPool } from '@/components/gateway/GatewayProviderPool';
import { GatewayProviders } from '@/components/gateway/GatewayProviders';
import { GatewayRouter } from '@/components/gateway/GatewayRouter';
import { GatewayVirtualKeys } from '@/components/gateway/GatewayVirtualKeys';
import { GatewayTraffic } from '@/components/gateway/GatewayTraffic';
import { GatewayTuning } from '@/components/gateway/GatewayTuning';

/** Compose one route-owned Models place without recreating a second navigation system. */
export function GatewayModelDestination({ destination }: Readonly<{ destination: string }>) {
  if (destination === 'overview') return <GatewayOverview />;
  if (destination === 'routing') {
    return (
      <>
        <GatewayRouter />
        <GatewayProviderPool />
        <GatewayVirtualKeys />
      </>
    );
  }
  if (destination === 'traffic') return <GatewayTraffic />;
  if (destination === 'logs') return <GatewayLogs />;
  if (destination === 'fleet-control') {
    return (
      <div className="space-y-6">
        <GatewayFleetConfig />
        <GatewayControl />
      </div>
    );
  }
  if (destination === 'providers') return <GatewayProviders />;
  if (destination === 'tuning') return <GatewayTuning />;
  return null;
}
