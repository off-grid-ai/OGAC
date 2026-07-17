import { Envelope } from '@phosphor-icons/react/dist/ssr';
import { MessagingManager } from '@/components/messaging/MessagingManager';
import { requireModuleForUser } from '@/lib/module-access';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

export default async function MessagingPage() {
  await requireModuleForUser('config');
  return (
    <PageFrame>
      {
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Envelope className="size-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Email &amp; messaging</h1>
              <p className="text-sm text-muted-foreground">
                Send app results by email (governed: PII-masked + egress-leashed), verify your own
                sending domain, and give each app a forward-to inbound address. Your DNS stays
                yours.
              </p>
            </div>
          </div>
          <MessagingManager />
        </div>
      }
    </PageFrame>
  );
}
