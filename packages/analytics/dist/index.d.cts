/** One completed unit of gateway traffic (a single model call). */
interface TrafficRecord {
    /** Epoch milliseconds the record was emitted. */
    ts: number;
    /** Logical gateway/node id that served the request. */
    gateway: string;
    /** Model the caller asked for. */
    model: string;
    /** Model actually served (may differ from `model` after routing/aliasing). */
    modelServed?: string;
    /** High-level workload kind. */
    kind: 'text' | 'image' | 'embedding';
    /** HTTP-style status code (200 = ok, >=400 = error). */
    status: number;
    /** Wall-clock latency in milliseconds. */
    ms: number;
    /** Payload size in bytes (best effort). */
    bytes: number;
    /** Total tokens (prompt + completion) when known. */
    tokens: number;
    promptTokens?: number;
    completionTokens?: number;
    /** Tokens per second for the generation. */
    tps?: number;
    /** Finish reason (e.g. "stop", "length", "tool_calls"). */
    finish?: string;
    /** Identifier of the calling app/user. */
    caller?: string;
    /** Correlation id for tracing across hops. */
    corrId?: string;
    /** Request parameters, when captured. */
    params?: {
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        thinking?: boolean;
        toolsOffered?: number;
    };
    /** Raw input text (may be redacted/omitted by the gateway). */
    input?: string;
    /** Raw output text (may be redacted/omitted by the gateway). */
    output?: string;
}
/**
 * A destination for traffic records. The gateway fans each completed record out
 * to every registered sink. Implementations must be non-blocking and fail-open:
 * `record` should never throw and never slow the request path.
 */
interface ObservabilitySink {
    readonly name: string;
    record(e: TrafficRecord): void;
}

/** Aggregate totals across every ingested record. */
interface Totals {
    requests: number;
    errors: number;
    errorRate: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    avgMs: number;
    avgTps: number;
}
/** One row of a grouped rollup (by model / caller / gateway). */
interface GroupRow {
    /** Group key. Named `model` on byModel(); reused generically elsewhere. */
    model: string;
    requests: number;
    tokens: number;
    avgMs: number;
    errorRate: number;
}
/** One time bucket of the timeseries. */
interface TimeBucket {
    /** Bucket start, epoch ms (aligned to bucketMs). */
    t: number;
    requests: number;
    tokens: number;
    errors: number;
    avgMs: number;
}
/** A recent distinct prompt with an occurrence count. */
interface PromptCount {
    input: string;
    count: number;
    /** Most recent time this input was seen (epoch ms). */
    lastTs: number;
}
declare class AnalyticsStore {
    private readonly maxRecords;
    /** Ring buffer of recent records (bounded by maxRecords). */
    private readonly buf;
    /** Write cursor into `buf` once it has reached capacity. */
    private head;
    private requests;
    private errors;
    private tokens;
    private promptTokens;
    private completionTokens;
    private msSum;
    private tpsSum;
    private tpsCount;
    private readonly models;
    private readonly callers;
    private readonly gateways;
    constructor(opts?: {
        maxRecords?: number;
    });
    /** Ingest one completed traffic record. Never throws. */
    ingest(e: TrafficRecord): void;
    private bump;
    totals(): Totals;
    byModel(): GroupRow[];
    byCaller(): GroupRow[];
    byGateway(): GroupRow[];
    /**
     * Bucketed timeseries built from the retained ring buffer.
     * @param bucketMs bucket width in ms
     * @param sinceMs  optional lower bound (epoch ms); records older are ignored
     */
    timeseries(bucketMs: number, sinceMs?: number): TimeBucket[];
    /**
     * Best-effort: most frequent recent distinct inputs from the ring buffer.
     * Only records that carried an `input` are considered.
     */
    topPrompts(n?: number): PromptCount[];
}

/** Sink that feeds records into the built-in in-memory AnalyticsStore. */
declare function analyticsSink(store: AnalyticsStore): ObservabilitySink;
/**
 * PostHog adapter. Emits a `$ai_generation` LLM-analytics event per record via
 * the public capture endpoint.
 * @param host defaults to https://app.posthog.com
 */
declare function posthogSink(apiKey: string, host?: string): ObservabilitySink;
/**
 * Mixpanel adapter. Posts a base64-encoded `data` payload to the track API,
 * matching Mixpanel's classic form-style ingestion.
 */
declare function mixpanelSink(token: string): ObservabilitySink;
/** POST each raw record as JSON to an arbitrary webhook URL. */
declare function webhookSink(url: string): ObservabilitySink;

interface AnalyticsIntegration {
    id: string;
    name: string;
    category: 'analytics';
    /** Config field names the integration needs, if any. */
    configFields?: string[];
}
declare const ANALYTICS_INTEGRATIONS: readonly AnalyticsIntegration[];

export { ANALYTICS_INTEGRATIONS, type AnalyticsIntegration, AnalyticsStore, type GroupRow, type ObservabilitySink, type PromptCount, type TimeBucket, type Totals, type TrafficRecord, analyticsSink, mixpanelSink, posthogSink, webhookSink };
