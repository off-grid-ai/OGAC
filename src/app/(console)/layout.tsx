import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { GlobalSearch } from '@/components/GlobalSearch';
import { PageTransition } from '@/components/PageTransition';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar user={session?.user} />
          <main className="flex-1 overflow-y-auto p-6">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
      <GlobalSearch />
      <Toaster />
    </TooltipProvider>
  );
}
