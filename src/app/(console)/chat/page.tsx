import { auth } from '@/auth';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { requireModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  requireModule('chat');
  const session = await auth();
  return <ChatWorkspace role={session?.user?.role ?? 'viewer'} />;
}
