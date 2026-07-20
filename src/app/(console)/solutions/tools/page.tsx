import { redirect } from 'next/navigation';
import {
  contextualDestination,
  contextualModule,
  defaultContextualDestination,
} from '@/modules/contextual-navigation';

/** Preserve old bookmarks once, then land on the canonical level-3 route. */
export default async function ToolsRoot({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ tab?: string; view?: string; q?: string; cat?: string }>;
}>) {
  const { tab, view, q, cat } = await searchParams;
  const module = contextualModule('solutions-tools');
  const destination =
    contextualDestination(module, view ?? tab) ?? defaultContextualDestination(module);
  const filters = new URLSearchParams();
  if (destination.id === 'catalog') {
    if (q) filters.set('q', q);
    if (cat) filters.set('cat', cat);
  }
  const query = filters.toString();
  redirect(query ? `${destination.route}?${query}` : destination.route);
}
