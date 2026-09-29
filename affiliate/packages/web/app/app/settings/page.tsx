import type { Metadata } from 'next';
import { Settings } from '@/components/creator/settings/Settings';

export const metadata: Metadata = { title: 'Settings' };

/** Creator Settings & profile (2d): TEST demo data saved in this browser — no v1 endpoint (components/creator/settings). */
export default function AppSettingsPage() {
  return <Settings />;
}
