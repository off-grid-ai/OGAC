import type { ReactNode } from 'react';
export default function BuildLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="space-y-6">{children}</div>;
}
