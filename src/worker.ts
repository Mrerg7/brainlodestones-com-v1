/**
 * Edge handler for brainlodestones.com.
 *
 * 1. Canonical host enforcement — http/www/index.html variants 301 to
 *    https://brainlodestones.com/... in a single hop. Trailing-slash redirects only
 *    fire when the destination page exists (avoids redirect→404 that GSC reports as
 *    "Page with redirect"). /404* paths return a real 404 (noindex).
 * 2. POST /api/inquiry — validates and stores domain inquiries in Workers KV.
 * 3. /favicon.ico is rewritten to /favicon.svg (200) instead of a redirect.
 * 4. Injects the Cloudflare Web Analytics beacon into HTML when CF_BEACON_TOKEN is set.
 * 5. Adds baseline security headers (incl. HSTS) to every response.
 */
const CANONICAL_ORIGIN = 'https://brainlodestones.com';
const CANONICAL_HOST = 'brainlodestones.com';
const NOT_FOUND_PATHS = new Set(['/404', '/404/', '/404.html']);
const INQUIRY_PATH = '/api/inquiry';
const FAVICON_ICO_PATH = '/favicon.ico';
const FAVICON_SVG_PATH = '/favicon.svg';

const MAX_BODY_BYTES = 10_000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const INQUIRY_TTL_SECONDS = 60 * 60 * 24 * 365;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BEACON_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,}$/;
const INDEX_HTML_SUFFIX = /\/index\.html\/?$/i;
/** Matches trailing /index or /index/ (Assets can soft-serve these as the parent page). */
const INDEX_ALIAS_SUFFIX = /\/index\/?$/i;

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: { Location: location, ...SECURITY_HEADERS },
  });
}

function logError(message: string, detail: unknown): void {
  console.error(JSON.stringify({ msg: message, detail: String(detail) }));
}

function harden(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  // Assets-layer 404s (unknown paths) never see the /404.html header rule.
  if (response.status === 404) headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function collapseIndexAliases(pathname: string): string {
  let path = pathname;
  if (INDEX_HTML_SUFFIX.test(path)) {
    path = path.replace(INDEX_HTML_SUFFIX, '/');
  }
  // /blog/index and /blog/index/ soft-serve the parent page under Assets —
  // collapse them to the canonical directory so GSC does not see extras.
  if (INDEX_ALIAS_SUFFIX.test(path)) {
    path = path.replace(INDEX_ALIAS_SUFFIX, '/');
  }
  if (path.length === 0) path = '/';
  return path;
}

function needsTrailingSlash(pathname: string): boolean {
  return (
    !NOT_FOUND_PATHS.has(pathname) &&
    pathname !== '/' &&
    pathname !== INQUIRY_PATH &&
    pathname !== FAVICON_ICO_PATH &&
    !pathname.endsWith('/') &&
    !/\.\w+$/.test(pathname)
  );
}

type CanonicalPlan = {
  /** Fully normalized canonical URL (apex https, no index.html, trailing slash). */
  canonical: URL;
  /** True when host or protocol differs from the canonical origin. */
  hostChanged: boolean;
  /** True when /index.html was collapsed into a directory path. */
  indexCollapsed: boolean;
  /** True when a trailing slash was appended to an extensionless path. */
  slashAdded: boolean;
};

function planCanonical(request: Request): CanonicalPlan {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const isSiteHost =
    hostname === CANONICAL_HOST || hostname === `www.${CANONICAL_HOST}`;
  // Only force https/apex for the real site hosts — leave localhost and
  // workers.dev previews alone so local/dev URLs stay usable.
  const hostChanged =
    hostname === `www.${CANONICAL_HOST}` || (isSiteHost && url.protocol === 'http:');

  // Site hosts always normalize onto the public apex origin. Localhost and
  // workers.dev keep their own origin so path-only redirects stay on-preview.
  const origin = isSiteHost ? CANONICAL_ORIGIN : url.origin;
  const canonical = new URL(url.pathname + url.search, origin);
  const beforeIndex = canonical.pathname;
  canonical.pathname = collapseIndexAliases(beforeIndex);
  const indexCollapsed = canonical.pathname !== beforeIndex;

  let slashAdded = false;
  if (needsTrailingSlash(canonical.pathname)) {
    canonical.pathname += '/';
    slashAdded = true;
  }

  return { canonical, hostChanged, indexCollapsed, slashAdded };
}

async function assetExists(env: Env, absoluteUrl: string, request: Request): Promise<boolean> {
  try {
    const response = await env.ASSETS.fetch(new Request(absoluteUrl, request));
    return response.status !== 404;
  } catch (error) {
    logError('asset_exists_probe_failed', error);
    // On probe failure, allow the redirect so real pages stay reachable.
    return true;
  }
}

async function notFoundResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const assetResponse = await env.ASSETS.fetch(
    new Request(new URL('/404.html', url.origin), request),
  );
  return harden(
    new Response(assetResponse.body, {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex',
        'Cache-Control': 'no-store',
      },
    }),
  );
}

async function faviconResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const assetResponse = await env.ASSETS.fetch(
    new Request(new URL(FAVICON_SVG_PATH, url.origin), request),
  );
  const headers = new Headers(assetResponse.headers);
  headers.set('Content-Type', 'image/svg+xml; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=86400');
  return harden(
    new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    }),
  );
}

function field(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function handleInquiry(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return json({ ok: false, error: 'JSON body required' }, 415);
  }

  const declared = Number(request.headers.get('content-length') ?? 'NaN');
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Payload too large' }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch (error) {
    logError('inquiry_invalid_json', error);
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return json({ ok: false, error: 'Invalid payload' }, 400);
  }

  const input = parsed as Record<string, unknown>;
  const source = field(input.source, 40) || 'form';
  const name = field(input.name, 120);
  const email = field(input.email, 254);
  const phone = field(input.phone, 40);
  const intendedUse = field(input.intendedUse, 160);
  const message = field(input.message, 4000);
  const honeypot = field(input.website, 200);

  // Honeypot filled in => bot. Acknowledge without storing.
  if (honeypot) return json({ ok: true });

  if (!EMAIL_PATTERN.test(email)) {
    return json({ ok: false, error: 'A valid email address is required.' }, 400);
  }
  if (source !== 'exit-intent' && name.length < 2) {
    return json({ ok: false, error: 'Please enter your name.' }, 400);
  }
  if (source === 'form' && intendedUse.length === 0) {
    return json({ ok: false, error: 'Please choose an intended use.' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const rateKey = `rate:${ip}`;

  try {
    const previous = await env.INQUIRIES.get(rateKey);
    const age = previous ? Date.now() - Number(previous) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(age) && age < RATE_LIMIT_WINDOW_MS) {
      return json(
        { ok: false, error: 'Please wait a moment before sending another message.' },
        429,
      );
    }
  } catch (error) {
    // A failed throttle read must not block a legitimate inquiry.
    logError('inquiry_rate_check_failed', error);
  }

  const id = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  const record = {
    id,
    receivedAt,
    source,
    name,
    email,
    phone,
    intendedUse,
    message,
    ip,
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
  };

  try {
    await env.INQUIRIES.put(`inquiry:${receivedAt}:${id}`, JSON.stringify(record), {
      expirationTtl: INQUIRY_TTL_SECONDS,
    });
    await env.INQUIRIES.put(rateKey, String(Date.now()), { expirationTtl: 60 });
  } catch (error) {
    logError('inquiry_store_failed', error);
    return json(
      { ok: false, error: 'Could not save your inquiry. Please email us directly.' },
      502,
    );
  }

  return json({ ok: true });
}

/**
 * Injects the Cloudflare Web Analytics beacon before </body> on HTML responses.
 * Passes the original bytes through untouched if the body is not plain HTML
 * (e.g. a still-compressed payload), so a rewrite can never corrupt a page.
 */
async function injectBeacon(response: Response, token: string): Promise<Response> {
  if (response.status !== 200) return response;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return response;
  if (!BEACON_TOKEN_PATTERN.test(token)) return response;

  const buffer = await response.arrayBuffer();
  const html = new TextDecoder().decode(buffer);

  if (!/<\/body>/i.test(html)) {
    return new Response(buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const beacon =
    '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ' +
    `data-cf-beacon='{"token":"${token}"}'></script>`;
  const rewritten = html.replace(/<\/body>/i, `${beacon}</body>`);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  headers.delete('content-md5');

  return new Response(rewritten, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === INQUIRY_PATH) {
      return handleInquiry(request, env);
    }

    if (NOT_FOUND_PATHS.has(url.pathname)) {
      return notFoundResponse(request, env);
    }

    // Serve favicon.ico as the SVG without a redirect (stops GSC "Page with redirect").
    if (url.pathname === FAVICON_ICO_PATH) {
      const plan = planCanonical(request);
      if (plan.hostChanged) {
        return redirect(new URL(FAVICON_ICO_PATH, CANONICAL_ORIGIN).toString());
      }
      return faviconResponse(request, env);
    }

    const plan = planCanonical(request);
    const needsRedirect = plan.hostChanged || plan.indexCollapsed || plan.slashAdded;

    if (needsRedirect) {
      // Never 301 into a 404 — unknown paths return noindex 404 in one response.
      const destinationIsPage =
        plan.canonical.pathname === '/' || plan.canonical.pathname.endsWith('/');
      if (destinationIsPage && plan.canonical.pathname !== '/') {
        const exists = await assetExists(env, plan.canonical.toString(), request);
        if (!exists) {
          return notFoundResponse(request, env);
        }
      }
      return redirect(plan.canonical.toString());
    }

    let response = await env.ASSETS.fetch(request);

    const beaconToken: string = env.CF_BEACON_TOKEN;
    if (beaconToken) {
      try {
        response = await injectBeacon(response, beaconToken);
      } catch (error) {
        logError('beacon_inject_failed', error);
      }
    }

    return harden(response);
  },
} satisfies ExportedHandler<Env>;
