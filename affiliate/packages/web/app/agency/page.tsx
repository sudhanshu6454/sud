import type { Metadata } from 'next';
import { AgencyWorkspace } from '@/components/agency/AgencyWorkspace';

export const metadata: Metadata = { title: 'Agency' };

/** Agency workspace (3e): brand clients and the creator roster. TEST demo data (no agency endpoint in v1). */
export default function AgencyPage() {
  return <AgencyWorkspace />;
}
