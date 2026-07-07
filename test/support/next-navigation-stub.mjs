// Test-only stub for `next/navigation`. Some @/lib modules (e.g. module-access) import
// server-only navigation helpers (`notFound`, `redirect`) that Next resolves via its own tooling
// but that node --test's ESM resolver can't (Next ships no `./navigation` exports entry). The
// integration tests only exercise the DB-backed store functions, never a navigation code path, so a
// throwing stub is sufficient — if a test ever DID hit one, it would fail loudly rather than silently.
export function notFound() {
  throw new Error('notFound() called in a test — not a navigable context');
}
export function redirect(url) {
  throw new Error(`redirect(${url}) called in a test — not a navigable context`);
}
export function permanentRedirect(url) {
  throw new Error(`permanentRedirect(${url}) called in a test — not a navigable context`);
}
export const useRouter = () => ({});
export const useSearchParams = () => new URLSearchParams();
export const usePathname = () => '/';
export const useParams = () => ({});
