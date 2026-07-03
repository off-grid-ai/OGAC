// Registers the @/* -> src/* ESM resolve hook. Loaded via --import in the test script so the real
// lib modules (which use the `@/db` / `@/lib/*` tsconfig aliases) can be imported under node --test.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./alias-resolver.mjs', pathToFileURL('./test/helpers/').href);
