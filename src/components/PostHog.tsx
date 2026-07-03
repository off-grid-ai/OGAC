'use client';

import Script from 'next/script';

// PostHog product analytics — the SAME project as the marketing site (../website): token
// phc_u7cn… on us.i.posthog.com. Loaded via the official snippet so no npm dependency and
// identical behavior to the site. Token overridable via NEXT_PUBLIC_POSTHOG_KEY.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? 'phc_u7cnV9P3cTovsfPTE2nhB7g5G4qdtZJ5dgMzv7ryfKWs';
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

export function PostHog() {
  if (!KEY) return null;
  return (
    <Script id="posthog-init" strategy="afterInteractive">
      {`!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture identify register register_once unregister getFeatureFlag isFeatureEnabled reloadFeatureFlags group reset setPersonProperties opt_in_capturing opt_out_capturing".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
      posthog.init('${KEY}', { api_host: '${HOST}', defaults: '2026-01-30', person_profiles: 'identified_only' });`}
    </Script>
  );
}
