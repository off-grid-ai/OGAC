// Exercises the REAL cache port against the deployed Redis, then reads back what got published.
import { redisCache, cacheCounters } from '../src/lib/adapters/cache.ts';
import { readCacheTallies } from '../src/lib/cache-tallies-store.ts';
import { aggregateTallies } from '../src/lib/cache-evidence.ts';

const key = `publish-check:${process.argv[2] ?? 'a'}`;
await redisCache.set(key, 'value-under-test', 120);
const first = await redisCache.get(key);          // should be a sharedHit
const missing = await redisCache.get(`${key}:absent`); // should be a miss
console.log('read back:', JSON.stringify(first), '| absent:', JSON.stringify(missing));
console.log('this process:', JSON.stringify(cacheCounters()));

await new Promise((r) => setTimeout(r, 2500)); // let the fire-and-forget publish land
const rows = await readCacheTallies();
console.log('published rows:', rows.length);
for (const r of rows) console.log('  ', r.label, JSON.stringify(r.counters));
console.log('aggregate total:', JSON.stringify(aggregateTallies(rows, Date.now()).total));
process.exit(0);
