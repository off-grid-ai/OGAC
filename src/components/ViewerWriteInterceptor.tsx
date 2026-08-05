'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useIsViewer } from '@/components/ViewerModeProvider';
import { methodOf, shouldBlockViewerRequest } from '@/lib/viewer-fetch-policy';
import { VIEWER_FORBIDDEN_BODY, VIEWER_ROLE } from '@/lib/viewer-policy';

// Installs the read-only viewer's client-side write short-circuit. Mounted once, inside
// ViewerModeProvider; a no-op for every other role.
//
// It exists because the console has 263 raw `fetch(` call sites and no shared client helper, so the
// only place a single rule can live is `window.fetch`. See viewer-fetch-policy.ts for why the decision
// is shared with the server rather than reimplemented, and for the sign-out exemption.
//
// Two things it deliberately does NOT do:
//   • It does not let the request go and then explain the failure. The request never leaves the
//     browser, so a viewer cannot generate load or audit noise by hammering a disabled button.
//   • It does not invent a friendlier success. It returns the SAME 403 body the middleware returns, so
//     every component's existing error handling behaves exactly as it does against the real server —
//     no component learns a new contract, and nothing can mistake a block for a success.
//
// The visible improvement is the toast: one consistent, plain explanation in place of ~216 different
// generic failure messages ("Failed to add connector") that read as product defects.

const TOAST_ID = 'read-only-demo';
const TOAST_MESSAGE = 'This is a read-only demo';
const TOAST_DETAIL = 'You can explore every screen. Making changes needs a full account.';

export function ViewerWriteInterceptor(): null {
  const viewer = useIsViewer();

  useEffect(() => {
    if (!viewer) return;
    const original = window.fetch;
    // Guard against a double install (fast refresh, a remount, or a second provider in the tree):
    // wrapping a wrapper would stack toasts and make the restore below drop the wrong function.
    if ((original as { __viewerWrapped?: boolean }).__viewerWrapped) return;

    const wrapped: typeof window.fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = methodOf(init, input instanceof Request ? input.method : null);
      if (shouldBlockViewerRequest(VIEWER_ROLE, method, url, window.location.origin)) {
        // A shared id collapses a burst (a form that fires several writes) into one notice.
        toast.info(TOAST_MESSAGE, { id: TOAST_ID, description: TOAST_DETAIL });
        return new Response(JSON.stringify(VIEWER_FORBIDDEN_BODY), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      return original(input, init);
    };
    (wrapped as { __viewerWrapped?: boolean }).__viewerWrapped = true;
    window.fetch = wrapped;
    return () => {
      // Only restore if nothing else wrapped us in the meantime, so we never clobber another wrapper.
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, [viewer]);

  return null;
}
