'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';
import { isDataManagementLeaf } from '@/lib/data-destinations';
import type { ContextualModuleId, ContextualDestination } from '@/modules/contextual-navigation';

/**
 * Adds the canonical level-three shell to exact Data management leaves without changing the
 * presentation or heading hierarchy of the entity-detail routes nested below the same segment.
 */
export function DataContextualShell({
  children,
  destinations,
  moduleId,
}: Readonly<{
  children: ReactNode;
  destinations: readonly ContextualDestination[];
  moduleId: ContextualModuleId;
}>) {
  const pathname = usePathname();
  if (!isDataManagementLeaf(destinations, pathname)) return children;
  return <ContextualModuleShell moduleId={moduleId}>{children}</ContextualModuleShell>;
}
