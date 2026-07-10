/** One durable inference request enqueued as a Temporal workflow. */
interface QueuedInferenceRequest {
    /** OpenAI-compatible chat body forwarded verbatim to /v1/chat/completions. */
    body: {
        model: string;
        messages: {
            role: string;
            content: unknown;
        }[];
        [k: string]: unknown;
    };
    /** Optional caller/correlation id for observability + idempotent workflow ids. */
    caller?: string;
    corrId?: string;
}
/** The result of a completed inference workflow. */
interface QueueResult {
    /** HTTP status the cluster gateway returned for the final (successful) attempt. */
    status: number;
    /** Parsed OpenAI-compatible completion body. */
    body: unknown;
    /** Wall-clock ms for the successful activity attempt. */
    ms: number;
}
/** Config for the queue client + worker. All fields have env-var defaults (see client/worker). */
interface QueueConfig {
    /** Temporal frontend address, e.g. "s1.lan:7233". */
    temporalAddress: string;
    /** Temporal namespace. */
    namespace: string;
    /** Task queue name — the worker and client must agree. */
    taskQueue: string;
    /**
     * The backpressure cap: max inference activities a single worker runs at once.
     * Size this to one node's real capacity (llama-server serves ~sequentially).
     * This is the drain rate — the whole point of the durable queue.
     */
    maxConcurrentPerNode: number;
    /** Max Temporal retry attempts per inference before the workflow fails. */
    maxAttempts: number;
    /** Cluster gateway base URL the activity POSTs to, e.g. "http://localhost:8800". */
    gatewayUrl: string;
}

export type { QueuedInferenceRequest as Q, QueueConfig as a, QueueResult as b };
