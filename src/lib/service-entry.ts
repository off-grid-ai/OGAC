export type ProbeMode = 'network' | 'embedded' | 'optional';

export interface ServiceEntry {
  id: string;
  label: string;
  description: string;
  /** Public URL users open. */
  url: string;
  /** Path probed for health (server-side). Defaults to '/'. */
  healthPath?: string;
  /** How it's protected — shown as a badge. */
  auth: 'session' | 'api-key' | 'public';
  /** Grouping for the UI. */
  kind: 'console' | 'product' | 'api' | 'site' | 'gateway';
  /** Health-probe strategy. Defaults to 'network'. */
  probe?: ProbeMode;
  /**
   * For an optional service, the state shown when it does not answer: the active fallback or the
   * reason it is not deployed. This keeps an expected fallback distinct from an outage.
   */
  fallbackLabel?: string;
  /** Optional management surface rendered inside the existing service detail route. */
  management?: 'redpanda';
}
