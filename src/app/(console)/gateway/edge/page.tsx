import { EdgePanel } from '@/components/edge/EdgePanel';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Edge — the WAF + rate-limit control surface for the Caddy edge that fronts the
// public hostnames. Live policy + recent blocks, read from Caddy on the same host.
export default async function EdgePage() {
  await requireModuleForUser('edge');
  return <EdgePanel />;
}
