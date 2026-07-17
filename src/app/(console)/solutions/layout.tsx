import type { ReactNode } from 'react';
import { SolutionsNav } from '@/components/solutions/SolutionsNav';

export default function SolutionsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="w-full space-y-6">
      <SolutionsNav />
      {children}
    </div>
  );
}
