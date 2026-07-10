<!--
Thanks for contributing! Keep the PR focused on one change — smaller diffs get
reviewed faster. See CONTRIBUTING.md for the full bar.
-->

## What this changes

A short description of the change and the outcome it delivers.

## Why

The problem it solves or the reason for the change. Link any related issue
(e.g. `Closes #123`).

## How I verified it

- [ ] `npm run typecheck` is clean
- [ ] `npm test` passes
- [ ] `npm run coverage:check` passes (85%+ on branches, statements, lines, functions, conditions)
- [ ] `npm run build` succeeds
- [ ] Added/updated real tests for the change (unit for pure logic, integration for wiring)
- [ ] For UI changes: screenshots attached (before/after), verified on a wide viewport

## Screenshots

<!-- Required for any UI change. Redact secrets, real hosts, IPs, and personal data. -->

## Checklist

- [ ] The change keeps pure logic isolated from I/O; route handlers stay thin
- [ ] No duplicated logic (DRY); a shared rule lives in one place
- [ ] No secrets, real hostnames, IPs, or personal data introduced
- [ ] I have signed (or am willing to sign) the Contributor License Agreement — see `CLA.md`
