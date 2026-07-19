import { canonicalPath } from '../../src/modules/route-migrations.mjs';

const ERROR_BOUNDARY_PATTERNS = Object.freeze([
  /application error:\s*(?:a client-side|a server-side) exception/i,
  /something went wrong here/i,
  /this screen hit an error while loading/i,
  /internal server error/i,
]);

function normalizeRoute(route) {
  const withSlash = route.startsWith('/') ? route : `/${route}`;
  return withSlash.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

/**
 * Convert a page directory relative to src/app into its URL and retain whether it belongs to the
 * authenticated console route group. Route-group provenance is lost once parentheses are stripped,
 * so this decision must happen before route discovery returns strings to the crawler.
 */
export function pageDirectoryRecord(relativeDirectory) {
  const segments = relativeDirectory.split('/').filter(Boolean);
  const routeSegments = segments.filter((segment) => !/^\(.*\)$/.test(segment));
  return {
    route: normalizeRoute(routeSegments.join('/')),
    surface: segments.includes('(console)') ? 'console' : 'public',
  };
}

export function isCanonicalRoute(route) {
  const normalized = normalizeRoute(route);
  return canonicalPath(normalized) === normalized;
}

/**
 * Pick one canonical capture per filesystem route. Historical redirect aliases remain deployed for
 * old bookmarks, but they are not primary product surfaces and must not inflate visual coverage.
 */
export function selectCanonicalRouteRecords(records, { includePublic = true, only = [] } = {}) {
  const aliases = [];
  const selected = new Map();

  for (const record of records) {
    const normalized = { ...record, route: normalizeRoute(record.route) };
    if (!isCanonicalRoute(normalized.route)) {
      aliases.push({ ...normalized, canonicalRoute: canonicalPath(normalized.route) });
      continue;
    }
    if (!includePublic && normalized.surface === 'public') continue;
    if (only.length && !only.some((fragment) => normalized.route.includes(fragment))) continue;
    const previous = selected.get(normalized.route);
    // Prefer the authenticated console owner if an accidental duplicate route exists across groups.
    if (!previous || (previous.surface === 'public' && normalized.surface === 'console')) {
      selected.set(normalized.route, normalized);
    }
  }

  return {
    routes: [...selected.values()].sort((a, b) => a.route.localeCompare(b.route)),
    aliases: aliases.sort((a, b) => a.route.localeCompare(b.route)),
  };
}

export function resolveVisualAuth({ cli = {}, env = {}, file = {} } = {}) {
  const user = cli.user || env.OFFGRID_VISUAL_USER || env.USER_EMAIL || file.user || '';
  const password = cli.password || env.OFFGRID_VISUAL_PASSWORD || env.PASS || file.password || '';
  if (Boolean(user) !== Boolean(password)) {
    return { user: '', password: '', error: 'Both visual-test user and password are required.' };
  }
  return { user, password, error: '' };
}

export function batchItems(items, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error('batch size must be a positive integer');
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export function dynamicSegmentCoverage(segment) {
  return segment === '[destination]' ? 'all' : 'first';
}

export function pageFailureReasons({
  status = 0,
  bodyText = '',
  consoleErrors = [],
  pageErrors = [],
  captureError = '',
  layoutOverflowPx = 0,
  redirectedToSignin = false,
} = {}) {
  const reasons = [];
  if (!(status > 0 && status < 400))
    reasons.push(`navigation returned HTTP ${status || 'no-status'}`);
  if (redirectedToSignin) reasons.push('authenticated route redirected to sign-in');
  if (ERROR_BOUNDARY_PATTERNS.some((pattern) => pattern.test(bodyText))) {
    reasons.push('application error boundary rendered');
  }
  if (consoleErrors.length) reasons.push(`${consoleErrors.length} browser console error(s)`);
  if (pageErrors.length) reasons.push(`${pageErrors.length} uncaught page error(s)`);
  if (captureError) reasons.push(`screenshot capture failed: ${captureError}`);
  if (layoutOverflowPx > 1) reasons.push(`document overflows viewport by ${layoutOverflowPx}px`);
  return reasons;
}

export function visualGateExitCode(records) {
  return records.some((record) => record.ok === false) ? 1 : 0;
}
