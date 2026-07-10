// Off Grid Console — TYPED lint gate (#226).
//
// This is a SEPARATE, focused, type-aware ESLint pass that runs ONLY the rules
// that need TypeScript type information (a `parserOptions.project`) to work.
// It is intentionally NOT the stylistic linter — `next lint`/.eslintrc.json owns
// import-order, complexity, no-console, etc. Keeping the two apart means:
//
//   • the typed pass stays FAST and CLEAN (one high-value rule, zero pre-existing
//     stylistic noise), so it can be wired into the pre-push + CI gate as an
//     ERROR without dragging the ~1k pre-existing stylistic findings into the
//     blocking path, and
//   • the type-aware parser is configured exactly once, here, rather than bolted
//     onto the Next.js eslintrc (where `next lint` does not wire up the TS project).
//
// The load-bearing rule:
//   @typescript-eslint/no-unnecessary-condition — flags conditions the type system
//   proves are always-truthy / always-falsy: dead branches, redundant `?.` on
//   non-nullable values, `x != null` on a non-nullable, etc. These are real defects
//   (a guard that never fires hides a bug or is cruft). Fix the branch, or, for a
//   deliberate defensive/runtime check the types can't see (e.g. data crossing an
//   `any`/JSON boundary), inline-disable with a one-line reason.
//
// Run:   npm run lint:typed
// Scope: src/lib — the pure logic + adapter layer, where dead branches matter most
//        and the type coverage is strongest. (.tsx/route glue is covered by build.)

import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/lib/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        // Type-aware linting: point the parser at the tsconfig so it can resolve
        // types for every file it lints. Required by no-unnecessary-condition.
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        {
          // Don't flag `while (true)` — the standard infinite-loop idiom.
          allowConstantLoopConditions: true,
        },
      ],
    },
  },
];
