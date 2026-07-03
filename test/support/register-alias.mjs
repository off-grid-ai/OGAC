// Registers the @/* -> src/* resolver hook for `node --test` integration tests. Wired in via
// --import so the resolve() hook below is active before any test module is loaded.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./alias-loader.mjs', pathToFileURL('./test/support/').href);
