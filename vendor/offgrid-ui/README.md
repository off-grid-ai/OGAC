# Reviewed Off Grid UI artifacts

This directory contains immutable, repository-relative package archives used by Off Grid Console.
They are intentionally private and must not be published to a package registry.

- `@offgrid/ui` is `UNLICENSED`. Its copyright owner explicitly authorized internal Console use in
  the 2026-07-17 product session. That authorization does not grant public redistribution rights.
- `@offgrid/design` is `AGPL-3.0-only`. Its licence is retained as `AGPL-3.0.txt`; corresponding
  source is identified by repository and exact commit in `release-manifest.json`.
- `SHA256SUMS` is verified before every install by the Console `preinstall` gate.

Replacing an archive is a reviewed dependency upgrade: reproduce it from the recorded source
commit, update its SHA-256 and npm lockfile integrity, and rerun the complete release gate.
