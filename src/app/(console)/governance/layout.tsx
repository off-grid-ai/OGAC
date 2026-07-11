import type { ReactNode } from 'react';
import { GovernanceNav } from '@/components/governance/GovernanceNav';

// Shared layout for the Governance family (control / policy / access / guardrails / secrets /
// regulatory / provenance). The `(governance)` route group doesn't change any URL — it lets these
// pages share the scoped secondary-nav so the compliance-officer surfaces read as one connected
// experience. Each page keeps its own heading and content below the nav.
export default function GovernanceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="space-y-6">
      <GovernanceNav />
      {children}
    </div>
  );
}
