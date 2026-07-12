import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PostHog } from '@/components/PostHog';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

// Brand voice matches the landing site + README (the single ethos): "AWS for AI." Keep the console's
// social/link unfurl (OG/Twitter) in lockstep with console-landing-page/src/app/layout.tsx.
const OG_TITLE = 'Off Grid AI Console — AWS for AI';
const OG_DESCRIPTION =
  'Make your enterprise intelligent, on one interface that just works. Open source, on your own servers. Set your rules once. Everyone builds governed AI on top.';

export const metadata: Metadata = {
  title: OG_TITLE,
  description: OG_DESCRIPTION,
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    siteName: 'Off Grid AI',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-mono antialiased">
        <PostHog />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
