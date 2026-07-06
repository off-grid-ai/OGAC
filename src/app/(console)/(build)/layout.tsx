import type { ReactNode } from 'react';
import { BuildNav } from '@/components/build/BuildNav';

// Shared layout for the Build family (agents / studio / agent-runs). The `(build)` route group
// doesn't change any URL — it lets these pages share the scoped secondary-nav so authoring an
// assistant (Studio), managing the agent roster (Agents), and watching durable executions (Runs)
// read as one connected surface. Studio and Agents were separate sidebar rows before; consolidating
// them here keeps the sidebar scannable while preserving every route. Each page keeps its own
// heading and content below the nav.
export default function BuildLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <BuildNav />
      {children}
    </div>
  );
}
