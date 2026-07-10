# Adversarial audit — Secrets / config store

Target: OpenBao/vault adapter, secret CRUD, versions, seal/unseal, leases,
dynamic-db creds, config reveal, service-client secrets.

Worktree off wave2. READ-ONLY live probes; write/mutation attacks are LOCAL tests only.
NO push / merge / deploy. NEVER destructive writes vs the live demo.

## Axes

- op: read / write / version / reveal / seal / lease
- secret-vs-non-secret field
- vault state: up / down / sealed / uninit
- role: viewer / admin
- org-scoping: org A vs org B

## Map (files)

- `src/app/api/v1/admin/secrets/route.ts` — secret CRUD
- `src/app/api/v1/admin/secrets/versions/route.ts` — versions
- `src/app/api/v1/admin/secrets/seal/route.ts` — seal/unseal
- `src/app/api/v1/admin/secrets/leases/route.ts` — leases
- `src/app/api/v1/admin/secrets/dynamic-db/route.ts` — dynamic db creds
- `src/app/api/v1/admin/access/clients/[id]/secret/route.ts` — service-client secret
- `src/app/api/v1/admin/config/reveal/route.ts` — config reveal
- `src/lib/adapters/secrets.ts` — vault adapter
- `src/lib/secrets-ops.ts`, `src/lib/secrets-view.ts`, `src/lib/connector-secrets.ts`
- `src/lib/secret-keys.ts`, `src/lib/viewer-policy.ts` (redactSecretForViewer)

## Findings ledger

(pending — audit in progress)

## Prior findings to confirm/extend

- G-SEC-VIEWER-1 — connector endpoint creds leak to viewer
- G-ADV-SET-5 — reveal returns raw host + redacts w/o checking secret flag
