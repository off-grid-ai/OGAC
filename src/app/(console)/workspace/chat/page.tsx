import { auth } from '@/auth';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { FullBleedContent } from '@/components/ConsoleContent';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  await requireModuleForUser('chat');
  const session = await auth();
  return (
    <FullBleedContent>
      <ChatWorkspace
        role={session?.user?.role ?? 'viewer'}
        userEmail={session?.user?.email ?? ''}
      />
    </FullBleedContent>
  );
}
