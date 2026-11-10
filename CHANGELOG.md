# Changelog

All notable changes to brainlodestones.com are documented here.

## 2026-11-10 — Fix Search Console "Page with redirect"

### Fixed

- **Single-hop absolute redirects for every index alias** — the Worker now
  collapses `/blog/index.html`, `/blog/index`, `/blog/index/`, and the same
  patterns under other sections, to the trailing-slash directory in the same 301
  that enforces apex HTTPS. Previously only root `/index.html` was handled, so
  nested `index.html` URLs fell through to Assets and returned a relative
  `307 Location: /path/` (often as a second hop after www→apex).
- **No more redirect→404 chains** — trailing-slash / host normalization only 301s
  when the destination asset exists. Unknown paths like `/home` or `/about` now
  return a real noindex 404 instead of `301 → /home/` then 404 (GSC "Page with
  redirect").
- **`/favicon.ico` returns 200** — rewritten to the SVG favicon instead of a 301
  to `/favicon.svg`. Removes a high-frequency crawler redirect from coverage.
- **Host redirects scoped to the real site** — http→https and www→apex only apply
  on `brainlodestones.com` / `www.brainlodestones.com`, so localhost and
  workers.dev previews are no longer bounced to production.

### Infrastructure

- Removed `public/_redirects` rules that duplicated Worker logic with relative
  Locations (`/index.html`, `/favicon.ico`). Canonicalization lives entirely in
  `src/worker.ts`.

## 2026-10-06 — Comprehensive optimization pass (SEO, CRO, performance, mobile, security)

Deployed as Worker version `8b9bc64d-ec94-473b-86a7-7d9100426756`.
Previous production version (rollback point): `aa30c606-dbfb-426f-80eb-c192b2d6f2ab`.

### Added

- **Real inquiry backend** — `POST /api/inquiry` in `src/worker.ts`: JSON validation,
  length limits, honeypot spam trap, per-IP rate limiting (10s window), structured
  JSON error logging. Submissions are stored in Workers KV (`INQUIRIES` namespace,
  1-year TTL). The form previously faked success with a `setTimeout` and sent nothing.
- **Exit-intent capture** (`src/components/ExitIntent.astro`) — desktop-only,
  once per session, submits through the same endpoint with `source: "exit-intent"`.
- **Sticky mobile CTA bar** (`src/components/StickyCta.astro`) — "Make an offer" +
  "Email" on phones/tablets, 48px tap targets, with a bottom spacer so it never
  covers the footer.
- **Buyer FAQ section** (`#faq`) built from `src/lib/faq.ts` — single source of truth
  rendered on-page and emitted as `FAQPage` structured data.
- **Blog** at `/blog/` (Astro content collection) with three posts:
  - `/blog/premium-domain-valuation-framework/`
  - `/blog/naming-a-multi-site-tms-network/`
  - `/blog/how-domain-escrow-works/`
  Each with `BlogPosting` + `BreadcrumbList` schema, linked from the nav, footer,
  homepage ("Domain insights" cards), and cross-linked to each other.
- **Privacy Policy** (`/privacy/`) and **Terms of Use** (`/terms/`) — replaces the
  dead `href="#"` footer links and documents how inquiry data is handled.
- **Structured data**: added `WebSite`, `FAQPage`; homepage `Product` offer `url`
  now points at the canonical URL instead of a `mailto:`; image dimensions added.
- **Security headers**: `Strict-Transport-Security` (1 year, includeSubDomains),
  applied both in `public/_headers` and by the Worker on every response (including
  the JSON API and 404s). Unknown paths now return `X-Robots-Tag: noindex`.
- **Skip-to-content link** and `#main` landmarks.

### Performance

- Hero background is now a real `<img fetchpriority="high">` with `width`/`height`
  (was a CSS `background-image`, which the LCP algorithm cannot prioritize) plus a
  head preload hint; removed `background-attachment: fixed` repaint cost.
- Self-hosted variable fonts in `public/fonts/` (`Inter`, `Space Grotesk`, latin +
  latin-ext, `font-display: swap`) — eliminates two render-blocking third-party
  requests to Google Fonts. Cached `immutable` for 1 year via `_headers`.
- Added intrinsic `width`/`height` + `decoding="async"` to below-fold images (CLS).

### Mobile & accessibility

- Form inputs, selects, and textareas render at 16px (stops iOS focus zoom).
- All interactive targets raised to ≥48px (nav links, menu button, footer links,
  sticky bar, CTAs).
- Form labels now associated with their controls (`for`/`id`).
- Contrast fixes across footer, form notes, breadcrumbs, and legal pages.
- `scroll-padding-top` so anchored sections clear the fixed nav.

### SEO

- Title: `brainlodestones.com | Premium Domain for Sale | TMS Networks`.
- Meta description rewritten with availability + CTA (price intentionally not shown
  in on-page copy; `Product` schema still exposes the offer).
- Removed the ineffective `meta keywords` tag; corrected `og:image` dimensions.

### Fixed

- **Invalid HTML**: `index.astro` declared its `<script>` outside `<BaseLayout>`,
  so Astro emitted it *after* `</html>` (W3C error "Stray start tag script").
  Moved inside the layout tree.
- Footer `Privacy`/`Terms` links no longer point at `#`.
- Heading levels: success state `h4` → `h3`.
- Deprecated `z` import from `astro:content` → `astro/zod`.

### Infrastructure

- `wrangler.jsonc`: added `INQUIRIES` KV binding (free tier) and an optional
  `CF_BEACON_TOKEN` var for Cloudflare Web Analytics (empty = disabled).
- `package.json`: added `@astrojs/check` + `typescript`, new `npm run check` script.
- `wrangler types` regenerated (`worker-configuration.d.ts`, gitignored).

### Validation (pre-deploy)

- `npm run build` — 8 pages; `npm run check` and `npx tsc --noEmit` — 0 errors.
- W3C HTML validator: **0 errors** on all 7 indexable pages.
- Lighthouse (mobile emulation, Brave/Chromium): **Performance 100, Accessibility 100,
  Best Practices 100, SEO 100** — LCP 1.4s (target <2s), CLS 0, TBT 0ms.
- Endpoint matrix tested in `wrangler dev` and on production: 200/400/405/413/415/429
  for the API, 301 canonical redirects (http, www, `/index.html`, missing slash),
  404 for unknown paths. Test records removed from KV after verification.
- `wrangler tail` confirmed structured logging with zero exceptions.

### Manual follow-ups

1. **Google Search Console** — submit `https://brainlodestones.com/sitemap-index.xml`
   (URL Inspection → live test the homepage after the content change).
2. **Cloudflare Web Analytics** — copy the beacon token from
   Dashboard → Analytics & Logs → Web Analytics, paste into `CF_BEACON_TOKEN` in
   `wrangler.jsonc`, and redeploy. The Worker injects the beacon automatically.
3. **Backlink / PR outreach** — guest posts, digital PR, and directory listings
   cannot be automated from this repo; the new blog is the linkable asset.
4. **48-hour monitoring** — watch `wrangler tail`, the KV inquiry list, and Search
   Console coverage after deploy.

### Not applicable to this site

- Marketplace search, portfolio filters, and dark/light toggle: the site sells a
  single domain, so there is no inventory to search or filter; it is dark-only by design.
- Fabricated urgency counters and testimonials were deliberately not added — the
  market-stat bar and real trust signals (escrow, clean title, 24h response) carry
  the proof instead.
