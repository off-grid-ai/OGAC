import { Q as QueuedInferenceRequest, b as QueueResult } from '../types-CctbDVCe.js';

/** The durable inference workflow. Awaited by the client via getResult(). */
declare function inferenceWorkflow(req: QueuedInferenceRequest, maxAttempts?: number): Promise<QueueResult>;

export { inferenceWorkflow };
