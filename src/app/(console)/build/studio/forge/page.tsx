import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Forge is no longer a separate surface — it's the CHAT mode of the one Studio builder. This route
// is kept so existing links/bookmarks land on the unified builder in chat mode.
export default function StudioForgeRedirect() {
  redirect('/solutions/apps/new?mode=chat');
}
