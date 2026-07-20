export type InferenceProvider = 'gateway' | 'litellm' | 'custom';

export interface GatewayEndpoints {
  inferenceUrl: string;
  controlUrl: string;
  inferenceProvider: InferenceProvider;
  inferenceApiKey: string | null;
  controlApiKey: string | null;
}

const normalizedUrl = (value: string | undefined): string | null =>
  value?.trim().replace(/\/$/, '') || null;

/** Resolve model-door and node-control endpoints independently while preserving legacy wiring. */
export function resolveGatewayEndpoints(env: NodeJS.ProcessEnv = process.env): GatewayEndpoints {
  const legacy = normalizedUrl(env.OFFGRID_GATEWAY_URL) ?? 'http://127.0.0.1:7878';
  const requestedProvider = env.OFFGRID_INFERENCE_PROVIDER?.trim().toLowerCase();
  const provider: InferenceProvider =
    requestedProvider === 'litellm' ? 'litellm' : env.OFFGRID_INFERENCE_URL ? 'custom' : 'gateway';
  const inferenceUrl =
    normalizedUrl(env.OFFGRID_INFERENCE_URL) ??
    (provider === 'litellm' ? normalizedUrl(env.OFFGRID_LITELLM_URL) : null) ??
    legacy;
  return {
    inferenceUrl,
    controlUrl: normalizedUrl(env.OFFGRID_GATEWAY_CONTROL_URL) ?? legacy,
    inferenceProvider: provider,
    inferenceApiKey:
      env.OFFGRID_INFERENCE_API_KEY?.trim() ||
      (provider === 'litellm' ? env.OFFGRID_LITELLM_MASTER_KEY?.trim() : null) ||
      null,
    controlApiKey:
      env.OFFGRID_GATEWAY_CONTROL_API_KEY?.trim() || env.OFFGRID_GATEWAY_API_KEY?.trim() || null,
  };
}

export function gatewayWiringView(endpoints: GatewayEndpoints) {
  return {
    inferenceProvider: endpoints.inferenceProvider,
    inferenceUrl: endpoints.inferenceUrl,
    controlUrl: endpoints.controlUrl,
    split: endpoints.inferenceUrl !== endpoints.controlUrl,
    inferenceAuthConfigured: Boolean(endpoints.inferenceApiKey),
    controlAuthConfigured: Boolean(endpoints.controlApiKey),
  };
}
