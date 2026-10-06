/**
 * Edge handler for brainlodestones.com.
 *
 * 1. Canonical host enforcement — http/www/index.html/no-trailing-slash variants 301 to
 *    https://brainlodestones.com/ in a single hop; /404* paths return a real 404 (noindex)
 *    instead of redirect loops that GSC reports as Not found (404).
 * 2. POST /api/inquiry — validates and stores domain inquiries in Workers KV.
 * 3. Injects the Cloudflare Web Analytics beacon into HTML when CF_BEACON_TOKEN is set.
 * 4. Adds baseline security headers (incl. HSTS) to every response.
 */
const CANONICAL_ORIGIN = 'https://brainlodestones.com';
const CANONICAL_HOST = 'brainlodestones.com';
const NOT_FOUND_PATHS = new Set(['/404', '/404/', '/404.html']);
const INQUIRY_PATH = '/api/inquiry';

const MAX_BODY_BYTES = 10_000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const INQUIRY_TTL_SECONDS = 60 * 60 * 24 * 365;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BEACON_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,}$/;

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

function getCanonicalRedirect(request: Request): string | null {
  const url = new URL(request.url);
  const canonical = new URL(url.pathname + url.search, CANONICAL_ORIGIN);
  let needsRedirect = false;

  if (url.protocol === 'http:' || url.hostname.toLowerCase() === `www.${CANONICAL_HOST}`) {
    needsRedirect = true;
  }

  if (canonical.pathname === '/index.html' || canonical.pathname === '/index.html/') {
    canonical.pathname = '/';
    needsRedirect = true;
  }

  if (
    !NOT_FOUND_PATHS.has(canonical.pathname) &&
    canonical.pathname !== '/' &&
    canonical.pathname !== INQUIRY_PATH &&
    !canonical.pathname.endsWith('/') &&
    !/\.\w+$/.test(canonical.pathname)
  ) {
    canonical.pathname += '/';
    needsRedirect = true;
  }

  return needsRedirect ? canonical.toString() : null;
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

    const redirectUrl = getCanonicalRedirect(request);
    if (redirectUrl) {
      return redirect(redirectUrl);
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
