'use client';

import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsViewer } from '@/components/ViewerModeProvider';

// Wraps a WRITE control (a create/edit/delete/trigger button, a form) so that, for the read-only
// viewer, it renders visually muted + non-interactive with a "read-only demo" tooltip explaining why.
// For every other role it renders the child untouched. This is UX on top of the server-side block
// (edge middleware + gates) — a viewer who bypasses the UI still gets a 403.
//
// It intercepts pointer + keyboard activation at the wrapper (pointer-events off + a blocking overlay)
// rather than reaching into the child, so it works for any control without prop coupling.

export const READ_ONLY_TOOLTIP = 'Read-only demo. Sign in with a full account to make changes.';

export function ReadOnlyGuard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  const viewer = useIsViewer();
  if (!viewer) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex cursor-not-allowed opacity-50 ${className ?? ''}`}
          aria-disabled="true"
          data-readonly="true"
        >
          {/* pointer-events:none stops clicks reaching the child; tabIndex -1 keeps it out of the tab
              order so a viewer cannot activate it by keyboard either. */}
          <span className="pointer-events-none" tabIndex={-1}>
            {children}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{READ_ONLY_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}
