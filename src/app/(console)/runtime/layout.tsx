import type { ReactNode } from 'react';

export default function RuntimeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="w-full space-y-6">{children}</div>;
}
