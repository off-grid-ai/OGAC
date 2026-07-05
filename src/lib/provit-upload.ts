// PURE helpers for the Provit FILE-UPLOAD bridge — ZERO imports, ZERO I/O, unit-testable.
//
// Provit's deployed HTTP intake maps a repo from a public URL (no raw multipart endpoint exists —
// evidence: provit/src/ui/server.ts). So the console reuses its OWN storage (SeaweedFS, one shared
// bucket) as the single store and hands Provit a public URL. We do NOT add a parallel store or a
// schema table. To pick Provit's uploads back out of the shared bucket by NAME (the console's file
// keys are flat `<uuid>-<name>`, so a slash prefix wouldn't round-trip through the existing
// getFileMeta/deleteFile), we tag the stored filename with a stable marker. These pure functions
// own that marker convention so the tag rule has ONE source of truth.

// The marker that flags a stored file as a Provit upload. Kept human-legible so it also reads
// sensibly in the Storage module's file list.
export const PROVIT_UPLOAD_MARKER = '[provit] ';

/** The name to STORE a Provit upload under: the marker + the operator's original filename. */
export function provitUploadName(originalName: string): string {
  const clean = (originalName || 'upload').replace(/[/\\]+/g, '_').slice(0, 180);
  return `${PROVIT_UPLOAD_MARKER}${clean}`;
}

/** Is this stored filename a Provit upload? */
export function isProvitUploadName(name: string): boolean {
  return typeof name === 'string' && name.startsWith(PROVIT_UPLOAD_MARKER);
}

/** The operator-facing filename (marker stripped) for display. */
export function displayName(storedName: string): string {
  return isProvitUploadName(storedName) ? storedName.slice(PROVIT_UPLOAD_MARKER.length) : storedName;
}
