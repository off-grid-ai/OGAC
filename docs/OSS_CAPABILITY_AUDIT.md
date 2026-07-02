# OSS Capability Audit — app-layer functionality vs. what we use

Deep recon (with web search) of every OSS service + our own `@offgrid/*` packages the
Off Grid stack consumes, enumerating **app-layer** capabilities (features an application
builds on — not infra trivia) and marking **Used by us? = Yes / Partial / No** with the gap.

> Purpose: find what we're paying to run but not leveraging. ~250+ capabilities across
> ~20 services/packages. "No" rows are the backlog.

Legend: **Yes** = actively used · **Partial** = wired shallow / available but not leveraged · **No** = unused (gap).

---

## 1. Identity · Policy · Secrets · Flags · PII

### Keycloak
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| OIDC auth-code + PKCE | Browser login → ID/access tokens | Yes | NextAuth → Keycloak; the live sign-in |
| OIDC implicit | Token-in-fragment (legacy SPA) | No | code+PKCE only |
| OIDC client credentials | Service-to-service tokens | No | Gateway does own auth |
| Device authorization flow | Login on input-constrained devices | No | — |
| Direct grant (ROPC) | Username/password to token endpoint | No | — |
| SAML 2.0 | Enterprise SSO via assertions | No | Advertised, not wired |
| SCIM provisioning | Auto (de)provision users/groups | Partial | Stub endpoint; group→role not wired |
| LDAP/AD federation | Sync external directory | No | — |
| Identity brokering | Delegate to external IdPs | No | — |
| Social login | Google/GitHub/etc | Partial | Google/MS in console directly, not brokered |
| TOTP/HOTP MFA | Authenticator OTP | No | Not enforced |
| WebAuthn / passkeys | Phishing-resistant passwordless | No | Not enabled |
| Step-up auth / ACR | Elevate assurance for sensitive ops | No | Gap for high-risk agent actions |
| Recovery codes | Backup MFA codes | No | — |
| Authorization Services + UMA | Fine-grained resource permissions | No | We use OPA/ABAC instead |
| Groups | Users + inherited roles/attrs | Partial | Roles from our DB, not KC groups |
| Realm & client roles | Role definitions | Partial | Sourced from our DB |
| Composite roles | Roles aggregating roles | No | — |
| Client scopes | Conditional claims per scope | No | Defaults only |
| Protocol mappers | Shape token claims | Partial | Default claims only |
| Token exchange | Delegation/impersonation swap | No | — |
| Offline/refresh tokens | Silent re-auth | Partial | Refresh yes, offline no |
| Session management | View/revoke sessions | No | Not surfaced |
| Password policies | Complexity/history/rotation | No | Not configured |
| Brute-force detection | Lockout on failed logins | No | Not tuned |
| Required actions | Force update-password/verify-email | No | — |
| Custom authenticator SPI | Bespoke auth steps | No | — |
| Admin REST API | Programmatic realm/user mgmt | No | Not called (SCIM stub aside) |
| Event listeners / audit | Login/admin events | No | We audit in PG/OpenSearch |
| User Storage SPI | Back auth with proprietary DB | No | — |
| Themes | Branded login/account pages | No | Gap: no Off Grid theme |
| Organizations | Multi-tenant domains | No | Org/tenant in console DB |
| Impersonation | Admin acts as user | No | — |
| Account console | User self-service creds | No | — |
| Back/front-channel logout | Coordinated single logout | No | Basic signout only |
| `@example.com` domain restriction | Restrict realm login to domain | Yes | Enforced |

### Open Policy Agent (OPA)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Rego policy evaluation | Declarative allow/deny/ABAC | Yes | `POST /v1/data/offgrid/authz` per agent run |
| Deny-overrides model | Any deny wins | Yes | Our authz semantics |
| Data documents (external data) | Feed base data into decisions | Partial | Rich input; no pushed base doc |
| HTTP decision API | REST `/v1/data` | Yes | In-path call site |
| gRPC decision API | Decisions over gRPC | No | HTTP only |
| Policy bundles | Signed auto-updated bundles | No | Gap: no bundle delivery |
| Decision logs | Stream decisions for audit | No | Gap: audit separately |
| Partial evaluation | Residual queries | No | — |
| WASM policies | Embedded WASM eval | No | — |
| `http.send` builtin | Fetch external data in policy | No | — |
| JWT verify/decode builtin | Validate tokens in Rego | No | Done in NextAuth |
| Envoy/Istio ext-authz | Mesh authorizer | No | Not our topology |
| K8s admission control | Gate k8s resources | No | Compose, not k8s |
| Policy testing (`opa test`) | Unit-test Rego | No | Gap: no policy tests |
| Coverage reporting | Test coverage | No | — |
| Query explain/trace | Trace a decision | No | — |
| First-party ABAC fallback | Evaluate if OPA down | Yes | Own evaluator default |

### OpenBao / Vault
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| KV v2 secrets | Versioned secrets | Yes | `secrets.ts`; Secrets Vault panel |
| KV v1 | Unversioned KV | No | v2 mount |
| Secret versioning/soft-delete | Roll back versions | No | Read latest only |
| Dynamic DB credentials | Short-lived DB creds | No | Gap: connectors use static creds |
| Transit encryption-as-a-service | Encrypt/decrypt w/o keys | No | — |
| PKI / cert issuance | Issue x509 | No | — |
| SSH secrets | Issue SSH creds/certs | No | — |
| Leases + renewal + revocation | Lifecycle secrets | No | Static KV, no rotation |
| AppRole auth | Machine auth | No | Static token |
| Userpass/OIDC/K8s auth | Human/workload auth | No | Static `X-Vault-Token` |
| ACL policies | Path-scoped perms | No | — |
| Namespaces | Multi-tenant isolation | No | Single |
| Response wrapping | One-time wrapped delivery | No | — |
| Transform (FPE/masking/tokenization) | Format-preserving encrypt | No | — |
| Identity entities/groups | Unify auth identities | No | — |
| Audit devices | Log secret access | No | Not enabled |
| Seal/unseal | Master-key startup | Partial | Dev token/auto-unseal |
| In-process fallback store | Serve when Bao down | Yes | Degrades gracefully |

### Unleash (feature flags)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Feature flag toggle | On/off gate | Yes | `agent-code-exec`, `online-evals` |
| Frontend API evaluation | Fetch evaluated flags | Yes | `GET /api/frontend/features` |
| Environments | Per-env flag state | Partial | Single env |
| Gradual rollout % | Enable for % of traffic | No | Boolean reads only |
| userWithId strategy | Enable for user IDs | No | — |
| remoteAddress (IP) strategy | Enable for IPs | No | — |
| applicationHostname strategy | Enable for hosts | No | — |
| Stickiness | Consistent bucketing | No | — |
| Variants (A/B weighted) | Weighted payload variants | No | Gap: no A/B |
| Constraints | Context-field rules | No | — |
| Segments | Reusable constraint groups | No | — |
| Feature dependencies | Parent flag gates child | No | — |
| Kill switches | Instant disable | Partial | Plain toggle serves as one |
| Custom activation strategies | Org-defined targeting | No | — |
| Impression data | Exposure events | No | — |
| Change requests | Approval workflow | No | Gap for governance |
| Project/API tokens | Scoped tokens | Partial | Frontend token only |
| First-party flag fallback | Postgres flags when down | Yes | `nativeFlags` |

### Microsoft Presidio (PII)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Analyzer `/analyze` | Detect PII w/ spans+scores | Yes | In-path pre-input + post-output |
| CREDIT_CARD/EMAIL/PHONE/PERSON/LOCATION/IP/IBAN/CRYPTO/URL/DATE_TIME/MEDICAL_LICENSE/NRP recognizers | Global default entity detectors | Yes | Default recognizers |
| US_SSN/ITIN/PASSPORT/DRIVER_LICENSE/BANK | US identifiers | Partial | English default |
| UK/EU/IN/SG/AU country recognizers | NHS, Aadhaar, NRIC, ABN… | No | Non-English not configured |
| Custom recognizers | App regex/pattern/NER | No | Gap |
| Ad-hoc recognizers | Per-request recognizers | No | — |
| Deny/allow lists | Force/exclude terms | No | — |
| Context enhancement | Boost score via keywords | No | — |
| Confidence scores | Per-entity likelihood | Partial | Use types, not thresholds |
| Multi-language NLP engines | spaCy/transformers per lang | No | English only |
| Anonymizer `/anonymize` | ML de-identification | No | We regex-replace instead |
| Operators: replace/redact/mask/hash/encrypt/keep/custom | De-id transforms | No/Partial | Only regex redact |
| Deanonymize / decrypt | Reverse encryption | No | — |
| Batch/structured analysis | Analyze dicts/columns | No | Text-only |
| Image redaction (OCR) | PII in images | No | — |

---

## 2. Search · Vector · Metrics · Tracing

### OpenSearch
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Full-text match/phrase/prefix | BM25 text queries | Yes | Audit/gateway `_search` |
| multi_match | Multi-field text | Partial | — |
| query_string / simple_query_string | User query syntax | No | Not exposed |
| bool query | Compose scoring + filter | Partial | Basic |
| term/terms/terms_set | Exact-value filters/facets | Partial | Field filters |
| range | Numeric/date/IP bounds | Yes | Time-window filtering |
| exists/prefix/wildcard/fuzzy/regexp | Partial/typo matching | No | Gap: fuzzy audit search |
| Agg: terms | Group-by facets/top-N | No | Gap (matrix flags it) |
| Agg: date_histogram/histogram | Time/number bucketing | No | Charts from PG instead |
| Agg: metric (avg/percentiles/stats) | Latency percentiles etc | No | Gap |
| Agg: cardinality | Distinct count (HLL++) | No | Done in PG |
| Agg: significant_terms | Over-represented terms | No | Anomaly potential |
| Agg: composite | Paginated multi-source | No | — |
| Agg: nested/reverse_nested | Aggregate nested subdocs | No | — |
| Pipeline aggs (derivative/cumsum/moving_avg/bucket_script) | Compute on aggs | No | — |
| Highlighting | Matched-fragment snippets | No | Gap: no highlights |
| Completion suggester | Prefix autocomplete | No | Gap: no type-ahead |
| Term/phrase suggesters | "Did you mean" | No | — |
| kNN ANN (HNSW/faiss/Lucene) | Semantic vector search | No | Vectors → LanceDB/Qdrant |
| Exact kNN (script_score) | Brute-force rerank | No | — |
| kNN filtering | Filters during ANN | No | — |
| Neural search | Auto-embed + vector | No | ml-commons not wired |
| Neural sparse search | Sparse token weights | No | — |
| Hybrid query + normalization | Blend keyword+vector | No | Hybrid done app-side |
| Semantic/conversational RAG pipeline | Retrieved docs → LLM connector | No | RAG via gateway |
| Reranking processor | Cross-encoder reorder | No | — |
| Search pipelines | Per-request transforms | No | — |
| ml-commons models/connectors/agents | Models+agents in search | No | — |
| Painless scripting | Custom scoring/ingest | No | — |
| Percolator | Reverse-search/alerting | No | Gap: audit-rule matching |
| Geo queries | Spatial matching | No | N/A |
| Ingest pipelines | Pre-index transforms | No | Transform app-side |
| Index/component templates | Auto-apply mappings | Partial | Minimal |
| Reindex API | Copy/transform docs | No | — |
| PIT / scroll / search_after | Deep pagination/export | No | Gap: capped search |
| Async search | Long searches, partial results | No | — |
| Cross-cluster search | Federated query | No | Single cluster |
| SQL & PPL | SQL/pipe query for BI | No | Gap: Superset could use |
| Index State Management (ISM) | Lifecycle rollover/delete | No | Gap: no retention automation |
| Rollups & transforms | Materialize aggregates | No | — |
| Alerting plugin | Monitors + notifications | No | Gap: SIEM alerts |
| Anomaly detection plugin | RCF outliers | No | Native PSI used instead |
| Learning to Rank | XGBoost relevance | No | — |
| UBI & Relevance Workbench | Click signals, A/B relevance | No | — |
| Security (RBAC + DLS/FLS + masking) | Doc/field security | Partial | Cluster secured; DLS/FLS unused |
| Snapshots + SM | Backup/restore policies | No | Ops-level |
| Dashboards visualizations | Charts on aggregations | Partial | Embeddable, not primary |
| Notebooks | Live-query paragraphs | No | — |
| Observability (traces/logs/metrics) | OTel trace exploration | No | Traces → Langfuse |

### Qdrant
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Dense ANN search (HNSW) | NN similarity | Partial | LanceDB is default |
| Payload filtering | Boolean metadata constraints | Partial | When Qdrant selected |
| Filterable HNSW | Filter during traversal | Partial | — |
| Distance metrics | cosine/dot/euclid/manhattan | Partial | Single metric |
| Named/multiple vectors | Several vectors/point | No | Single-vector only |
| Sparse vectors | Term-weight sparse | No | Gap |
| Hybrid + Query API fusion (RRF/DBSF) | Server-side dense+sparse | No | Hybrid app-side |
| Multi-stage/prefetch | Cheap pass → rerank | No | — |
| Recommendation API | Similar-to-liked | No | Gap: "more like this" |
| Discovery API | Steer toward/away | No | — |
| Scroll/pagination | Cursor over matches | Partial | Reindex/inspector |
| Batch upsert | Bulk insert/update | Partial | Not at scale |
| Payload indexes | Fast filtering indexes | No | Gap: filters full-scan |
| Full-text payload index | Text-match filtering | No | — |
| Collections & aliases | Group + zero-downtime swap | Partial | Aliases unused |
| Multitenancy | Isolate tenants | No | Gap for org-mesh |
| Quantization | Compress vectors | No | Gap |
| On-disk/mmap vectors | Larger-than-RAM | No | — |
| Snapshots | Backup/clone | No | — |
| Distance matrix API | Pairwise for clustering/viz | No | Gap: feed scatter-plot |
| Grouping (group_by) | Cap per group/dedup | No | Gap |
| Score threshold | Relevance floor | No | Gap |
| Oversampling/rescoring | Quantized then full rescore | No | — |
| Points API (get/set/delete) | Record-level ops | Partial | Upsert mostly |
| Geo filtering | Spatial payload | No | N/A |
| Datetime payload + range | Time-scoped recall | No | Gap |

### VictoriaMetrics — **entire service OFF** (native `:9100` used instead)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| PromQL / MetricsQL + rollups/subqueries/WITH | Time-series query | No | Not deployed |
| remote_write / vmagent scrape | Prometheus ingestion | No | Gap: no durable TSDB |
| Graphite/Influx/OpenTSDB/DataDog/CSV/JSON ingest | Multi-protocol ingestion | No | — |
| OTLP metrics ingest | Native OTLP metrics | No | Gap: only traces→Langfuse |
| Recording/alerting rules (vmalert) | Precompute + alerts | No | Gap: no metric alerting |
| Alertmanager integration | Route alerts | No | — |
| Downsampling / retention / dedup | Tiered storage | No | — |
| Multitenancy | Per-tenant isolation | No | Gap for org-mesh |
| Query API (query/query_range) | HTTP metrics queries | No | Gap: no metrics API for charts |
| vmui / cardinality / top queries | Explorer + diagnostics | No | — |
| Streaming aggregation | Pre-aggregate at ingest | No | — |
| vmanomaly | Metric anomaly scores | No | Gap |
| vmbackup/restore, vmgateway | Backups + auth proxy | No | — |

### Langfuse
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Traces | Wrap each request/run | Yes | OTLP spans per agent step |
| Observations (spans/generations/events) | Instrument steps | Yes | — |
| Nested tree | Parent-child hierarchy | Yes | Span waterfall |
| Sessions | Group by sessionId | Partial | May not be set |
| Users | Per-user activity/cost | Partial | May not be stamped |
| Tags & metadata | Filter/cohort | Partial | Tag views not built |
| Environments | Isolate prod/staging | Partial | Single env |
| Releases & versions | Compare deploys | No | Gap |
| Scores | Typed quality scores | Yes | LLM-judge pushed |
| Manual annotation queues | Human review | No | Gap |
| LLM-as-judge / model evals | Auto-score | Partial | Own judge, not Langfuse-managed |
| Custom evaluators | Code-based scores | Yes | Golden-set/PSI |
| Dataset management | Versioned golden sets | Partial | May not live in Langfuse |
| Dataset runs / experiments | Regression compare | No | Gap |
| Prompt management + versioning | Runtime prompt fetch | No | Gap (own prompt library now) |
| Prompt labels/deployment | Promote versions | No | Gap |
| Prompt playground | Edit/run/compare | No | Own sandbox |
| Prompt composability | Compose prompts | No | — |
| Cost & token tracking + pricing | Auto token/USD | Partial | FinOps uses PG, not Langfuse |
| Usage/cost dashboards | Spend/token breakdowns | Partial | — |
| Custom dashboards + Metrics API | Bespoke charts/API | No | Gap: could feed Observability |
| OTLP ingestion | Accept OTLP spans | Yes | Primary ingest |
| SDKs + @observe | Low-boilerplate instrumentation | Partial | OTLP over SDK |
| Framework integrations | LangChain/LlamaIndex/etc | No | Manual OTLP |
| Public API | Read/write traces/scores | Yes | Waterfall read-back |
| Masking / PII | SDK redaction | No | Presidio in-path |
| Sampling | Ingest a fraction | No | Gap: all ingested |
| Log levels | DEBUG/WARN/ERROR status | Partial | — |
| Media/multimodal attachments | Images/audio on traces | No | — |
| Session-level analytics | Conversation quality | No | Gap |
| Public trace sharing | Shareable links | No | — |
| RBAC/projects/orgs | Org/project separation | Partial | Single project |
| Data retention | Auto-expiry | No | — |
| Batch export | Bulk export | No | — |
| Agent graph | Multi-step agent view | Partial | Own view |
| Webhooks/automations | Trigger on events | No | Gap |
| Eval on production traces | Continuous live eval | Partial | Own judge |
| Comment threads | Threaded comments | No | — |

---

## 3. Workflow · Lineage · Drift · BI · MDM · Storage

### Temporal — scaffold only (agent runs still synchronous)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Workflows | Durable replayable orchestration | Partial | Queue path (`@offgrid/gateway/queue`) exists; agent runs mostly sync |
| Activities | Retried side-effecting units | No | Steps run in-process |
| Signals | Async messages into a run | No | Maps to approval-queue events |
| Queries | Read running state | No | — |
| Updates | Validated write+response | No | — |
| Child workflows | Sub-workflow decomposition | No | — |
| Cron schedules / Schedules API | Recurring/calendar starts | No | Own Cron tooling |
| Retry policies | Backoff + max attempts | Partial | Queue workflow has one |
| Timeouts (sched/close/heartbeat) | Time bounds + stall detect | Partial | Queue workflow sets them |
| Saga / compensation | Roll back on failure | No | Gap: multi-tool rollback |
| Continue-as-new | Bound long loops | No | — |
| Task queues + rate limiting | Route + cap dispatch rate | Partial | The backpressure dial |
| Worker concurrency | Cap concurrent execs | Yes | `maxConcurrentActivityTaskExecutions` = backpressure |
| Versioning/patching | Evolve in-flight code | No | — |
| Search attributes / memo | Indexed workflow metadata | No | — |
| Async activity completion | Complete out-of-band | No | Fits long tool calls |
| Local activities | In-worker calls | No | — |
| Side effects | Record non-determinism | No | — |
| Interceptors | Middleware auth/trace/log | No | Could feed OPA/Langfuse |
| Timers / durable sleep | Replay-safe delays | No | — |
| Cancellation/termination | Cooperative vs forceful | No | — |
| Signal-with-start | Atomic signal-or-start | No | — |

### OpenLineage / Marquez
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Dataset/Job/Run model | Lineage graph core | Yes | Emitted on ingest/retrieve/run |
| Run state lifecycle | START/COMPLETE/FAIL | Partial | FAIL/ABORT unverified |
| POST /lineage API | Ingest RunEvent JSON | Yes | `lib/marquez.ts` |
| Column-level lineage | Field-to-field | No | Dataset-level only |
| Facets (general) | Pluggable metadata | Partial | Basic only |
| SchemaDatasetFacet | Field names/types | Partial | — |
| DataQualityMetrics facet | Row/null/distinct stats | No | Gap |
| DataQualityAssertions facet | Pass/fail assertions | No | Gap |
| ColumnLineage facet | Column lineage | No | Gap |
| SourceCode / SourceCodeLocation facets | Job code + VCS | No | Could attach agent code |
| SqlJobFacet | Executed SQL | No | — |
| Documentation facets | Human descriptions | No | — |
| OwnershipDatasetFacet | Dataset owners | No | Governance gap |
| DataSourceDatasetFacet | Source + URI | Partial | — |
| ParentRunFacet | Nested runs | No | Agent→tool nesting |
| NominalTimeRunFacet | Logical time | No | — |
| ErrorMessageRunFacet | Error + stack | No | — |
| Custom facets | Producer-defined | No | Off Grid provenance room |
| Namespaces | Partition jobs/datasets | Yes | — |
| Lineage/dependency graph query | Upstream/downstream | Yes | `MarquezGraph.tsx` |
| Dataset versions | Auto-version on run | Partial | Not surfaced |
| Run/job search | List/search | Partial | — |
| Tags (PII/SENSITIVE) | Governance tags | No | Gap: pairs w/ Presidio |
| Dataset schema view | Current/historical | No | — |

### Evidently — defined-but-off (`--profile qa`); own PSI + LLM-judge instead
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Data drift (per-column) | Per-feature shift score | Partial | Own PSI; Evidently opt-in |
| Dataset drift share | Overall drift flag | No | — |
| Prediction/target drift | Output/label shift | No | — |
| Drift stat methods (PSI/JS/Wasserstein/KS/chi²) | 20+ methods | Partial | PSI only |
| Data quality report/tests | Missing/dup/range checks | No | Gap |
| Reports / Test Suites / Presets / metrics | Visual + CI gates + 100+ metrics | No | Own golden-set evals |
| Column mapping | Column roles/types | No | — |
| Classification/regression/ranking perf | Accuracy/F1/NDCG/etc | No | Ranking relevant to retrieval |
| LLM-judge descriptors | Correctness/safety/bias | No | Own judge in `evals.ts` |
| RAG eval (ContextRelevance/Faithfulness) | Grounding QA | No | Gap |
| Text descriptors (semantic sim/BERTScore/toxicity) | Text quality | No | — |
| Deterministic text descriptors | Regex/JSON/length | No | — |
| PII & safety detection | Flag PII/toxicity | No | Overlaps Presidio |
| Monitoring dashboard / snapshots | Metric trends | No | Native drift instead |
| Tracing & test-dataset mgmt | Traces + eval datasets | No | Langfuse covers tracing |

### Apache Superset — shallow embed (one-time init)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Table / Big Number / time-series / pie charts | Core chart types | Partial | Only via embedded dashboard |
| Pivot / heatmap / sankey / geospatial | Advanced charts | No | — |
| SQL Lab | Browser SQL IDE | No | Gap: not provisioned |
| Datasets (physical+virtual) | Chart source | No | Unused |
| Calculated columns + metrics | Reusable expressions | No | — |
| Dashboards | Chart grids | Yes | One embedded on Analytics |
| Native filters + scoping | Value/range/time filters | No | — |
| Cross-filtering | Click filters others | No | — |
| Drill-to-detail / drill-by | Inspect rows/pivot | No | — |
| Row Level Security (RLS) | Per-role WHERE inject | No | Gap: guest tokens w/o RLS |
| Alerts & Reports | Scheduled + threshold | No | — |
| Embedded dashboards + guest tokens | JWT embed | Yes | `superset-token` route |
| REST API | CRUD | Partial | Token/embed only |
| Annotations / Jinja SQL / CSS themes / caching / export / RBAC / tags | Various | No | Off Grid theme not applied |

### FleetDM (osquery MDM) — read-only host list (Free tier)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Host inventory | Real-time device inventory | Yes | Read-only Fleet page |
| Live queries | Ad-hoc osquery SQL | No | Gap: powerful, unused |
| Scheduled query packs | Recurring collection | No | — |
| Policies (compliance) | Yes/no checks | No | Gap: fits Regulatory |
| Policy automations | Auto-remediate | No (Premium) | — |
| Software inventory | Installed apps | No | Gap |
| Vulnerability mgmt (CVE) | CVSS/EPSS/KEV | No (Premium) | — |
| Teams | Multi-tenant segmentation | No (Premium) | — |
| Labels + host targeting | Group targeting | No | — |
| MDM profiles / commands / DEP / disk-encryption / OS-updates / scripts | Device management | No (Premium) | Console has own mdm/devices |
| Host vitals | Health telemetry | Partial | Basic fields |
| REST API + fleetctl | Automation | Yes | Read path |
| GitOps / Webhooks / Fleet Desktop / Activities audit | Config-as-code + events | No | — |

### SeaweedFS — dormant (`--profile data`)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| S3-compatible API | Drop-in S3 | No | Artifacts/KB use PG/MinIO |
| Filer | POSIX-like over HTTP | No | — |
| Bucket ops / multipart / tagging | Object mgmt | No | — |
| Object versioning | Versioned objects | No | Would back artifact history |
| TTL / expiry | Auto-expire | No | Fits capture blobs |
| Presigned URLs | Temp access | No | Gap: secure download |
| Object lock / retention (WORM) | Immutability | No | Fits Regulatory/audit |
| IAM / access keys | S3 IAM | No | — |
| Replication / EC / tiering / FUSE / WebDAV / event notifications | Storage features | No | — |

---

## 4. Edge · Cache · DB + our `@offgrid/*` packages

### Caddy (edge) — round-robin + active health only
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Reverse proxy | Proxy to upstreams | Yes | Fronts gateway + console |
| Round-robin LB | Even distribution | Yes | Both handle blocks |
| Least-conn/header/cookie LB | Sticky/weighted routing | No | No session stickiness |
| Active health checks | Probe + eject | Yes | `/healthz` 10s |
| Passive health checks | Eject on live failures | No | — |
| Automatic HTTPS / on-demand TLS / internal CA | Certs | No | `auto_https off` (LAN plaintext) |
| HTTP/3 (QUIC) | Lower latency | No | — |
| Request matchers | Route by host/path/method | Yes | `@gw path /v1/*` |
| rate_limit (plugin) | Per-key rate limiting | No | Done in @offgrid/policy |
| Coraza WAF (plugin) | OWASP CRS WAF | No | Gap: no edge WAF |
| forward_auth | Delegate authN/Z | No | **← Keycloak-gating hook** |
| Basic/JWT auth | Gate routes | No | — |
| header/rewrite/redir | Manipulate | Partial | Host redirect only |
| Static files / templates / FastCGI | Serving | No | — |
| encode (gzip/zstd) | Compression | No | Gap: not enabled |
| Log formats | Structured logs | No | — |
| Admin API | Live config reload | No | `admin off` |

### Redis — bare GET/SET/SETEX cache only (hand-rolled RESP client)
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| TTL cache (GET/SET/SETEX) | KV cache w/ expiry | Partial | Only via caching port |
| Pub/Sub | Channel fan-out | No | Gap: real-time via HTTP poll |
| Streams + consumer groups | Durable acked log | No | Temporal used instead |
| Sorted sets / leaderboards | Ranked sets | No | In-process instead |
| Distributed locks / Redlock | Cross-node mutex | No | Gap: no fleet lock |
| Token-bucket rate limiting | Per-client quotas | No | Per-process in-app |
| HyperLogLog / Geo | Cardinality / nearby | No | — |
| Lua scripting / MULTI / pipelines | Atomic multi-step | No | Client lacks EVAL |
| Keyspace notifications | Key-change events | No | — |
| RediSearch / RedisJSON | Index / JSON docs | No | Vectors → LanceDB |
| Session store / job queues / INCR counters | Shared state / jobs / metrics | No | Temporal/PG instead |

### PostgreSQL — Drizzle relational store only
| Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| Relational store (Drizzle) | Typed schema/migrations | Yes | Single PG for fleet |
| UPSERT / ON CONFLICT | Atomic insert-or-update | Partial | Where idempotency needed |
| UUID gen | In-DB PKs | Partial | — |
| JSONB + GIN | Schemaless JSON + index | Partial | GIN a gap |
| Row-Level Security (RLS) | Per-row tenant isolation | No | Gap: enforced in app |
| LISTEN/NOTIFY | DB-push pub/sub | No | Gap: real-time vs polling |
| Full-text search + tsvector | Ranked keyword search | No | Delegated to LanceDB/FTS |
| pgvector | Embedding search / RAG | No | Vectors in LanceDB/Qdrant |
| Materialized views | Cached query results | No | Aggregated in-process |
| Triggers / stored procs | In-DB logic | No | Logic in app |
| Logical replication / CDC | Stream row changes | No | Gap: no CDC into memory/sync |
| Table partitioning | Scale/retention splits | No | Gap for high-volume tables |
| Generated columns / window fns / recursive CTEs | Computed/analytics SQL | No/Partial | Aggregation in JS |
| Advisory locks | Job/leader coordination | No | Gap (pairs w/ lock need) |
| Extensions (PostGIS/pg_trgm) | Geo / fuzzy | No | Fuzzy in @offgrid/clipboard |
| SKIP LOCKED | Non-blocking queue claim | No | Temporal instead |

### Our `@offgrid/*` packages — built-but-unused surface = prime gaps
| Package · Capability | App-layer | Used? | Notes/gap |
|---|---|---|---|
| gateway · `createClusterGateway` | Multinode router server | Partial | Runs on nodes; console doesn't import |
| gateway · Router / HealthMonitor / TrafficStore | Routing/health/capture | No | Lives in gateway process |
| gateway · AdmissionLimiter / Saturated | Backpressure | No | **Built, not imported by console** |
| gateway · clientAuth / TokenStore | Per-client token passthrough | No | New; enterprise token forwarding |
| gateway · runPre/runPost policy pipeline | Pre/post hooks | No | Console uses @offgrid/policy |
| gateway · clusterModels | Cluster model mgmt | Partial | Via console adapters overlap |
| gateway · dashboard | Built-in gateway UI | No | Console renders own |
| gateway/queue · enqueueInference/getResult | Durable inference queue | Yes | Dynamic import (async path) |
| gateway/queue · startQueueWorker/workflow | Temporal worker | Partial | Worker runs out-of-band |
| policy · guardrails/rateLimit/budget/cache | Concrete policies | Partial/No | Only catalog imported; console has own cache |
| policy · policiesFromEnv | Assemble pipeline | No | Built-but-unused |
| analytics · AnalyticsStore | Usage store/query | Yes | Powers analytics dashboard |
| analytics · posthog/mixpanel/webhook sinks | External forwarding | No | Kept local (offline thesis) |
| finops · FinopsStore/toFinopsReport/costOf | Cost reporting | Yes | FinOps dashboard |
| finops · budgetPolicy / finopsSink | Enforcement / sink | No | Gap: overlaps policy.budget |
| vectordb · createInspector / project2D | Inspect + PCA scatter | Yes | Vector-DB inspector page |
| rag · RagService / chunkText / topKSimilar / makeSearchKnowledgeBaseHandler | Full RAG pipeline | No | **Entire package unimported** — major gap; org KB not wired to it |
| memory · MemorySync / SqliteOpStore | Op-log/CRDT sync | No | The anti-entropy spine gap |
| sync · SyncEngine / discovery / transports / device-cap policy | Device sync + cap | No | Console doesn't pair devices; device-cap not surfaced |
| models · searchHuggingFace / ModelDownloader / ProviderRegistry / recommendForRam | Model catalog+providers | Partial | Console has own adapters |
| artifacts · parseArtifact / buildSrcDoc | Artifact render | Partial | Confirm import path |
| clipboard · fuzzySearch | Fuzzy match | No | Console could dedupe search |
| capture · CaptureEngine | Screen→OCR→text | No | Desktop/mobile primitive |
| design · tokens / tailwind-preset | Brutalist tokens | Yes | Console UI styling |

---

## Biggest unused capabilities (the backlog, ranked)

1. **`@offgrid/rag` entirely unimported** — a full chunk→embed→retrieve→prompt pipeline built and unused; the org KB should run on it (console reimplements cosine in `cache.ts`).
2. **`@offgrid/memory` / `@offgrid/sync` unused** — the anti-entropy/op-log spine + device-cap enforcement aren't wired.
3. **OpenSearch reduced to plain search** — no aggregations, highlighting, autocomplete, alerting, anomaly detection, ISM lifecycle, percolator (audit-rule matching), SQL/PPL for Superset.
4. **VictoriaMetrics off entirely** — no durable metrics TSDB, OTLP metrics sink, or metric-based alerting; `:9100` is a barebones stand-in.
5. **Temporal barely used** — worker concurrency is the only real use; signals (approval queue), saga/compensation (tool rollback), schedules, search attributes all unused.
6. **Keycloak = login only** — no MFA/WebAuthn, step-up for risky actions, orgs, themes, back-channel logout, admin-API-driven provisioning.
7. **Presidio = detect-only, English, regex-redact** — no `/anonymize` operators (mask/hash/encrypt/reversible), custom/multi-language recognizers, image redaction.
8. **OpenBao = static KV only** — no dynamic DB creds, transit encryption, leases/rotation, proper auth methods.
9. **Postgres app features unused** — RLS (tenant isolation), LISTEN/NOTIFY (real-time), pgvector, CDC, partitioning, advisory locks.
10. **Superset/FleetDM shallow** — no SQL Lab/RLS/alerts; no live queries/policies/software-inventory. **SeaweedFS/Evidently defined-but-off.** **Redis = bare cache** (no pub/sub, streams, locks). **Caddy = no WAF/rate-limit/compression** (but `forward_auth` is the Keycloak-gating hook).
11. **Langfuse** — prompt mgmt, datasets/experiments, sampling, webhooks, session analytics, Metrics API all unused.
</content>
