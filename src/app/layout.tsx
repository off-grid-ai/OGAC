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

// The link-unfurl cover. Hosted on the PUBLIC marketing origin on purpose: this app also serves
// onprem-console.getoffgridai.co, which sits behind Cloudflare Access, so an image served from here
// would 302 to a login page for every crawler and the card would come up blank. An absolute URL on the
// public origin unfurls the same wherever the link is pasted.
// `card: 'summary_large_image'` was already set but no image was ever declared, so nothing rendered.
const OG_IMAGE = {
  url: 'https://getoffgridai.co/assets/cover.png',
  width: 2976,
  height: 1440,
  alt: OG_TITLE,
};

export const metadata: Metadata = {
  title: OG_TITLE,
  description: OG_DESCRIPTION,
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    siteName: 'Off Grid AI',
    type: 'website',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* STALE-TAB RECOVERY, at the root and inline on purpose.
          After a deploy an open tab keeps requesting JS chunks by their old hashed names. Those files
          are gone, so the server answers 400 with an HTML body and strict MIME checking refuses to
          execute it — surfacing as `ChunkLoadError: Loading chunk NNN failed`.
          The React error boundary in (console) handles this for chunks loaded INSIDE the subtree, but
          it cannot catch its own LAYOUT chunk failing to load: the boundary never mounts, and Next
          falls back to a bare "Application error: a client-side exception has occurred".
          This listener is inline script in <head>, so it is already running before any chunk is
          requested and needs no bundle of its own. It reloads once, guarded by sessionStorage, so a
          genuinely broken build cannot trap the tab in a refresh loop. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `(function(){var K='og:chunk-reload';function stale(m){return /ChunkLoadError|Loading chunk [\\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(m||'')}function go(m){if(!stale(m))return;try{if(sessionStorage.getItem(K))return;sessionStorage.setItem(K,'1')}catch(e){}location.reload()}window.addEventListener('error',function(e){go(e&&e.message)});window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;go(r&&(r.message||String(r)))});window.addEventListener('load',function(){try{sessionStorage.removeItem(K)}catch(e){}})})()`,
          }}
        />
      </head>
      <body className="font-mono antialiased">
        <PostHog />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
