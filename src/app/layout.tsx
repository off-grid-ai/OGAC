import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PostHog } from '@/components/PostHog';
import { ThemeProvider } from '@/components/ThemeProvider';
import { LANDING } from '@/lib/landing-copy';
import './globals.css';

// Social/link unfurl (title + OG + Twitter) is DERIVED from the one landing-copy source of truth, so
// the brand rules the copy is tested against (no em dash, no buzzwords, product named "Off Grid AI")
// carry through to the metadata automatically — no second place to drift.
const OG_TITLE = `${LANDING.brand} · ${LANDING.footer.companyDescription}`;
const OG_DESCRIPTION = `${LANDING.hero.headline} ${LANDING.hero.offer}`;

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
