// PostHog init as a raw <script> string, for HTML that is NOT rendered through the React root
// layout (where <PostHog/> lives) — e.g. the Scalar API-reference route handler at /docs/api, which
// returns its own HTML document and so never picks up the layout's analytics. Injecting this into
// that document's <head> is how we get "PostHog everywhere," including the API reference.
//
// Same project/token as src/components/PostHog.tsx and the marketing site. CSP already allows the
// inline script + us(-assets).i.posthog.com (next.config.mjs).
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? 'phc_u7cnV9P3cTovsfPTE2nhB7g5G4qdtZJ5dgMzv7ryfKWs';
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

/** The PostHog bootstrap as a `<script>…</script>` string, or '' when no key is configured. */
export function posthogHeadTag(): string {
  if (!KEY) return '';
  return `<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture identify register register_once unregister getFeatureFlag isFeatureEnabled reloadFeatureFlags group reset setPersonProperties opt_in_capturing opt_out_capturing".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init(${JSON.stringify(KEY)},{api_host:${JSON.stringify(HOST)},defaults:'2026-01-30',person_profiles:'identified_only',disable_surveys:true});</script>`;
}
