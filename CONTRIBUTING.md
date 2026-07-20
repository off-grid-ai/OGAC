# Contributing to Off Grid AI Console

Thanks for taking the time to contribute. This guide covers how to build, test, and land a change so it clears the bar the first time.

## What this project is

The Off Grid AI Console is the operator surface for a private, governed AI platform. It is a Next.js 15 app. The AI gateway runs as a separate service. Read `CLAUDE.md` for the project map and `docs/ENGINEERING.md` for the full engineering rules before you write code.

## Getting set up

```bash
npm install
npm run dev          # start the dev server
```

Local infra (Postgres, secrets, Redis) lives under `deploy/`. Start what you need:

```bash
cd deploy && make up           # full stack
cd deploy && make data         # Postgres + object store only
cd deploy && make secrets      # secrets backend only
```

## The gates every change must pass

Run these locally before you open a pull request. The pre-push hook enforces the coverage gate, so a push below the bar is blocked.

```bash
npm run typecheck        # tsc --noEmit, must be clean
npm test                 # node --test, all tests pass
npm run coverage:check   # coverage bar, enforced
npm run build            # production build, must succeed
```

Typecheck and tests do not catch build or route errors. Build before you call a change done.

## The coverage bar

Coverage is 85% or higher on every dimension: branches, statements, lines, functions, and conditions. It is measured on the unit-testable logic layer (`src/lib` pure logic and the pure paths of `src/lib/adapters`). Pure-I/O glue that needs live services, worker entrypoints, and React `.tsx` files are verified by integration tests and the build instead, not by the coverage threshold.

Measure it yourself with:

```bash
npm run coverage
```

The bar only goes up. Every change adds real tests.

## The engineering standard

The full rules live in `docs/ENGINEERING.md`. The short version:

- **SOLID with clear layers.** Isolate pure policy and logic from I/O. Business logic goes in `src/lib`, route handlers stay thin, and swappable backends sit behind `src/lib/adapters`. A file that is hard to cover usually needs a cleaner seam, not more mocks.
- **Write unit AND integration tests.** Tests live in `test/` and run with `node --test`. Unit-test the pure logic. Integration-test the real wiring.
- **Use mocks sparingly.** Prefer exercising real functions and real services where feasible, so tests do not hide the underlying behavior. Heavy mocking is a sign the code needs a cleaner seam.
- **Stay DRY.** One rule lives in one place and gets reused. Two surfaces that need the same decision share a pure helper. Duplicated logic that drifts is a defect, and reviewers look for it.
- **Every module is a full CRUD surface.** The console is how operators run their systems, so each module lets them create, read, update, and delete the entities it covers, and trigger the actions that manage them. A page that only lists data is the bare minimum, not a finished feature.

## Branches and pull requests

- Branch off `main`. Use a short, descriptive branch name.
- Keep each pull request focused on one change. Smaller diffs get reviewed faster.
- Write a clear description: what changed, why, and how you verified it. Include screenshots for any UI change.
- Confirm all four gates above are green before you request review.

## Contributor License Agreement

Off Grid AI is fair-code/source-available under the [Off Grid AI Source-Available License](LICENSE),
with a [Contributor License Agreement](CLA.md) covering contributions. By opening or updating a pull
request, you accept the CLA. It lets you retain ownership of your work while giving Off Grid AI the
rights required to distribute one codebase under both community and commercial licenses. If you
contribute for an employer, confirm that you have authority to accept the CLA for that organization.

## Reporting security issues

Do not open a public issue for a security vulnerability. See `SECURITY.md` for how to report one privately.

## Code of conduct

This project follows the Contributor Covenant. See `CODE_OF_CONDUCT.md`. By taking part, you agree to uphold it.
