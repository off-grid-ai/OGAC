// Registers the @/* -> src/* resolver hook for `node --test` integration tests. Wired in via
// --import so the resolve() hook below is active before any test module is loaded.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./alias-loader.mjs', pathToFileURL('./test/support/').href);

// Fleet IP -> mDNS host topology is env-driven (OFFGRID_FLEET_HOST_MAP) in production; the source
// ships no LAN IPs. Seed the demo topology here — loaded via --import before any test module, so
// display-host's lazy read picks it up in every test process and display-mapping assertions keep
// exercising the real g1..g8 map. Single source of truth for tests; `||=` respects an explicit
// per-test override.
process.env.OFFGRID_FLEET_HOST_MAP ||= JSON.stringify({
  '192.168.1.66': 'offgrid-g6.local',
  '192.168.1.57': 'offgrid-g1.local',
  '192.168.1.58': 'offgrid-g2.local',
  '192.168.1.32': 'offgrid-g3.local',
  '192.168.1.63': 'offgrid-g4.local',
  '192.168.1.65': 'offgrid-g5.local',
  '192.168.1.62': 'offgrid-g7.local',
  '192.168.1.64': 'offgrid-g8.local',
  '192.168.1.60': 'offgrid-s2.local',
});
