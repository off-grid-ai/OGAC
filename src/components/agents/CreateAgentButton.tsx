'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// Thin trigger that opens the URL-driven create panel (?panel=new-agent). The panel itself lives
// in AgentFormPanel, rendered once by the agents grid so it can also prefill for edit.
export function CreateAgentButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  function open() {
    const qs = withPanelParams(params.toString(), { panel: 'new-agent' });
    router.replace(panelHref(pathname, qs), { scroll: false });
  }
  return (
    <Button size="sm" onClick={open}>
      <Plus className="size-4" />
      New agent
    </Button>
  );
}
