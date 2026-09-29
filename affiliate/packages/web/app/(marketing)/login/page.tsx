import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Log in' };

/**
 * Placeholder — dev sign-in: paste the API token (the JWT stub,
 * localStorage paparazzi_token / paparazzi_publisher_id via lib/api.ts)
 * until a real identity provider lands.
 */
export default function LoginPage() {
  return <ScreenPlaceholder eyebrow="Dev sign-in" title="Log in" />;
}
