import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteAllConversations, exportUserData } from '@/lib/chat';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → download a JSON export of the user's chat data. DELETE → wipe all of the user's chats.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const data = await exportUserData(userId, await currentOrgId());
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': 'attachment; filename="offgrid-chat-export.json"',
    },
  });
}

export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await deleteAllConversations(userId);
  return NextResponse.json({ ok: true });
}
