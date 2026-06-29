export const SITE_URL = 'https://brainlodestones.com';
export const SITE_NAME = 'brainlodestones.com';
export const ACQUISITION_EMAIL = 'sales@desertrich.com';

/** Cloudflare Images CDN — hero / OG */
export const HERO_IMAGE_URL =
  'https://imagedelivery.net/-sPAUAWeA405NiWJ0SNIQA/e63035ee-24df-4fef-e0db-88084e819200/public';

/** Cloudflare Images CDN — TMS therapy visual */
export const TMS_IMAGE_URL =
  'https://imagedelivery.net/-sPAUAWeA405NiWJ0SNIQA/d373b597-c040-4863-7daf-35e157f90d00/public';

/** Cloudflare Images CDN — brand logo mock */
export const LOGO_MOCK_URL =
  'https://imagedelivery.net/-sPAUAWeA405NiWJ0SNIQA/40cdbed1-4098-4924-fcec-2ed505b18d00/public';

export const DISCLAIMER =
  'This website is for demonstration and informational purposes only. It does not constitute an offer of services, a commitment to deploy, or a guarantee of outcomes. All statistics, projections, and references to specific technologies are based on publicly available information as of the date shown and are subject to change.';

export function acquisitionMailto(subject?: string, body?: string): string {
  const params = new URLSearchParams();
  params.set(
    'subject',
    subject ?? 'Domain acquisition inquiry: brainlodestones.com',
  );
  if (body) params.set('body', body);
  return `mailto:${ACQUISITION_EMAIL}?${params.toString()}`;
}
