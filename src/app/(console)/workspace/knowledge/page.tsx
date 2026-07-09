import { ArrowRight, Books } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { auth } from '@/auth';
import { CreateCollectionButton } from '@/components/knowledge/CreateCollectionButton';
import { QuickAddDocument } from '@/components/knowledge/QuickAddDocument';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireModuleForUser } from '@/lib/module-access';
import { listCollections, listDocuments } from '@/lib/org-knowledge';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Organization-wide knowledge base — the on-prem "Ask Your Org". Admins curate collections, set
// their role allow-lists, and index documents; every user sees only the collections their role may
// retrieve. Chat pulls from these permission-aware via the stream route's orgKnowledge flag.
//
// List → detail: each collection is a card that LINKS to its deep-linkable detail page
// (/workspace/knowledge/[id]) — the full view of its access, index status and documents. The card's
// quick-add button is the only Sheet, a convenience for indexing a doc without leaving the list; the
// collection itself always opens as a real route, never a modal.
export default async function KnowledgePage() {
  await requireModuleForUser('knowledge');
  const session = await auth();
  const role = session?.user?.role ?? 'viewer';
  const isAdmin = role === 'admin';

  const orgId = await currentOrgId();
  // Degrade gracefully: DB/store down → empty collection list rather than the whole-page error boundary.
  const collections = await listCollections(role, orgId).catch(() => []);
  const docCounts = await Promise.all(
    collections.map((c) => listDocuments(c.id, orgId).catch(() => [])),
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-lg font-semibold text-foreground">Organization Knowledge</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The org-shared corpus retrieved in <strong>chat</strong> and by your agents: an
            admin-curated set of collections, indexed on-prem via the gateway and retrieved
            permission-aware with citations. Turn on &ldquo;Org knowledge&rdquo; in chat to ask it.
          </p>
        </div>
        {isAdmin && <CreateCollectionButton />}
      </div>

      {collections.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {isAdmin
              ? 'No collections yet. Create one to start curating the org knowledge base.'
              : 'No knowledge collections are available to your role yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {collections.map((c, i) => (
            <Card
              key={c.id}
              className="group relative flex flex-col shadow-sm transition-colors hover:border-primary/50"
            >
              <CardHeader className="flex flex-row items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Books className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate text-base">
                    {/* The whole card is the way IN: this Link routes to the deep-linkable detail. */}
                    <Link
                      href={`/workspace/knowledge/${c.id}`}
                      className="after:absolute after:inset-0 hover:text-primary"
                    >
                      {c.name}
                    </Link>
                  </CardTitle>
                  {c.description ? (
                    <CardDescription className="mt-1 line-clamp-2">
                      {c.description}
                    </CardDescription>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">
                    {docCounts[i].length} {docCounts[i].length === 1 ? 'document' : 'documents'}
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  {c.allowedRoles.length === 0 ? (
                    <Badge variant="secondary">Everyone</Badge>
                  ) : (
                    c.allowedRoles.map((r) => (
                      <Badge key={r} variant="outline">
                        {r}
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-primary">
                    Open <ArrowRight className="size-3" />
                  </span>
                  {/* Quick add sits ABOVE the card's link (relative z) so it stays a convenience,
                      not the primary open path. */}
                  {isAdmin ? (
                    <div className="relative z-10">
                      <QuickAddDocument collectionId={c.id} collectionName={c.name} />
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
