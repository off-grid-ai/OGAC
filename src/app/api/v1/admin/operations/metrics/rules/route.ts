import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { rulesAndAlerts } from '@/lib/adapters/victoriametrics';
import {
  normalizeAlerts,
  normalizeRules,
  partitionRules,
  summarizeAlerts,
} from '@/lib/victoriametrics-query';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/operations/metrics/rules → recording + alerting RULES and currently-firing
// ALERTS from VM's rule engine. HONESTY: a plain VM single-node has no vmalert, so these endpoints
// are absent — we report engineDeployed:false and the UI shows an honest "no alerting engine" state.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const result = await rulesAndAlerts();
  if (!result.configured) {
    return NextResponse.json({ configured: false, engineDeployed: false });
  }
  if (!result.engineDeployed) {
    return NextResponse.json({
      configured: true,
      engineDeployed: false,
      error: result.error,
      recording: [],
      alerting: [],
      alerts: [],
      summary: { firing: 0, pending: 0, total: 0 },
    });
  }
  const { recording, alerting } = partitionRules(normalizeRules(result.rules));
  const alerts = normalizeAlerts(result.alerts);
  return NextResponse.json({
    configured: true,
    engineDeployed: true,
    recording,
    alerting,
    alerts,
    summary: summarizeAlerts(alerts),
  });
}
