// Embed reachability + framing check. Several console surfaces embed OSS admin UIs in an iframe
// (OpenSearch Dashboards, Langfuse, Superset, Marquez-web). If the target is down, or refuses to be
// framed (X-Frame-Options: DENY/SAMEORIGIN, or a restrictive CSP frame-ancestors), a bare iframe
// renders blank with no explanation. This probes the target server-side and tells the UI whether
// to frame it or fall back to an "open in new tab" link.

export interface EmbedProbe {
  url: string;
  reachable: boolean;
  frameable: boolean;
  status?: number;
  reason?: string;
}

function blockedByXfo(xfo: string | null): boolean {
  if (!xfo) return false;
  const v = xfo.toLowerCase();
  return v.includes('deny') || v.includes('sameorigin');
}

// A CSP frame-ancestors of 'none' (or that omits us) blocks framing. We can't know our own origin
// reliably server-side for every deploy, so treat an explicit 'none' as blocking and otherwise
// assume permissive — the reachability signal is the primary value here.
function blockedByCsp(csp: string | null): boolean {
  if (!csp) return false;
  const m = /frame-ancestors([^;]*)/i.exec(csp);
  if (!m) return false;
  return /'none'/i.test(m[1]);
}

// Probe one embed target. HEAD first (cheap); some servers reject HEAD, so fall back to GET. Never
// throws — an unreachable target is a normal, expected state.
// eslint-disable-next-line complexity
export async function probeEmbed(url: string | undefined): Promise<EmbedProbe | null> {
  if (!url) return null;
  const attempt = async (method: string): Promise<Response> =>
    fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(3500) });
  try {
    let res: Response;
    try {
      res = await attempt('HEAD');
      if (res.status === 405 || res.status === 501) res = await attempt('GET');
    } catch {
      res = await attempt('GET');
    }
    const xfo = res.headers.get('x-frame-options');
    const csp = res.headers.get('content-security-policy');
    const blocked = blockedByXfo(xfo) || blockedByCsp(csp);
    const reachable = res.status < 500;
    return {
      url,
      reachable,
      frameable: reachable && !blocked,
      status: res.status,
      reason: blocked ? `framing blocked (${xfo ?? 'CSP frame-ancestors'})` : undefined,
    };
  } catch (e) {
    return { url, reachable: false, frameable: false, reason: (e as Error).message };
  }
}
