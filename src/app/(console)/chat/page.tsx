import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { requireModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  requireModule('chat');
  return <ChatWorkspace />;
}
