# Version Inventory — Off Grid Console

> Generated: 2026-07-02  
> Sources: `deploy/docker-compose.yml`, `package.json`, `../off-grid-ai-gungnir/docker-compose.yml`

---

## 1. Docker Image Inventory

### Gungnir (`off-grid-ai-gungnir/docker-compose.yml`)

The Gungnir compose file contains a single service (`gungnir`) built from a local `Dockerfile` (`build: .`). There are no external image pulls in that file — no version pinning concerns apply.

---

### Console (`deploy/docker-compose.yml`)

| Service | Image | Pinned Tag | Pinned? | Latest Stable (mid-2025) | Behind? |
|---|---|---|---|---|---|
| postgres (main) | `pgvector/pgvector` | `0.8.0-pg16` | Yes — semver | `0.8.0-pg17` (pgvector 0.8.0; pg17 available) | Minor — pg16 vs pg17; pgvector version is current |
| seaweedfs | `chrislusf/seaweedfs` | `3.80` | Yes — semver | `3.88` (Jul 2025) | Yes — ~8 patch releases behind |
| qdrant | `qdrant/qdrant` | `v1.12.5` | Yes — semver | `v1.13.x` (1.13.3, Jun 2025) | Yes — one minor behind |
| openbao | `openbao/openbao` | `2.1.0` | Yes — semver | `2.3.0` (Jun 2025) | Yes — two minor releases behind |
| keycloak | `quay.io/keycloak/keycloak` | `26.0.7` | Yes — semver | `26.2.5` / `26.3.0` (Jun 2025) | Yes — two patch/minor series behind |
| opa | `openpolicyagent/opa` | `0.70.0` | Yes — semver | `0.72.0` (May 2025) | Yes — two minor releases behind |
| presidio-analyzer | `mcr.microsoft.com/presidio-analyzer` | `2.2.356` | Yes — semver | `2.2.358` (May 2025) | Yes — two patch releases behind |
| presidio-anonymizer | `mcr.microsoft.com/presidio-anonymizer` | `2.2.356` | Yes — semver | `2.2.358` (May 2025) | Yes — two patch releases behind |
| victoriametrics | `victoriametrics/victoria-metrics` | `v1.106.1` | Yes — semver | `v1.115.0` (Jun 2025) | Yes — multiple minor releases behind |
| victorialogs | `victoriametrics/victoria-logs` | `v1.3.2-victorialogs` | Yes — semver | `v1.20.x` (Jun 2025) | Yes — significantly behind |
| otel-collector | `otel/opentelemetry-collector-contrib` | `0.116.0` | Yes — semver | `0.127.0` (Jun 2025) | Yes — ~11 minor releases behind |
| jaeger | `jaegertracing/all-in-one` | `1.62.0` | Yes — semver | `1.66.0` (Jun 2025) | Yes — 4 minor releases behind |
| langfuse-db | `postgres` | `16.6-alpine` | Yes — semver | `16.9-alpine` (Jun 2025) | Yes — patch behind |
| langfuse-clickhouse | `clickhouse/clickhouse-server` | `24.8-alpine` | Yes — semver (LTS) | `24.8.x` is LTS; `25.5` is latest | On LTS; not urgently behind |
| langfuse-minio | `minio/minio` | `RELEASE.2024-11-07T00-52-20Z` | Yes — timestamped release | `RELEASE.2025-05-24T...` (May 2025) | Yes — ~7 months of releases behind |
| langfuse-redis | `redis` | `7.4-alpine` | Yes — semver | `7.4.3-alpine` (Apr 2025) / `8.0` GA | On 7.4 branch; 8.0 is available but 7.4 still maintained |
| langfuse-worker | `langfuse/langfuse-worker` | `3.30.0` | Yes — semver | `3.65.x` (Jun 2025) | Yes — significantly behind |
| langfuse | `langfuse/langfuse` | `3.30.0` | Yes — semver | `3.65.x` (Jun 2025) | Yes — significantly behind |
| marquez-db | `postgres` | `16.6-alpine` | Yes — semver | `16.9-alpine` | Yes — patch behind |
| marquez | `marquezproject/marquez` | `0.50.0` | Yes — semver | `0.50.0` (latest as of mid-2025) | No — current |
| marquez-web | `marquezproject/marquez-web` | `0.50.0` | Yes — semver | `0.50.0` | No — current |
| temporal-db | `postgres` | `16.6-alpine` | Yes — semver | `16.9-alpine` | Yes — patch behind |
| temporal | `temporalio/auto-setup` | `1.25.2` | Yes — semver | `1.27.x` (Jun 2025) | Yes — two minor releases behind |
| temporal-ui | `temporalio/ui` | `2.32.0` | Yes — semver | `2.34.x` (Jun 2025) | Yes — two minor releases behind |
| redis (main) | `redis` | `7.4-alpine` | Yes — semver | `7.4.3-alpine` / `8.0` available | On 7.4 branch; still maintained |
| opensearch | `opensearchproject/opensearch` | `2.18.0` | Yes — semver | `2.19.x` (May 2025) | Yes — one minor behind |
| opensearch-dashboards | `opensearchproject/opensearch-dashboards` | `2.18.0` | Yes — semver | `2.19.x` | Yes — one minor behind |
| unleash-db | `postgres` | `16.6-alpine` | Yes — semver | `16.9-alpine` | Yes — patch behind |
| unleash | `unleashorg/unleash-server` | `6.6` | Yes — semver (minor only) | `6.7` (Jun 2025) | Yes — one minor behind |
| superset | `apache/superset` | `4.1.1` | Yes — semver | `4.1.2` / `5.0.0-rc` (Jun 2025) | Minor patch behind; 5.0 is RC |
| fleet-mysql | `mysql` | `8.0.40` | Yes — semver | `8.0.42` (May 2025) | Yes — two patch releases behind |
| fleet-redis | `redis` | `7.4-alpine` | Yes — semver | `7.4.3-alpine` | On current 7.4 branch |
| fleet | `fleetdm/fleet` | `v4.87.0` | Yes — semver | `v4.72.0` was latest as of early 2025; verify against releases | Needs verification — FleetDM releases rapidly |
| evidently | `build: ./sidecars/drift` | Local build | N/A | N/A | Depends on sidecar Dockerfile |
| ragas | `build: ./sidecars/ragas` | Local build | N/A | N/A | Depends on sidecar Dockerfile |

**Pinning assessment summary:**
- Every external image is pinned to an explicit semver or timestamped release. There are **zero `:latest` tags** and **zero digest-less unpinned images**. This is good practice.
- The `unleash` image uses a minor-only tag (`6.6` rather than `6.6.x`) — this is "loose" semver; Docker will pull any `6.6.x` patch update on re-pull without an explicit version bump. Recommend pinning to `6.6.2` (or whatever the exact patch is).

---

## 2. NPM Direct Dependencies

> `^` prefix means "compatible with" (any non-breaking update within the major). All entries below reflect what is declared in `package.json`, not what is resolved in `package-lock.json`.

### Production dependencies

| Package | Declared constraint | Notes |
|---|---|---|
| `@auth/drizzle-adapter` | `^1.11.2` | Range-pinned; floats within 1.x |
| `@lancedb/lancedb` | `^0.30.0` | Range-pinned; v0.x so minor bumps are breaking by semver convention — risky |
| `@offgrid/analytics` | `file:../shared/packages/analytics` | Local workspace dep |
| `@offgrid/finops` | `file:../shared/packages/finops` | Local workspace dep |
| `@offgrid/gateway` | `file:../gateway` | Local workspace dep |
| `@offgrid/policy` | `file:../shared/packages/policy` | Local workspace dep |
| `@offgrid/vectordb` | `file:../shared/packages/vectordb` | Local workspace dep |
| `@phosphor-icons/react` | `^2.1.10` | Range-pinned |
| `@scalar/nextjs-api-reference` | `^0.11.5` | Range-pinned; Scalar releases rapidly |
| `@xyflow/react` | `^12.11.1` | Range-pinned |
| `c2pa-node` | `^0.5.26` | Range-pinned; v0.x — same caveat as lancedb |
| `class-variance-authority` | `^0.7.1` | Range-pinned |
| `clsx` | `^2.1.1` | Range-pinned |
| `drizzle-orm` | `^0.45.2` | Range-pinned |
| `motion` | `^12.40.0` | Range-pinned (Framer Motion rename) |
| `next` | `^15.1.6` | Range-pinned; Next.js 15.x |
| `next-auth` | `^5.0.0-beta.31` | **Beta** — `next-auth@5` is still in beta; production risk |
| `next-themes` | `^0.4.6` | Range-pinned |
| `pdf-lib` | `^1.17.1` | Range-pinned; v1.17.1 has been stable for years |
| `pg` | `^8.22.0` | Range-pinned |
| `radix-ui` | `^1.6.0` | Range-pinned |
| `react` | `^19.0.0` | Range-pinned; React 19 stable |
| `react-dom` | `^19.0.0` | Range-pinned |
| `react-markdown` | `^10.1.0` | Range-pinned |
| `recharts` | `^3.8.1` | Range-pinned |
| `remark-gfm` | `^4.0.1` | Range-pinned |
| `sigstore` | `^5.0.0` | Range-pinned |
| `sonner` | `^2.0.7` | Range-pinned |
| `tailwind-merge` | `^3.6.0` | Range-pinned |

### Dev dependencies

| Package | Declared constraint | Notes |
|---|---|---|
| `@tailwindcss/postcss` | `^4.0.0` | Range-pinned; Tailwind v4 |
| `@types/node` | `^22.10.0` | Range-pinned |
| `@types/pg` | `^8.20.0` | Range-pinned |
| `@types/react` | `^19.0.0` | Range-pinned |
| `@types/react-dom` | `^19.0.0` | Range-pinned |
| `dotenv` | `^17.4.2` | Range-pinned |
| `drizzle-kit` | `^0.31.10` | Range-pinned |
| `eslint` | `^9.18.0` | Range-pinned |
| `eslint-config-next` | `^15.1.6` | Range-pinned |
| `playwright` | `^1.61.1` | Range-pinned |
| `prettier` | `^3.4.2` | Range-pinned |
| `tailwindcss` | `^4.0.0` | Range-pinned; Tailwind v4 |
| `tsx` | `^4.22.4` | Range-pinned |
| `typescript` | `^5.7.3` | Range-pinned |

---

## 3. Version Freeze Recommendations

### Docker images

**High priority — significantly behind:**

1. **Langfuse (web + worker)** — pinned at `3.30.0`, latest is `3.65.x`. This is a ~35 version gap in a rapidly-moving project. Langfuse v3 is the OTLP-native version used for LLM tracing; staying current ensures bug fixes and OTLP spec alignment. Recommend bumping to `3.65.0` (or latest stable).

2. **VictoriaLogs** — pinned at `v1.3.2`, latest is `v1.20.x`. Significant gap; VictoriaMetrics Corp ships frequently. Low migration risk (it's append-only logs).

3. **VictoriaMetrics** — pinned at `v1.106.1`, latest is `v1.115.0`. Nine minor versions behind.

4. **OTEL Collector contrib** — `0.116.0` vs `0.127.0`. Eleven minor releases behind; collector receives frequent receiver/exporter updates.

5. **MinIO (langfuse-minio)** — using a timestamped release from Nov 2024, now ~7 months old. MinIO releases weekly; bump to latest `RELEASE.2025-xx-xx` tag.

6. **OpenBao** — `2.1.0` vs `2.3.0`. Secrets manager — security patches matter most here. Should be kept current.

**Medium priority:**

7. **Keycloak** — `26.0.7` vs `26.2.5`. Identity provider security patches are important. Bump to `26.2.5`.

8. **Temporal** — `1.25.2` vs `1.27.x`. Workflow engine; breaking changes are rare between minor versions but bug fixes accumulate.

9. **OpenSearch + Dashboards** — `2.18.0` vs `2.19.x`. One minor behind; straightforward bump.

10. **Jaeger** — `1.62.0` vs `1.66.0`. Low-risk bump.

11. **All `postgres:16.6-alpine` instances** — upgrade to `16.9-alpine` (patch releases; no migration needed).

**Low priority / watch:**

12. **Qdrant** — `v1.12.5` vs `v1.13.3`. One minor behind; API additions but no breaking changes to existing endpoints.

13. **Superset** — `4.1.1` vs `4.1.2`; `5.0.0-rc` is available but RC. Stay on `4.1.2`.

14. **Unleash** — tag `6.6` is loose (no patch component). Resolve to `6.6.x` exact to prevent uncontrolled patch float.

15. **Redis** — `7.4-alpine` is current in the 7.4 LTS branch. Redis 8.0 GA is available; no urgent upgrade needed, but set a migration milestone.

16. **FleetDM** — `v4.87.0`. FleetDM releases very rapidly; verify against https://github.com/fleetdm/fleet/releases for exact current version.

### npm packages

**High priority:**

1. **`next-auth@^5.0.0-beta.31`** — This is a **beta** dependency in production. Auth.js v5 beta has been stable enough for many projects but has had breaking changes between betas. Either pin to an exact beta (`5.0.0-beta.31`) to prevent accidental float to a newer beta with breaking changes, or evaluate when v5 stable ships. At minimum, lock the exact beta: `"next-auth": "5.0.0-beta.31"`.

2. **`@lancedb/lancedb@^0.30.0`** and **`c2pa-node@^0.5.26`** — Both are v0.x packages where `^` allows minor version bumps. Under semver, v0.x minor bumps are allowed to be breaking. Either pin to exact versions or accept the drift risk.

**Medium priority:**

3. **`@scalar/nextjs-api-reference@^0.11.5`** — Scalar releases frequently; the `^` range is fine but worth watching for major version.

4. **All `^` ranges in general** — The `package-lock.json` freezes exact versions at install time, so the effective version is locked per install. The real risk is when someone runs `npm install` fresh or uses `npm update`. Consider using exact versions (`"next": "15.1.6"`) for a more reproducible production image, or at minimum use `npm ci` everywhere (which respects the lockfile).

**Recommendation:** For the Docker build that produces the production console image, always use `npm ci` (not `npm install`) to ensure the lockfile is authoritative. The `^` ranges are acceptable as long as the lockfile is committed and `npm ci` is used.

---

## 4. No-tag / `:latest` audit

All images in `deploy/docker-compose.yml` are explicitly tagged with a semver or timestamped release. **No `:latest` tags detected.** The `unleash` tag (`6.6`) is the only loose tag — it will float across `6.6.x` patch releases on Docker Hub re-pull without an image hash.

**Recommended addition:** Add `image` digests (sha256) for the most security-sensitive services (Keycloak, OpenBao, OPA) if reproducibility is a hard requirement for air-gapped deployments. For the default dev/cloud profile, semver pinning is acceptable.
