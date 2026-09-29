/**
 * Site identity. NEXT_PUBLIC_SITE_NAME names the deployment (read at runtime,
 * every route renders on demand); the default is the product name. The
 * wordmark in the logo is always the lowercase "afflino" (components/ui/Logo).
 */
export const DEFAULT_SITE_NAME = 'Afflino';

export function siteName(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_NAME;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_SITE_NAME;
}
