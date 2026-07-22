import { MetricsAlerts } from '@/components/operations/MetricsAlerts';
import { MetricsSubnav } from '@/components/operations/MetricsSubnav';
import { rulesAndAlerts } from '@/lib/adapters/victoriametrics';
import { requireModuleForUser } from '@/lib/module-access';
import {
  normalizeAlerts,
  normalizeRules,
  partitionRules,
  summarizeAlerts,
} from '@/lib/victoriametrics-query';

export const dynamic = 'force-dynamic';

// Alerts view — recording + alerting RULES and currently-firing ALERTS from VM's rule engine.
// HONESTY: a plain VM single-node has no vmalert, so /api/v1/rules + /api/v1/alerts are absent — we
// render an explicit "no alerting engine deployed" state rather than invent rules the service can't
// back. The read happens server-side through the adapter; shaping is the pure normalizers.
export default async function MetricsAlertsPage() {
  await requireModuleForUser('platform-health');
  const result = await rulesAndAlerts();
  const { recording, alerting } = result.engineDeployed
    ? partitionRules(normalizeRules(result.rules))
    : { recording: [], alerting: [] };
  const alerts = result.engineDeployed ? normalizeAlerts(result.alerts) : [];
  return (
    <div className="w-full space-y-4">
      <MetricsSubnav active="alerts" />
      <MetricsAlerts
        configured={result.configured}
        engineDeployed={result.engineDeployed}
        engineError={result.error}
        recording={recording}
        alerting={alerting}
        alerts={alerts}
        summary={summarizeAlerts(alerts)}
      />
    </div>
  );
}
