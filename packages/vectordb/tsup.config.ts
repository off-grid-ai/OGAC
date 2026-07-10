// @offgrid/vectordb — build config
//
// Pin output filenames to match package.json's exports map:
//   import  → dist/index.mjs (ESM)
//   require → dist/index.js  (CJS)
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.js' };
  },
});
