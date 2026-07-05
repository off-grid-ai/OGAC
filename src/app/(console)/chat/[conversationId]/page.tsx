import { auth } from '@/auth';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// A specific conversation is a real route: /chat/<conversationId>?project=<projectId>. The active
// conversation/project is read from the URL inside ChatWorkspace (useParams/useSearchParams) — not
// from useState — so a conversation is shareable, refresh-safe, and Back steps between them.
export default async function ChatConversationPage() {
  await requireModuleForUser('chat');
  const session = await auth();
  return (
    <ChatWorkspace
      role={session?.user?.role ?? 'viewer'}
      userEmail={session?.user?.email ?? ''}
    />
  );
}
