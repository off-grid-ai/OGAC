import { defineConfig } from 'tsup';

// CJS is the `main`/`require` entry (index.js); ESM is `module`/`import` (index.mjs).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.js' };
  },
});
