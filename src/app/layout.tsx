import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PostHog } from '@/components/PostHog';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Off Grid AI Console',
  description: 'The org-side common control plane for organizational AI.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-mono antialiased">
        <PostHog />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
