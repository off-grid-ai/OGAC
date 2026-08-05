// Stream TRIGGER consumer — the inbound half of triggers-in → governed run → sinks-out.
//
// A SEPARATE long-lived process (sibling of email-trigger.mts). It polls every PUBLISHED app whose
// trigger is a stream topic, and for each new record funnels it through the SAME governed entry point
// every trigger uses (submitAppRun → pipeline binding / policy / guardrails / grounding / signing).
//
// AIR-GAP SAFE: it connects only to the broker the operator set in OFFGRID_REDPANDA_BROKERS. There is
// no default and no discovery. Unconfigured → it says so and exits cleanly.
//
// WHY IT KEEPS ITS OWN CURSOR rather than letting the broker track progress: broker auto-commit
// acknowledges a record when it is DELIVERED, so a crash between delivery and the run leaves the
// record acknowledged and no run recorded — enterprise work destroyed silently. This consumer
// advances its cursor only after the run is durably recorded, and a delivery ledger suppresses the
// duplicates that ordering can cause. See src/lib/topic-trigger-policy.ts.
//
// HOW TO RUN
//   1. On the console host, set in .env.local / .env.production:
//        OFFGRID_REDPANDA_BROKERS   = broker-host:9092[,another:9092]
//        OFFGRID_TOPIC_POLL_SECONDS = 10        (optional; default 10)
//      (DATABASE_URL is also required — the consumer reads apps and keeps its cursor there.)
//   2. From the console dir:  npm run trigger:topic
//   3. Give a published app a stream trigger with a topic + a group name.
//
// ⚠️ IMPORT ORDER IS LOAD-BEARING: `./worker-env.mts` MUST be first so .env.* is loaded before @/db
// builds its pg Pool (same SASL rationale as app-worker.mts).

import './worker-env.mts';
import {
  isTopicTriggerConfigured,
  pollTopicTriggers,
} from '../src/lib/adapters/triggers/topic-consumer.ts';

const POLL_SECONDS = Math.max(2, Number(process.env.OFFGRID_TOPIC_POLL_SECONDS ?? '10'));

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[topic-trigger]', ...args);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error('[topic-trigger] DATABASE_URL is required (apps and the read cursor live there).');
    process.exit(1);
  }
  if (!isTopicTriggerConfigured(process.env)) {
    log('DISABLED — set OFFGRID_REDPANDA_BROKERS to your on-prem broker to enable. Exiting.');
    process.exit(0);
  }

  log(`starting — polling every ${POLL_SECONDS}s`);
  let stopping = false;
  const stop = () => {
    stopping = true;
    log('shutting down');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    const t0 = Date.now();
    try {
      const r = await pollTopicTriggers(process.env);
      // Only speak when something happened, so a quiet deployment does not fill the log — but ALWAYS
      // speak when something went wrong. An error that scrolls past unlogged is an error nobody fixes.
      for (const c of r.cycles) {
        if (c.read || c.initialised || c.lost || c.errors.length) {
          log(
            `${c.appId} ${c.topic}: read=${c.read} ran=${c.ran} dup=${c.duplicates} ` +
              `parked=${c.parked} failed=${c.failed} initialised=${c.initialised} lost=${c.lost}`,
          );
          for (const e of c.errors) log('  ', e);
        }
      }
      for (const e of r.errors) log('  error:', e);
    } catch (e) {
      // The loop itself must survive anything: a transient broker or database blip is not a reason
      // to stop consuming for the rest of the deployment's life.
      log('cycle failed:', e instanceof Error ? e.message : String(e));
    }
    const wait = Math.max(0, POLL_SECONDS * 1000 - (Date.now() - t0));
    await new Promise((res) => setTimeout(res, wait));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[topic-trigger] fatal', err);
  process.exit(1);
});
