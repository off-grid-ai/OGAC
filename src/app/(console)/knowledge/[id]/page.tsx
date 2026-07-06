import { ArrowLeft, Books } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { CollectionDocuments } from '@/components/knowledge/CollectionDocuments';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireModuleForUser } from '@/lib/module-access';
import { getCollection, listCollections, listDocuments } from '@/lib/org-knowledge';

export const dynamic = 'force-dynamic';

// Knowledge collection DETAIL — the deep view behind one collection: its metadata, role allow-list,
// and its documents (a real sub-resource, upload/index + delete). Reached by clicking a collection
// on the Knowledge page (URL-driven, deep-linkable). Visibility is role-gated the same way the list
// is: a user only reaches a collection their role may retrieve; admins manage documents.
export default async function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('knowledge');
  const { id } = await params;
  const session = await auth();
  const role = session?.user?.role ?? 'viewer';
  const isAdmin = role === 'admin';

  const collection = await getCollection(id);
  if (!collection) notFound();

  // Enforce the same permission-aware visibility as the list — a non-admin can only view a
  // collection their role is allowed to retrieve.
  if (!isAdmin) {
    const visible = await listCollections(role);
    if (!visible.some((c) => c.id === id)) notFound();
  }

  const docs = await listDocuments(id);
  const documents = docs.map((d) => ({
    id: d.id,
    name: d.name,
    size: d.size,
    kind: d.kind,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : d.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Books className="size-5" />
        </div>
        <div>
          <Link
            href="/knowledge"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Organization Knowledge
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">{collection.name}</h1>
          {collection.description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{collection.description}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="shadow-sm lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Allowed roles
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {collection.allowedRoles.length === 0 ? (
                  <Badge variant="secondary">Everyone</Badge>
                ) : (
                  collection.allowedRoles.map((r) => (
                    <Badge key={r} variant="outline">
                      {r}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Documents
              </div>
              <div className="mt-1 text-foreground">{documents.length}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Created by
              </div>
              <div className="mt-1 text-muted-foreground">{collection.createdBy}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Documents</CardTitle>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? 'Index text documents into this collection — each is chunked and embedded on-prem.'
                : 'Documents indexed into this collection. Ask them via chat with Org knowledge on.'}
            </p>
          </CardHeader>
          <CardContent>
            <CollectionDocuments collectionId={id} documents={documents} isAdmin={isAdmin} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
