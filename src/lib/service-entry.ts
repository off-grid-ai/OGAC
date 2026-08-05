export type ProbeMode = 'network' | 'embedded' | 'optional';

export interface ServiceEntry {
  id: string;
  label: string;
  description: string;
  /** Public URL users open. */
  url: string;
  /** Path probed for health (server-side). Defaults to '/'. */
  healthPath?: string;
  /**
   * The HTTP statuses that mean THIS service is alive at THIS path.
   *
   * Declare it when the healthy answer is not a 2xx — an OTLP receiver answering 405 to a GET is
   * genuinely healthy. Without it the default applies: under-500 is up, except 404/405 which report
   * `unverified`, because a missing path proves only that some HTTP server answered. Three services on
   * the fleet looked healthy on exactly that mistake.
   */
  expectStatus?: readonly number[];
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
