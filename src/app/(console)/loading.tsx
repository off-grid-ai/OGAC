import { PageSkeleton } from '@/components/PageSkeleton';
import { PageFrame } from '@/components/PageFrame';

// Suspense fallback for the console subtree — shown while a page's server components fetch its
// per-request, org-scoped data (these pages are `force-dynamic`, so the RSC render blocks on live
// data). This catches every console route that isn't inside a route group with its own loading.tsx
// (overview, gateway, services, fleet, pipelines/gateways lists, chat, admin, etc.).
//
// It renders an on-brand, full-width skeleton of a typical console surface — header + KPI band +
// card grid — so navigation paints instantly (the sidebar/topbar shell is already up from the
// layout) instead of flashing blank or a bare spinner. Honest: a shimmer of the layout, never fake
// data. Route groups override this with a shape tuned to their own pages.
export default function ConsoleLoading() {
  return (
    <PageFrame>
      <PageSkeleton stats={4} cards={8} />
    </PageFrame>
  );
}
