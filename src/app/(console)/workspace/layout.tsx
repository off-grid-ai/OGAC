import type { ReactNode } from 'react';
import { WorkspaceNav } from '@/components/workspace/WorkspaceNav';

// Shared layout for the Workspace library surfaces (projects / prompts / artifacts). The
// `(workspace)` route group doesn't change any URL — it lets these pages share the scoped
// WorkspaceNav top-tabs so the everyday-create plane reads as one experience, and it's how
// Artifacts (hidden from the sidebar) stays reachable. Chat itself is a full-bleed surface and
// carries its own link back to this nav, so it deliberately lives outside this group.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <WorkspaceNav />
      {children}
    </div>
  );
}
