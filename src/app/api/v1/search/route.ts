import { ilike, and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { chatConversations, promptLibrary, chatDocuments } from '@/db/schema';
import { requireUser } from '@/lib/authz';
import { isModuleEnabled } from '@/lib/modules';
import { matchFeatures } from '@/lib/search-features';
import { MODULES } from '@/modules/registry';

export const dynamic = 'force-dynamic';

type ModuleResult = {
  kind: 'module';
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type ConversationResult = {
  kind: 'conversation';
  id: string;
  title: string;
  href: string;
};

type PromptResult = {
  kind: 'prompt';
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type FileResult = {
  kind: 'file';
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type FeatureResult = {
  kind: 'feature';
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type SearchResult =
  | ModuleResult
  | FeatureResult
  | ConversationResult
  | PromptResult
  | FileResult;

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const lower = q.toLowerCase();

  // 1. Modules — static filter
  const moduleResults: ModuleResult[] = MODULES.filter(
    (m) =>
      m.label.toLowerCase().includes(lower) ||
      m.description.toLowerCase().includes(lower),
  )
    .slice(0, 5)
    .map((m) => ({
      kind: 'module',
      id: m.id,
      title: m.label,
      subtitle: m.description,
      href: m.route,
    }));

  // 1b. Features / sub-pages — find by what you want to DO, filtered to enabled modules.
  const featureResults: FeatureResult[] = matchFeatures(q)
    .filter((f) => isModuleEnabled(f.moduleId))
    .map((f) => ({
      kind: 'feature',
      id: f.id,
      title: f.title,
      subtitle: f.subtitle,
      href: f.href,
    }));

  // 2–4. DB queries in parallel
  const userEmail = gate.user.email ?? '';

  const [convRows, promptRows, fileRows] = await Promise.all([
    // 2. Conversations scoped to the authenticated user
    db
      .select({ id: chatConversations.id, title: chatConversations.title })
      .from(chatConversations)
      .where(
        and(
          ilike(chatConversations.title, `%${q}%`),
          eq(chatConversations.userId, userEmail),
        ),
      )
      .limit(5),

    // 3. Prompt library
    db
      .select({ id: promptLibrary.id, title: promptLibrary.title, content: promptLibrary.content })
      .from(promptLibrary)
      .where(ilike(promptLibrary.title, `%${q}%`))
      .limit(5),

    // 4. Chat documents as "files"
    db
      .select({ id: chatDocuments.id, name: chatDocuments.name, kind: chatDocuments.kind })
      .from(chatDocuments)
      .where(ilike(chatDocuments.name, `%${q}%`))
      .limit(5),
  ]);

  const conversationResults: ConversationResult[] = convRows.map((r) => ({
    kind: 'conversation',
    id: r.id,
    title: r.title,
    href: '/chat',
  }));

  const promptResults: PromptResult[] = promptRows.map((r) => ({
    kind: 'prompt',
    id: r.id,
    title: r.title,
    subtitle: r.content.slice(0, 60),
    href: '/prompts',
  }));

  const fileResults: FileResult[] = fileRows.map((r) => ({
    kind: 'file',
    id: r.id,
    title: r.name,
    subtitle: r.kind,
    href: '/storage',
  }));

  const results: SearchResult[] = [
    ...moduleResults,
    ...featureResults,
    ...conversationResults,
    ...promptResults,
    ...fileResults,
  ];

  return NextResponse.json({ results });
}
