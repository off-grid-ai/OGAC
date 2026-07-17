import { toDisplayHost } from './display-host';
import type { ServiceEntry } from './service-entry';

/**
 * Browser-safe projection of the server-owned service registry.
 *
 * `ServiceEntry.url` is a connection target used by server-side probes and may contain database
 * credentials, API tokens, private paths, or query parameters. It must never cross the React
 * Server Component boundary. The directory only needs a safe HTTP(S) origin for an optional
 * operator link, so this DTO deliberately excludes every probe/control field and the raw URL.
 */
export interface ServiceDirectoryEntry {
  id: string;
  label: string;
  description: string;
  displayUrl: string | null;
  auth: ServiceEntry['auth'];
  kind: ServiceEntry['kind'];
}

export interface ServiceDetailEntry extends ServiceDirectoryEntry {
  /** Allow-listed management surface; raw probe configuration remains server-only. */
  management?: 'redpanda';
}

/**
 * Convert a server connection target into the only URL form the directory may serialize.
 *
 * Non-HTTP connection strings are not browser destinations and are omitted. For HTTP(S), only the
 * display-mapped origin survives: userinfo, path, query parameters, and fragments are discarded.
 * This is intentionally stricter than redacting known secret parameter names because allow-listing
 * the origin prevents newly named credentials from leaking later.
 */
export function toSafeServiceDisplayUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  // Build from the parsed origin rather than mutating/returning the input so no userinfo, path,
  // query, or fragment can survive this projection.
  return toDisplayHost(parsed.origin);
}

export function toServiceDirectoryEntry(service: ServiceEntry): ServiceDirectoryEntry {
  return {
    id: service.id,
    label: service.label,
    description: service.description,
    displayUrl: toSafeServiceDisplayUrl(service.url),
    auth: service.auth,
    kind: service.kind,
  };
}

export function toServiceDirectoryEntries(
  services: readonly ServiceEntry[],
): ServiceDirectoryEntry[] {
  return services.map(toServiceDirectoryEntry);
}

export function toServiceDetailEntry(service: ServiceEntry): ServiceDetailEntry {
  return {
    ...toServiceDirectoryEntry(service),
    ...(service.management === 'redpanda' ? { management: 'redpanda' as const } : {}),
  };
}
