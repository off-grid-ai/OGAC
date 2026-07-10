import http from 'http';

interface RuntimeConfig {
    dataDir?: string;
    binRoots?: string[];
    resourceDirs?: string[];
}
/** Host calls this once at startup. Electron host passes app paths; a standalone
 *  host passes its own. Any field left out falls back to env/electron/cwd. */
declare function configureRuntime(c: RuntimeConfig): void;
/** Writable per-user data dir (models, caches, generated images, settings). */
declare function dataDir(): string;
/** The models directory under the data dir. */
declare function modelsDir(): string;
/** Dirs to search for bundled binaries (binary lives under one of these). */
declare function binRoots(): string[];
/** App/package root (cwd for spawned helpers that resolve their own deps). */
declare function appRoot(): string;
/** Resolve a bundled resource file by name across the resource dirs, or null. */
declare function resourceFile(name: string): string | null;
/** Whether running inside a packaged app (affects quarantine handling on macOS). */
declare function isPackaged(): boolean;
/** Register a shutdown callback. In Electron, hooks 'before-quit'; standalone
 *  hosts handle process teardown themselves (no-op here). */
declare function onHostQuit(fn: () => void): void;
/** Dirs to search for bundled resources (e.g. tts-worker.mjs). */
declare function resourceDirs(): string[];

/** Mutable per-request context threaded through the policy pipeline. */
interface PolicyContext {
    /** Caller identity (user-agent / x-offgrid-user header / virtual key). */
    caller: string;
    /** Correlation id for tracing. */
    corrId: string;
    /** Requested model (post-normalization). */
    model: string;
    /** Whether the request carries an image (vision). */
    image: boolean;
    /** The parsed, MUTABLE request body — pre hooks may rewrite it (e.g. redact PII). */
    body: Record<string, unknown>;
    /** The chosen upstream node (pre hooks may reassign to reroute). */
    target: GatewayNode;
    /** Fallback candidates in preference order (used on upstream failure). */
    candidates: GatewayNode[];
    /** Set by a pre hook to reject the request before it hits any node. */
    deny?: {
        status: number;
        message: string;
        policy: string;
    };
    /** Set by a pre hook (e.g. cache) to serve a response WITHOUT proxying. */
    shortCircuit?: {
        status: number;
        json: unknown;
        from: string;
    };
    /** Free-form annotations policies attach for the observability record. */
    meta: Record<string, unknown>;
    /**
     * The client's originating IP (respects X-Forwarded-For from a trusted proxy).
     * Forwarded to upstreams as X-Forwarded-For.
     */
    clientIp?: string;
    /**
     * A cloud-provider token supplied by the enterprise client via x-provider-key header
     * (Mode B: client brings their own upstream key). Detected by the clientAuth policy.
     * The gateway forwards the original request verbatim — this field is for observability.
     */
    clientToken?: {
        value: string;
        kind: 'bearer' | 'x-api-key';
    };
    /**
     * Keycloak client ID (azp claim) or subject (sub) — set by the keycloakAuth policy.
     * Identifies the machine client for observability, rate-limiting, and scope enforcement.
     */
    clientId?: string;
    /**
     * OAuth2 scopes from the Keycloak JWT — set by the keycloakAuth policy.
     * Includes model:*, mode:*, tier:* scopes used for routing and policy decisions.
     */
    clientScopes?: string[];
}
/** What a post hook sees about the completed call. */
interface PolicyOutcome {
    status: number;
    output: string;
    promptTokens: number;
    completionTokens: number;
    streamed: boolean;
    /** The raw upstream JSON (non-streamed only), for caching. */
    raw?: unknown;
}
interface Policy {
    readonly name: string;
    /** Runs before proxying. May mutate ctx.body/target, set ctx.deny or ctx.shortCircuit. */
    pre?(ctx: PolicyContext): void | Promise<void>;
    /** Runs after the response completes (or a short-circuit). May redact / cache / meter. */
    post?(ctx: PolicyContext, outcome: PolicyOutcome): void | Promise<void>;
}
/** Run all pre hooks in order; stops early once a policy denies or short-circuits. */
declare function runPre(policies: Policy[], ctx: PolicyContext): Promise<void>;
/** Run all post hooks (best-effort, never throws). */
declare function runPost(policies: Policy[], ctx: PolicyContext, outcome: PolicyOutcome): Promise<void>;

/** One node gateway in the pool (a box running the single-node @offgrid/gateway on :7878). */
interface GatewayNode {
    /** Stable short id, e.g. "g1". */
    name: string;
    host: string;
    port: number;
    /** The model this node serves (routing tag; the node's llama-server ignores the field). */
    model: string;
    /** Whether the node can serve image/vision-in requests. */
    vision?: boolean;
    /** When false, the router never targets this node (it still shows in health/management). */
    enabled?: boolean;
}
/** Derived inference health — NOT mere process liveness. */
type Health = 'up' | 'degraded' | 'down' | 'unknown';
/** One captured proxied call (rolling log + per-node counters + durable shipping). */
interface TrafficRecord {
    ts: number;
    gateway: string;
    model: string;
    modelServed?: string;
    kind: 'text' | 'image' | 'embedding';
    status: number;
    ms: number;
    bytes: number;
    tokens: number;
    promptTokens?: number;
    completionTokens?: number;
    tps?: number;
    /** Time-to-first-byte (ms) — the practical backpressure symptom; stretches under load. */
    ttfb?: number;
    /** How many times the downstream socket applied write-backpressure (client couldn't drain). */
    writeBlocked?: number;
    finish?: string;
    toolCalls?: {
        name: string;
        args: string;
    }[];
    reasoning?: string;
    caller?: string;
    corrId?: string;
    params?: {
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        thinking?: boolean;
        toolsOffered?: number;
    };
    msgs?: {
        role: string;
        text: string;
    }[];
    input?: string;
    output?: string;
    /** Raw mode: all inbound HTTP request headers (set when OFFGRID_RAW_HEADERS=true). */
    requestHeaders?: Record<string, string>;
    /** Raw mode: all upstream HTTP response headers. */
    responseHeaders?: Record<string, string>;
}
/** Per-node rolled-up counters + derived health for the management/traffic views. */
interface NodeStats {
    gateway: string;
    model: string;
    requests: number;
    errors: number;
    totalMs: number;
    avgMs: number;
    tokens: number;
    health: Health;
    /** Backpressure gauges: requests in-flight now, waiting in queue, and the peak seen. */
    inflight: number;
    queued: number;
    peakInflight: number;
}
interface ClusterOptions {
    /** The node pool. Defaults to OFFGRID_POOL env (JSON) or a built-in demo pool. */
    pool?: GatewayNode[];
    port?: number;
    host?: string;
    /** Host shown in info URLs only (display). */
    hostHint?: string;
    /** OpenSearch base URL for durable, SIEM-searchable call logging (or null to disable). */
    openSearchUrl?: string | null;
    openSearchIndex?: string;
    /** Health-derivation tunables (all have env-var defaults). */
    health?: Partial<HealthConfig>;
    /** Extra observability sinks (analytics / finops / custom) added to the env-derived set. */
    sinks?: ObservabilitySink[];
    /** Policy pipeline (guardrails / rate limits / budgets / cache) — the middle layer. */
    policies?: Policy[];
    /**
     * Raw header logging mode. When true, every TrafficRecord includes the full
     * inbound request headers and upstream response headers. Useful for debugging
     * enterprise token passthrough and routing. Also enabled by OFFGRID_RAW_HEADERS=true.
     */
    rawHeaders?: boolean;
}
interface HealthConfig {
    windowMs: number;
    slowMs: number;
    jamMs: number;
    degradedErrRate: number;
    downErrRate: number;
    probeEnabled: boolean;
    probeEveryMs: number;
    probeTimeoutMs: number;
}

interface ObservabilitySink {
    /** Adapter name (for logs/introspection). */
    readonly name: string;
    /** Handle one captured call. MUST NOT throw; SHOULD NOT block the caller. */
    record(e: TrafficRecord): void;
}
/** Durable, SIEM-searchable logging: index each call into an OpenSearch document. */
declare function openSearchSink(url: string, index?: string): ObservabilitySink;
/** LLM-native tracing: push a trace+generation per call to a Langfuse ingestion endpoint. */
declare function langfuseSink(baseUrl: string, publicKey: string, secretKey: string): ObservabilitySink;
/** One-line-per-call stdout logging (always useful; the default when nothing else is configured). */
declare function stdoutSink(): ObservabilitySink;
/** Build the default sink set from env (OpenSearch + Langfuse if configured, always stdout). */
declare function sinksFromEnv(): ObservabilitySink[];

declare class TrafficStore {
    private readonly sinks;
    readonly startedAt: number;
    private log;
    private stats;
    constructor(sinks?: ObservabilitySink[]);
    record(e: TrafficRecord): void;
    /** Records within the recency window for a node (health derivation reads this). */
    recentFor(name: string, windowMs: number, now?: number): TrafficRecord[];
    counters(name: string): {
        requests: number;
        errors: number;
        totalMs: number;
        tokens: number;
    };
    statsFor(name: string, model: string, health: NodeStats['health'], gauges?: {
        inflight: number;
        queued: number;
        peakInflight: number;
    }): NodeStats;
    /** Newest-first copy of the rolling log. */
    recent(): TrafficRecord[];
}

declare function healthConfig(o?: Partial<HealthConfig>): HealthConfig;
declare class HealthMonitor {
    private readonly traffic;
    private readonly cfg;
    private probe;
    private timer;
    constructor(traffic: TrafficStore, cfg: HealthConfig);
    /** Seed reachability from a cheap liveness check so health isn't 'unknown' on cold start. */
    seed(name: string, reachable: boolean): void;
    healthFor(name: string): Health;
    private probeOne;
    /** Start staggered background probing across the live nodes (one per tick). */
    start(live: GatewayNode[]): void;
    stop(): void;
}

interface ClusterGateway {
    server: http.Server;
    pool: GatewayNode[];
    live: GatewayNode[];
    traffic: TrafficStore;
    health: HealthMonitor;
    /** Snapshot for the /traffic view + console management plane. */
    trafficJSON(): unknown;
    /** Merged pool info (modalities + per-node health) for the / and /health views. */
    poolInfo(): Promise<unknown>;
    listen(): ClusterGateway;
    close(): void;
}
declare function createClusterGateway(opts?: ClusterOptions): ClusterGateway;

declare class Router {
    private readonly live;
    private rr;
    constructor(live: GatewayNode[]);
    private rrPick;
    /** The eligible nodes for a request (the family that can serve it). */
    candidates(model: string | undefined, image: boolean): GatewayNode[];
    pick(model: string | undefined, image: boolean): GatewayNode | undefined;
    /** Load-aware pick: the least-loaded node in the family (round-robin breaks ties).
     *  This spreads pressure off a saturating node before it jams. */
    pickLeastLoaded(model: string | undefined, image: boolean, load: (name: string) => number): GatewayNode | undefined;
}
/** Detect an image part in an OpenAI chat body (multipart content). */
declare function hasImage(body: {
    messages?: unknown;
}): boolean;

interface LimiterConfig {
    /** Max requests a single node serves at once before overflow queues. */
    maxConcurrentPerNode: number;
    /** Max requests allowed to WAIT per node; beyond this we 503. */
    maxQueuePerNode: number;
    /** How long a queued request waits for a slot before giving up (ms). */
    acquireTimeoutMs: number;
}
declare function limiterConfig(o?: Partial<LimiterConfig>): LimiterConfig;
/** Thrown/returned when a node is saturated and its wait-queue is full. */
declare class Saturated extends Error {
    readonly node: string;
    constructor(node: string);
}
declare class AdmissionLimiter {
    private readonly cfg;
    private state;
    constructor(cfg: LimiterConfig);
    private nodeState;
    /** Acquire a slot for a node. Resolves when a slot is free; rejects Saturated
     *  if the wait-queue is full or the wait times out. */
    acquire(name: string): Promise<void>;
    /** Release a slot; hands it to the next waiter if any. */
    release(name: string): void;
    inflight(name: string): number;
    queued(name: string): number;
    peak(name: string): number;
    /** Total load signal for a node (in-flight + queued) — used for load-aware routing. */
    load(name: string): number;
}

interface NodeModelView {
    node: string;
    catalog: unknown[];
    installed: string[];
    active: Record<string, string> | null;
    reachable: boolean;
}
/** The full model picture for one node: what's downloadable, installed, and active. */
declare function nodeModels(g: GatewayNode): Promise<NodeModelView>;
/** Load / switch the active model on a node (optionally scoped to a modality kind). */
declare function activateModel(g: GatewayNode, id: string, kind?: string): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
}>;
/** Unload the active model on a node (kind defaults to text). Falls back to activating "" if unsupported. */
declare function unloadModel(g: GatewayNode, kind?: string): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
}>;
/** Begin a download/pull of a catalog (or HF) model onto a node. */
declare function pullModel(g: GatewayNode, id: string): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
}>;
/** Poll a node's pull progress. */
declare function pullStatus(g: GatewayNode, id: string): Promise<unknown>;
/** Delete an installed model from a node's disk. */
declare function deleteModel(g: GatewayNode, id: string): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
}>;
/** Read a node's runtime settings (ctx size, KV-cache, gpu layers, sampling, …). */
declare function getSettings(g: GatewayNode): Promise<{
    supported: boolean;
    settings: Record<string, unknown> | null;
}>;
/** Update a node's runtime settings. Launch-time keys (ctx/kv/gpu/threads/batch)
 *  cause the node to respawn its model server; per-request keys apply live. */
declare function setSettings(g: GatewayNode, settings: Record<string, unknown>): Promise<{
    supported: boolean;
    ok: boolean;
    status: number;
    data: unknown;
}>;

type models_NodeModelView = NodeModelView;
declare const models_activateModel: typeof activateModel;
declare const models_deleteModel: typeof deleteModel;
declare const models_getSettings: typeof getSettings;
declare const models_nodeModels: typeof nodeModels;
declare const models_pullModel: typeof pullModel;
declare const models_pullStatus: typeof pullStatus;
declare const models_setSettings: typeof setSettings;
declare const models_unloadModel: typeof unloadModel;
declare namespace models {
  export { type models_NodeModelView as NodeModelView, models_activateModel as activateModel, models_deleteModel as deleteModel, models_getSettings as getSettings, models_nodeModels as nodeModels, models_pullModel as pullModel, models_pullStatus as pullStatus, models_setSettings as setSettings, models_unloadModel as unloadModel };
}

interface ClientAuthOptions {
    /**
     * Max number of distinct tokens to keep in memory.
     * Oldest entries are evicted when the cap is hit. Default: 500.
     */
    maxTokens?: number;
}
interface TokenEntry {
    /** Truncated token for display — never the full value. */
    preview: string;
    kind: 'bearer' | 'x-api-key';
    firstSeen: number;
    lastSeen: number;
    uses: number;
    inferred: InferredToken;
    /** All distinct client IPs that have used this token, with per-IP use counts. */
    ips: Record<string, number>;
}
interface InferredToken {
    provider?: string;
    tokenType?: string;
    /** For JWTs: the decoded header + payload (no verification). */
    jwt?: {
        header: Record<string, unknown>;
        payload: Record<string, unknown>;
    };
    notes?: string;
}
declare class TokenStore {
    private readonly cap;
    private readonly byHash;
    private readonly insertOrder;
    constructor(cap: number);
    private hash;
    private preview;
    record(token: string, kind: 'bearer' | 'x-api-key', ip?: string): TokenEntry;
    list(): (TokenEntry & {
        fingerprint: string;
    })[];
    get size(): number;
}
declare function clientAuth(opts?: ClientAuthOptions): Policy & {
    tokens: TokenStore;
};

interface KeycloakConfig {
    url: string;
    realm: string;
    clientId?: string;
}
interface JWTClaims {
    sub: string;
    azp?: string;
    preferred_username?: string;
    email?: string;
    scope?: string;
    realm_access?: {
        roles: string[];
    };
    resource_access?: Record<string, {
        roles: string[];
    }>;
    exp: number;
    iat: number;
    iss: string;
    aud?: string | string[];
    [k: string]: unknown;
}
declare class KeycloakValidator {
    readonly config: KeycloakConfig;
    private cache;
    private fetching;
    readonly issuer: string;
    constructor(config: KeycloakConfig);
    private jwksUrl;
    private fetchKeys;
    private getKeys;
    /** Verify a raw JWT string. Returns decoded claims or throws on failure. */
    verify(token: string): Promise<JWTClaims>;
}
declare function getValidator(cfg: KeycloakConfig): KeycloakValidator;
/** Build a KeycloakConfig from env vars (returns null if not configured). */
declare function keycloakConfigFromEnv(): KeycloakConfig | null;

interface KeycloakAuthOptions {
    /** Override Keycloak config (defaults to env vars OFFGRID_KEYCLOAK_URL/REALM/CLIENT_ID). */
    config?: KeycloakConfig;
    /**
     * What to do when Keycloak is configured but the token is missing or invalid.
     * 'deny'    → 401 (default — enforcing mode)
     * 'warn'    → log to ctx.meta and continue (permissive / migration mode)
     */
    onFailure?: 'deny' | 'warn';
    /**
     * When true, enforce model scope claims. When false (default), scopes are
     * recorded for observability but don't block requests.
     */
    enforceScopes?: boolean;
}
declare function keycloakAuth(opts?: KeycloakAuthOptions): Policy;

declare const version = "0.1.0";

export { AdmissionLimiter, type ClientAuthOptions, type ClusterGateway, type ClusterOptions, type GatewayNode, type Health, type HealthConfig, HealthMonitor, type InferredToken, type JWTClaims, type KeycloakAuthOptions, type KeycloakConfig, KeycloakValidator, type LimiterConfig, type NodeStats, type ObservabilitySink, type Policy, type PolicyContext, type PolicyOutcome, Router, Saturated, type TokenEntry, TokenStore, type TrafficRecord, TrafficStore, appRoot, binRoots, clientAuth, models as clusterModels, configureRuntime, createClusterGateway, dataDir, getValidator, hasImage, healthConfig, isPackaged, keycloakAuth, keycloakConfigFromEnv, langfuseSink, limiterConfig, modelsDir, onHostQuit, openSearchSink, resourceDirs, resourceFile, runPost, runPre, sinksFromEnv, stdoutSink, version };
