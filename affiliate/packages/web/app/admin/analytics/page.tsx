import type { Metadata } from 'next';
import { AnalyticsScreen } from '@/components/admin/celebrity/AnalyticsScreen';

export const metadata: Metadata = { title: 'Analytics' };

/** Click analytics per celebrity, look, piece, page, link, surface and day (the hourly rollups), with CSV export. */
export default function AdminAnalyticsPage() {
  return <AnalyticsScreen />;
}
