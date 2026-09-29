import type { Metadata } from 'next';
import { DevSignIn } from '@/components/marketing/DevSignIn';

export const metadata: Metadata = {
  title: 'Log in',
  robots: { index: false, follow: false },
};

/**
 * Dev sign-in until an identity provider lands: the API token (the JWT stub)
 * and an optional publisher id, saved under lib/api.ts's localStorage keys
 * (paparazzi_token / paparazzi_publisher_id).
 */
export default function LoginPage() {
  return <DevSignIn />;
}
