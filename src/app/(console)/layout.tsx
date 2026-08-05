import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { ConsoleContent } from '@/components/ConsoleContent';
import { GlobalSearch } from '@/components/GlobalSearch';
import { Hellobar } from '@/components/Hellobar';
import { MobileGate } from '@/components/MobileGate';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ViewerModeProvider } from '@/components/ViewerModeProvider';
import { ViewerWriteInterceptor } from '@/components/ViewerWriteInterceptor';
import { readDemoBanner } from '@/lib/demo-hellobar';
import { tenantSlugFromHost } from '@/lib/route-access';
import { currentTenantSlug } from '@/lib/tenancy';

export default async function ConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await auth();
  // Read-only-demo hellobar: shows only for a viewer session, with THIS tenant's demo creds. Resolve
  // the tenant from the SIGNED-IN org first (stable across a client RSC navigation, which renders this
  // shared layout in a host-ambiguous context and otherwise flapped to the generic demo-bank@ pair);
  // fall back to the host slug for a session whose org has no tenant row.
  const slug = (await currentTenantSlug()) ?? tenantSlugFromHost((await headers()).get('host'));
  const banner = readDemoBanner(session?.user?.role, slug);
  return (
    <ViewerModeProvider role={session?.user?.role}>
      <TooltipProvider>
        <div className="flex h-screen flex-col bg-background text-foreground">
          <Hellobar model={banner} />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Topbar user={session?.user} />
              <ConsoleContent>{children}</ConsoleContent>
            </div>
          </div>
        </div>
        <GlobalSearch />
        <Toaster />
        {/* Mounted below <Toaster/> because it reports through it. For a read-only viewer this stops a
            write in the browser and explains it once, instead of letting ~216 armed controls each fail
            with their own generic message. Enforcement stays server-side; this is affordance only. */}
        <ViewerWriteInterceptor />
        {/* Desktop-first: below `md` the console shows a "use a bigger screen" gate, not a broken
            layout. CSS-only (md:hidden) so no hydration flash. Landing site stays mobile-friendly. */}
        <MobileGate />
      </TooltipProvider>
    </ViewerModeProvider>
  );
}
