import type { ReactNode } from 'react';
export default function GovernanceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="space-y-6">{children}</div>;
}
