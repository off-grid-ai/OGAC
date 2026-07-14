// ─── App surface abstraction — PURE, zero-IO ──────────────────────────────────────────────────────
//
// The SAME running-app components (input form, run trace, cockpit dashboard, send-report) mount in
// two places: the authenticated console (admin API) and the org-gated shared link /app/<slug>
// (public-by-slug API). The only difference is which API base they call. This module is that seam:
// a plain descriptor of the endpoints, built one of two ways. Components take an `AppSurface` and
// never hard-code `/api/v1/admin/...` — so there is ONE component per view, two mounts, no dupes.

export type SurfaceKind = 'console' | 'shared';

export interface AppSurface {
  kind: SurfaceKind;
  /** POST here to start a run: body { input }. */
  runUrl: string;
  /** GET here to poll a run's status (append the runId). */
  runStatusBase: string;
  /** GET here for the cockpit dashboard data (live-or-sample). */
  dashboardUrl: string;
  /** POST here to send the report email now: body { to, note? }. */
  sendReportUrl: string;
  /** Where a "view customer" link points (detail route base; append the customerId). */
  customerHrefBase: string;
}

// The console (admin) surface — keyed by the app's id, behind the admin bearer/session.
export function consoleSurface(appId: string): AppSurface {
  const base = `/api/v1/admin/apps/${encodeURIComponent(appId)}`;
  return {
    kind: 'console',
    runUrl: `${base}/run`,
    runStatusBase: `/api/v1/admin/app-runs/`,
    dashboardUrl: `${base}/dashboard`,
    sendReportUrl: `${base}/send-report`,
    customerHrefBase: `/build/apps/${encodeURIComponent(appId)}/use/customers/`,
  };
}

// The shared-link surface — keyed by the published slug, org-gated at the page + route.
export function sharedSurface(slug: string): AppSurface {
  const base = `/api/v1/app/${encodeURIComponent(slug)}`;
  return {
    kind: 'shared',
    runUrl: `${base}/run`,
    runStatusBase: `${base}/runs/`,
    dashboardUrl: `${base}/dashboard`,
    sendReportUrl: `${base}/send-report`,
    customerHrefBase: `/app/${encodeURIComponent(slug)}/customers/`,
  };
}
