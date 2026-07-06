// Email TRIGGER poller — the on-prem IMAP drain that fires app-runs from inbound email (Phase 4C).
//
// A SEPARATE long-lived process (sibling of app-worker.mts). It connects ONLY to the org's OWN IMAP
// server — the host set in OFFGRID_EMAIL_IMAP_URL — polls for new UNSEEN messages, and for each one
// that targets a published email-triggered app, funnels it through the SAME governed entry point
// every trigger uses (submitAppRun → policy / guardrails / grounding / signing). AIR-GAP SAFE: there
// is no cloud-provider path. Unconfigured → it logs that it is disabled and exits cleanly.
//
// HOW TO RUN
//   1. On the console/on-prem host, set in .env.local / .env.production:
//        OFFGRID_EMAIL_IMAP_URL   = imaps://mail.your-corp.internal   (or host[:port] / imap://…)
//        OFFGRID_EMAIL_IMAP_USER  = the mailbox login
//        OFFGRID_EMAIL_IMAP_PASS  = the mailbox password
//        OFFGRID_EMAIL_IMAP_MAILBOX = INBOX            (optional; default INBOX)
//        OFFGRID_EMAIL_POLL_SECONDS = 60               (optional; default 60)
//      (DATABASE_URL is also required — the poller reads apps to route messages.)
//   2. From the console dir:  npm run trigger:email
//   3. Route a message to an app by plus-addressing (bot+<slug>@corp) or a subject tag [app:<slug>].
//      The app must be PUBLISHED and have trigger.kind === 'email'.
//
// ⚠️ IMPORT ORDER IS LOAD-BEARING: `./worker-env.mts` MUST be first so .env.* is loaded before @/db
// builds its pg Pool (same SASL rationale as app-worker.mts).

import './worker-env.mts';
import { pollEmailTriggers, isEmailTriggerConfigured } from '../src/lib/adapters/triggers/email-imap.ts';

const POLL_SECONDS = Math.max(10, Number(process.env.OFFGRID_EMAIL_POLL_SECONDS ?? '60'));

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[email-trigger]', ...args);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error('[email-trigger] DATABASE_URL is required (the poller reads apps to route messages).');
    process.exit(1);
  }
  if (!isEmailTriggerConfigured(process.env)) {
    log('DISABLED — set OFFGRID_EMAIL_IMAP_URL/USER/PASS to your on-prem IMAP server to enable. Exiting.');
    process.exit(0);
  }

  log(`starting — polling every ${POLL_SECONDS}s (on-prem IMAP only)`);
  let stopping = false;
  const stop = () => {
    stopping = true;
    log('shutting down');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // Simple poll loop. Each cycle is graceful (pollEmailTriggers never throws); errors are logged and
  // the loop continues so a transient IMAP blip never kills the poller.
  while (!stopping) {
    const t0 = Date.now();
    const r = await pollEmailTriggers(process.env);
    if (r.processed || r.matched || r.errors.length) {
      log(`cycle: processed=${r.processed} matched=${r.matched} errors=${r.errors.length}`);
      for (const e of r.errors) log('  error:', e);
    }
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, POLL_SECONDS * 1000 - elapsed);
    await new Promise((res) => setTimeout(res, wait));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[email-trigger] fatal', err);
  process.exit(1);
});
