import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

// Session-check endpoint for the edge (Caddy forward_auth). Returns 200 when the
// caller has a valid console session cookie, 401 otherwise — so every public route
// can be gated behind the console's OWN login (no hosted IdP page).
export async function GET(): Promise<Response> {
  const session = await auth();
  return new Response(null, { status: session?.user ? 200 : 401 });
}
