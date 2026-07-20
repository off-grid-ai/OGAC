'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';
import { isInsightsQualityEntityDetailPath } from '@/lib/insights-routes';

export default function InsightsQualityLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (isInsightsQualityEntityDetailPath(pathname)) return children;
  return <ContextualModuleShell moduleId="insights-quality">{children}</ContextualModuleShell>;
}
