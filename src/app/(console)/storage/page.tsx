import { redirect } from 'next/navigation';

// ─── /storage → /workspace/storage ────────────────────────────────────────────────────────────────
// The Storage surface lives under the Workspace group at /workspace/storage. Global search (and any
// older bookmark / deep-link) points file results at the bare /storage path, which had no route and
// 404'd. This permanent redirect resolves those links to the real, working storage browser so a file
// result is always clickable through to the same surface that /workspace/storage renders.
export const dynamic = 'force-dynamic';

export default function StorageRedirect() {
  redirect('/workspace/storage');
}
