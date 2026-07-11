import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { GlobalSearch } from '@/components/GlobalSearch';
import { Hellobar } from '@/components/Hellobar';
import { PageTransition } from '@/components/PageTransition';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ViewerModeProvider } from '@/components/ViewerModeProvider';
import { readDemoBanner } from '@/lib/demo-hellobar';

export default async function ConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await auth();
  // Read-only-demo hellobar: shows only for a viewer session, with the demo creds from env.
  const banner = readDemoBanner(session?.user?.role);
  return (
    <ViewerModeProvider role={session?.user?.role}>
      <TooltipProvider>
        <div className="flex h-screen flex-col bg-background text-foreground">
          <Hellobar model={banner} />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Topbar user={session?.user} />
              <main className="flex-1 overflow-y-auto p-4 md:p-6">
                <PageTransition>{children}</PageTransition>
              </main>
            </div>
          </div>
        </div>
        <GlobalSearch />
        <Toaster />
      </TooltipProvider>
    </ViewerModeProvider>
  );
}
