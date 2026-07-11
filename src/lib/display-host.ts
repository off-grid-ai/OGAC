// display-host — pure, zero-IO mapping from an internal connection address to the mDNS
// hostname we SHOW the user. This is a DISPLAY concern ONLY: the server keeps connecting to
// the real loopback/LAN target (unchanged). Founder directive: no `127.0.0.1`, `localhost`,
// or raw IP may ever be EXPOSED in the UI — every rendered address is an mDNS host
// (`offgrid-s1.local`, `offgrid-g6.local`, …).
//
// Why loopback maps to S1: the console (a launchd next-server on S1) reaches S1-hosted
// services over 127.0.0.1 because of macOS Local-Network egress limits + loopback binding.
// So 127.0.0.1 / localhost is, from the console's vantage, S1 itself.
//
// g6 (the aux tier) is not directly reachable by the console daemon; it's fronted by S1
// edge-Caddy loopback proxies on ports 8931–8939. A loopback URL on one of those ports is
// really a g6 service, so it must DISPLAY as offgrid-g6.local.

const S1_HOST = 'offgrid-s1.local';
const G6_HOST = 'offgrid-g6.local';

// g6 edge-Caddy loopback-proxy port range (127.0.0.1:8931 → g6:3030, etc.). A loopback
// address on one of these ports is a g6 service reached through the S1 proxy.
const G6_LOOPBACK_PORT_MIN = 8931;
const G6_LOOPBACK_PORT_MAX = 8939;

// Loopback identities — from the console's vantage these ARE S1 (see header).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]']);

// Raw fleet IPs → mDNS host, so a raw LAN IP never surfaces in the UI. The concrete map is
// DEPLOYMENT-SPECIFIC topology (which LAN IP is which node), so it lives in the environment
// (`OFFGRID_FLEET_HOST_MAP`, a JSON object of `{ "<ip>": "<host>.local" }` set in .env.local on
// the box) — not hardcoded in this public source. When unset, the map is empty and the
// `isPrivateIPv4` fallback below still rewrites ANY private IP to S1_HOST, so no raw IP ever
// leaks regardless. Read lazily (memoized) so the value is picked up after env is configured.
export function parseFleetHostMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const o: unknown = JSON.parse(raw);
    if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, string>;
  } catch {
    /* malformed — fall back to empty (fallback still prevents leaks) */
  }
  return {};
}

let _ipToHost: Record<string, string> | null = null;
function ipToHost(): Record<string, string> {
  if (_ipToHost === null) _ipToHost = parseFleetHostMap(process.env.OFFGRID_FLEET_HOST_MAP);
  return _ipToHost;
}

// A bare host token counts as "internal" (and thus rewritable) if it is a loopback identity,
// a known fleet IP, or any RFC-1918 / link-local private IPv4. Public hostnames (e.g.
// getoffgridai.co) are never rewritten.
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

// Map a single hostname (no port) to its display host, given the port for g6-proxy detection.
function mapHostname(host: string, port: string): string | null {
  const lower = host.toLowerCase();
  if (LOOPBACK_HOSTS.has(lower)) {
    const p = Number(port);
    if (p >= G6_LOOPBACK_PORT_MIN && p <= G6_LOOPBACK_PORT_MAX) return G6_HOST;
    return S1_HOST;
  }
  const mapped = ipToHost()[host];
  if (mapped) return mapped;
  if (isPrivateIPv4(host)) return S1_HOST; // unknown private IP — never leak it
  return null; // public / already-mDNS / anything else: leave unchanged
}

/**
 * Map an internal address to the mDNS hostname shown in the UI, preserving scheme, port, and
 * path. Public URLs and values already using an mDNS host pass through unchanged. Accepts a
 * full URL (`http://127.0.0.1:6333/x`), a bare `host:port`, or a bare host.
 *
 * Pure and zero-IO — safe to unit-test exhaustively and to call from client components.
 */
export function toDisplayHost(input: string | null | undefined): string {
  if (input == null) return '';
  const value = String(input).trim();
  if (!value) return value;

  // Full URL form (has a scheme). Rebuild via URL so scheme/port/path/query survive.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
  if (schemeMatch) {
    let u: URL;
    try {
      u = new URL(value);
    } catch {
      return value;
    }
    const port = u.port; // '' when default
    const mapped = mapHostname(u.hostname, port);
    if (!mapped) return value;
    u.hostname = mapped;
    // URL#hostname setter drops IPv6 brackets etc.; reassembling handles the rest.
    return u.toString();
  }

  // Bare host or host:port (with optional trailing path). Split off path first.
  const slash = value.indexOf('/');
  const authority = slash === -1 ? value : value.slice(0, slash);
  const rest = slash === -1 ? '' : value.slice(slash);

  // IPv6 bare form like [::1]:8931
  const v6 = /^(\[[^\]]+\])(?::(\d+))?$/.exec(authority);
  if (v6) {
    const mapped = mapHostname(v6[1], v6[2] ?? '');
    if (!mapped) return value;
    return `${mapped}${v6[2] ? `:${v6[2]}` : ''}${rest}`;
  }

  const colon = authority.lastIndexOf(':');
  const host = colon === -1 ? authority : authority.slice(0, colon);
  const port = colon === -1 ? '' : authority.slice(colon + 1);
  // Only treat trailing `:digits` as a port; otherwise the whole thing is the host.
  const portIsNumeric = port !== '' && /^\d+$/.test(port);
  const effHost = portIsNumeric ? host : authority;
  const effPort = portIsNumeric ? port : '';

  const mapped = mapHostname(effHost, effPort);
  if (!mapped) return value;
  return `${mapped}${effPort ? `:${effPort}` : ''}${rest}`;
}

/**
 * Join a base URL with a path segment using exactly one slash between them — regardless of
 * whether the base has a trailing slash or the path a leading one. Prevents the `…:8800//v1`
 * double-slash that appears when a configured `OFFGRID_GATEWAY_URL` ends in `/` and code naively
 * appends `/v1`. Pure, zero-IO. An empty path returns the base with any trailing slash trimmed.
 */
export function joinUrlPath(base: string | null | undefined, path: string): string {
  const b = String(base ?? '').replace(/\/+$/, '');
  const p = String(path ?? '').replace(/^\/+/, '');
  return p ? `${b}/${p}` : b;
}

/**
 * The host[:port] alone (no scheme, no path) — for compact UI chips like the services cards
 * that already strip the scheme. Convenience over `toDisplayHost`.
 */
export function toDisplayHostname(input: string | null | undefined): string {
  const mapped = toDisplayHost(input);
  return mapped.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split('/')[0];
}

// Inverse of the S1 / g6 loopback mapping — used ONLY server-side, when a value we RENDERED as
// an mDNS host comes back from the browser (e.g. the VectorDB inspector's editable URL field)
// and must be translated back to the real connect target. The console reaches S1 backends over
// loopback (127.0.0.1) and g6 via S1 edge-Caddy loopback proxies on the SAME port we displayed
// (we display the proxy port, e.g. offgrid-g6.local:8931), so both invert exactly.
const DISPLAY_HOST_TO_LOOPBACK: Record<string, string> = {
  [S1_HOST]: '127.0.0.1',
  [G6_HOST]: '127.0.0.1', // g6 is reached through an S1 loopback proxy on the displayed port
};

/**
 * Reverse `toDisplayHost` for connection use: map `offgrid-s1.local` / `offgrid-g6.local` back
 * to the loopback the server actually connects to, preserving scheme/port/path. Any other host
 * (public URL, raw IP, already-loopback) passes through unchanged. Pure, zero-IO.
 *
 * Use this at the seam where a UI-supplied address is about to be used to CONNECT, so display
 * mDNS never breaks the loopback connection constraint.
 */
export function toConnectHost(input: string | null | undefined): string {
  if (input == null) return '';
  const value = String(input).trim();
  if (!value) return value;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
  if (schemeMatch) {
    let u: URL;
    try {
      u = new URL(value);
    } catch {
      return value;
    }
    const target = DISPLAY_HOST_TO_LOOPBACK[u.hostname.toLowerCase()];
    if (!target) return value;
    u.hostname = target;
    return u.toString();
  }

  const slash = value.indexOf('/');
  const authority = slash === -1 ? value : value.slice(0, slash);
  const rest = slash === -1 ? '' : value.slice(slash);
  const colon = authority.lastIndexOf(':');
  const host = colon === -1 ? authority : authority.slice(0, colon);
  const port = colon === -1 ? '' : authority.slice(colon + 1);
  const portIsNumeric = port !== '' && /^\d+$/.test(port);
  const effHost = (portIsNumeric ? host : authority).toLowerCase();
  const effPort = portIsNumeric ? port : '';
  const target = DISPLAY_HOST_TO_LOOPBACK[effHost];
  if (!target) return value;
  return `${target}${effPort ? `:${effPort}` : ''}${rest}`;
}
