# Public Release Checklist

Run this before the repository is made public. Every item is a gate. Do not publish until each one is checked, and treat the SUPERVISED items as hard blockers: they need a person, not an automated pass.

## Honesty and status

- [ ] Status reported honestly. No feature is described as done unless it is wired and verified, not merely coded.
- [ ] README and docs reflect what the code actually does today, not the roadmap.
- [ ] The gaps backlog (`docs/GAPS_BACKLOG.md`) is current, and no shipped-but-broken item is hidden.

## Secrets and credentials

- [ ] No secrets in the working tree. Cross-check against `docs/SECRET_INVENTORY.md`.
- [ ] **SUPERVISED, REQUIRED before public:** git history scrubbed of every secret listed as must-scrub in `docs/SECRET_INVENTORY.md`. A secret removed from the tree but left in history is still leaked.
- [ ] **SUPERVISED, REQUIRED before public:** every credential listed as must-rotate in `docs/SECRET_INVENTORY.md` is rotated. Assume anything that was ever committed is compromised.
- [ ] `.env.example` is generic. No real hosts, IPs, keys, tokens, or passwords. Placeholders only.
- [x] Security contacts in `SECURITY.md` and `CODE_OF_CONDUCT.md` are set to a real, monitored address (`mac@example.com`).

## Internal infrastructure genericized

- [ ] No real LAN IPs (`192.168.*` and other RFC-1918 ranges) in public-facing files.
- [ ] No internal hostnames (`*.local`) in public-facing files.
- [ ] No internal service subdomains in public-facing files.
- [ ] No real user emails or personal identifiers left in scripts, docs, or tests.
- [ ] Fleet and deployment docs handled: either genericized or kept out of the public repo per the split below.

## Standard OSS files present

- [ ] `LICENSE` present and correct (AGPL-3.0-only).
- [ ] `CONTRIBUTING.md` present, with build and test gates, the coverage bar, and the CLA note.
- [ ] `SECURITY.md` present, with a real disclosure contact.
- [ ] `CODE_OF_CONDUCT.md` present (Contributor Covenant).
- [ ] `README.md` present and accurate for a public reader.

## Build and quality gates

- [ ] `npm run typecheck` clean.
- [ ] `npm test` passes.
- [ ] `npm run coverage:check` passes the 85% bar on every dimension.
- [ ] `npm run build` succeeds.
- [ ] CI is green on the release commit.

## Presentation

- [ ] Screenshots in docs and README are current and show real, non-sensitive data.
- [ ] Demo and seed data contain no real customer or personal information.
- [ ] Links in docs resolve and do not point at internal-only resources.

## Supervised final pass, REQUIRED before public

These steps are handled by a person, in order, and cannot be skipped:

1. **Split the repo from the fleet.** Fleet and on-prem operational docs live in a separate, private location. Confirm the public repo does not carry them.
2. **Scrub git history.** Remove every must-scrub secret from history using the inventory as the checklist. Force-push and re-verify with a fresh clone.
3. **Rotate keys and credentials.** Rotate every must-rotate item. Confirm the old values no longer grant access.
4. **Final clean-clone audit.** Clone the public repo fresh and re-run the secret scan from scratch. Nothing sensitive should appear in the tree or in history.
