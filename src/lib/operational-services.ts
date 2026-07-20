import type { ServiceEntry } from './service-entry';

// Native daemons and public support surfaces are operational dependencies, not product adapters.
// Keeping their descriptors here gives status/services one maintainable registry and prevents route
// components from inventing one-off health rows.
export type OperationalRole = 'control' | 'worker' | 'edge' | 'forwarder' | 'public-surface';

export interface OperationalServiceEntry extends ServiceEntry {
  operationalRole: OperationalRole;
  configKeys: string[];
}

type Env = Record<string, string | undefined>;

function indirect(
  id: string,
  label: string,
  description: string,
  operationalRole: OperationalRole,
  configKeys: string[],
  fallbackLabel: string,
): OperationalServiceEntry {
  return {
    id,
    label,
    description,
    url: `indirect://${id}`,
    auth: 'session',
    kind: 'api',
    probe: 'optional',
    fallbackLabel,
    operationalRole,
    configKeys,
  };
}

export function getOperationalServices(env: Env = process.env): OperationalServiceEntry[] {
  const gatewayControl =
    env.OFFGRID_GATEWAY_CONTROL_URL ?? env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';
  return [
    {
      id: 'gateway-control',
      label: 'Gateway Control',
      description:
        'The node-control aggregator used for fleet health, model activation, restart, and pool membership.',
      url: gatewayControl,
      healthPath: '/healthz',
      auth: 'api-key',
      kind: 'gateway',
      operationalRole: 'control',
      configKeys: ['OFFGRID_GATEWAY_CONTROL_URL', 'OFFGRID_GATEWAY_URL'],
    },
    indirect(
      'agent-worker',
      'Agent Worker',
      'Temporal worker that executes durable agent runs.',
      'worker',
      ['OFFGRID_AGENT_TASK_QUEUE'],
      'readiness is reported by Temporal task-queue/run state',
    ),
    indirect(
      'app-worker',
      'App Worker',
      'Temporal worker that executes durable multi-step app runs.',
      'worker',
      ['OFFGRID_APP_TASK_QUEUE'],
      'readiness is reported by Temporal task-queue/run state',
    ),
    indirect(
      'chat-worker',
      'Chat Worker',
      'Temporal worker that durably records governed chat runs.',
      'worker',
      ['OFFGRID_CHAT_TASK_QUEUE'],
      'readiness is reported by Temporal task-queue/run state',
    ),
    {
      id: 'cloudflared',
      label: 'Cloudflare Tunnel',
      description: 'Outbound tunnel publishing the gated on-prem public surfaces.',
      url: env.OFFGRID_CLOUDFLARED_HEALTH_URL ?? 'not-configured://cloudflared',
      healthPath: '/ready',
      auth: 'public',
      kind: 'gateway',
      probe: 'optional',
      fallbackLabel: 'direct tunnel readiness endpoint not configured',
      operationalRole: 'edge',
      configKeys: ['OFFGRID_CLOUDFLARED_HEALTH_URL'],
    },
    {
      id: 'landing',
      label: 'Console Landing',
      description: 'Public product landing surface served by the native landing process.',
      url: env.OFFGRID_LANDING_URL ?? 'https://console-landing.getoffgridai.co',
      auth: 'session',
      kind: 'site',
      operationalRole: 'public-surface',
      configKeys: ['OFFGRID_LANDING_URL'],
    },
    {
      id: 'status-page',
      label: 'Console Status',
      description: 'Public operational status surface served by the native status process.',
      url: env.OFFGRID_STATUS_URL ?? 'https://console-status.getoffgridai.co',
      auth: 'session',
      kind: 'site',
      operationalRole: 'public-surface',
      configKeys: ['OFFGRID_STATUS_URL'],
    },
    indirect(
      'litellm-forwarder',
      'LiteLLM Forwarder',
      'Root TCP bridge from the console host to the LiteLLM node.',
      'forwarder',
      ['OFFGRID_LITELLM_URL'],
      'indirect dependency — verified through the LiteLLM service',
    ),
    indirect(
      'observability-forwarder',
      'Observability Forwarder',
      'Root TCP bridges from the console host to VictoriaLogs and Jaeger.',
      'forwarder',
      ['OFFGRID_VICTORIALOGS_URL', 'OFFGRID_JAEGER_URL'],
      'indirect dependency — verified through logs and trace services',
    ),
    indirect(
      'fleet-forwarder',
      'Fleet Forwarder',
      'Root TCP bridges from the LiteLLM host to model-serving fleet nodes.',
      'forwarder',
      [],
      'indirect dependency — verified through router deployment health',
    ),
  ];
}
