'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { isViewer } from '@/lib/viewer-policy';

// Client-side read of "is this session the read-only viewer role", seeded once from the server layout
// (which already resolves the session). It exists so write CONTROLS (create/edit/delete/trigger
// buttons) can annotate + disable themselves for a viewer — UX on top of the server-side block, never
// instead of it. The authoritative enforcement is the edge middleware + the gates; this only shapes
// the affordance so a viewer is not left clicking dead buttons.

const ViewerContext = createContext<boolean>(false);

export function ViewerModeProvider({
  role,
  children,
}: {
  role: string | null | undefined;
  children: ReactNode;
}) {
  return <ViewerContext.Provider value={isViewer(role)}>{children}</ViewerContext.Provider>;
}

/** True when the current session is the read-only viewer. */
export function useIsViewer(): boolean {
  return useContext(ViewerContext);
}
