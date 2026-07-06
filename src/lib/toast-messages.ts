// PURE toast-message formatting — zero imports, zero I/O, unit-testable.
// Keeps every "X enabled / X updated / X failed" string consistent across the
// console's toggle/save/mutation call-sites so success/error feedback reads the
// same everywhere. UI layers pass the entity name; this returns the human string.

/** Trim an entity label; falls back to a generic noun when empty. */
export function entityLabel(name: string | null | undefined, fallback = 'Setting'): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Success message for a boolean toggle: `<Entity> enabled` / `disabled`. */
export function toggleMessage(
  name: string | null | undefined,
  enabled: boolean,
  fallback?: string,
): string {
  return `${entityLabel(name, fallback)} ${enabled ? 'enabled' : 'disabled'}`;
}

/** Success message for a save/update mutation: `<Entity> updated`. */
export function updatedMessage(name: string | null | undefined, fallback?: string): string {
  return `${entityLabel(name, fallback)} updated`;
}

/**
 * Error message for a failed mutation. Prefers a server-supplied reason, else a
 * generic verb-based fallback (e.g. "Failed to update setting").
 */
export function failureMessage(
  serverError: string | null | undefined,
  verb = 'update',
  name?: string | null,
): string {
  const reason = (serverError ?? '').trim();
  if (reason.length > 0) return reason;
  const subject = name && name.trim().length > 0 ? name.trim() : '';
  return subject ? `Failed to ${verb} ${subject}` : `Failed to ${verb}`;
}
