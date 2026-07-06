import Link from 'next/link';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';

// A new agent deserves a new screen. Creation now happens in the full-screen guided builder
// (the AppBuilder at /studio/new — an agent is a 1-step app), not a cramped side-panel. This
// button just navigates there; the builder owns authoring, grounding, tools, and governance.
export function CreateAgentButton() {
  return (
    <Button asChild size="sm">
      <Link href="/studio/new">
        <Plus className="size-4" />
        New agent
      </Link>
    </Button>
  );
}
