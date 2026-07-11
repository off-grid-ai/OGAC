import type { ReactNode } from 'react';
import { WorkspaceNav } from '@/components/workspace/WorkspaceNav';

// Shared layout for the Workspace library surfaces (projects / prompts / artifacts). The
// `(workspace)` route group doesn't change any URL — it lets these pages share the scoped
// WorkspaceNav top-tabs so the everyday-create plane reads as one experience, and it's how
// Artifacts (hidden from the sidebar) stays reachable. Chat itself is a full-bleed surface and
// carries its own link back to this nav, so it deliberately lives outside this group.
export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Full-height flex column so full-bleed children (Chat) can fill the viewport: the nav is a fixed
  // band and the content slot takes the rest and scrolls internally. h-full resolves against <main>
  // (flex-1) → the content slot has a DEFINITE height, which is what a full-height child (h-full)
  // needs to size against. Normal library pages (Projects/Prompts/Artifacts) simply scroll inside the
  // slot as before.
  return (
    <div className="flex h-full flex-col gap-6">
      <WorkspaceNav />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
