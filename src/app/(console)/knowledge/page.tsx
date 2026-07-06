import Link from 'next/link';
import { auth } from '@/auth';
import { CreateCollectionButton } from '@/components/knowledge/CreateCollectionButton';
import { ManageCollection } from '@/components/knowledge/ManageCollection';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireModuleForUser } from '@/lib/module-access';
import { listCollections, listDocuments } from '@/lib/org-knowledge';

export const dynamic = 'force-dynamic';

// Organization-wide knowledge base — the on-prem "Ask Your Org". Admins curate collections, set
// their role allow-lists, and index documents; every user sees only the collections their role may
// retrieve. Chat pulls from these permission-aware via the stream route's orgKnowledge flag.
export default async function KnowledgePage() {
  await requireModuleForUser('knowledge');
  const session = await auth();
  const role = session?.user?.role ?? 'viewer';
  const isAdmin = role === 'admin';

  const collections = await listCollections(role);
  const docCounts = await Promise.all(collections.map((c) => listDocuments(c.id)));

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Organization Knowledge</CardTitle>
            <CardDescription>
              The org-shared corpus retrieved in <strong>chat</strong>: an admin-curated set of
              collections, indexed on-prem via the gateway and retrieved permission-aware with
              citations. Turn on &ldquo;Org knowledge&rdquo; in chat to ask it.{' '}
              <Link href="/brain?view=knowledge" className="text-primary underline-offset-4 hover:underline">
                Managing the docs your agents/router retrieve from? → Brain → Agent knowledge base
              </Link>
            </CardDescription>
          </div>
          {isAdmin && <CreateCollectionButton />}
        </CardHeader>
        <CardContent>
          {collections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? 'No collections yet. Create one to start curating the org knowledge base.'
                : 'No knowledge collections are available to your role yet.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collection</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Documents</TableHead>
                  {isAdmin && <TableHead className="text-right">Manage</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/knowledge/${c.id}`} className="hover:text-primary hover:underline">
                        <div className="font-medium">{c.name}</div>
                        {c.description && (
                          <div className="text-xs text-muted-foreground">{c.description}</div>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {c.allowedRoles.length === 0 ? (
                        <Badge variant="secondary">Everyone</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {c.allowedRoles.map((r) => (
                            <Badge key={r} variant="outline">
                              {r}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{docCounts[i].length}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <ManageCollection
                          collection={{ id: c.id, name: c.name }}
                          documents={docCounts[i].map((d) => ({
                            id: d.id,
                            name: d.name,
                            size: d.size,
                          }))}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
