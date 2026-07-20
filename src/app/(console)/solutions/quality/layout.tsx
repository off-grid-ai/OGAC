import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function QualityLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="solutions-quality">{children}</ContextualModuleShell>;
}
