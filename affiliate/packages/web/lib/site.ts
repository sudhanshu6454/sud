/**
 * Site identity. NEXT_PUBLIC_SITE_NAME names the shop (per deployment); the
 * default is the platform's own working name, not a brand for any property.
 */
export const DEFAULT_SITE_NAME = 'Paparazzi Commerce';

export function siteName(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_NAME;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_SITE_NAME;
}
