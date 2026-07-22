import { CallbacksDashboard } from '@/components/gateway/CallbacksDashboard';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Gateway structured-callbacks place — the live success/failure callback sinks the proxy fans every
// model call to (Langfuse / OTel / S3 / webhook), the per-call record shape being streamed, and the
// team-scoped runtime callback lever. Inherits the Models contextual shell (runtime/models/layout.tsx).
// Honest about what the deployed proxy supports: global callbacks are deploy-owned; team callbacks are
// runtime-settable.
export default async function ModelCallbacksPage() {
  await requireModuleForUser('gateway');
  return <CallbacksDashboard />;
}
