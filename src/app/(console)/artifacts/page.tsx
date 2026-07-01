import { ArtifactsBrowser } from '@/components/artifacts/ArtifactsBrowser';
import { requireModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

// Artifacts as a top-level surface (ChatGPT/Claude parity) — a library of renderable outputs
// (HTML, SVG, React, diagrams, code, text) saved from chats. Backed by chat_artifacts via
// /api/v1/chat/artifacts. Saving happens in chat on open; this page lists and reopens them.
export default function ArtifactsPage() {
  requireModule('artifacts');
  return <ArtifactsBrowser />;
}
