import type { Metadata } from 'next';
import { LegalStub } from '@/components/shell/LegalStub';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <LegalStub title="Privacy notice">
      <p>Afflino&apos;s privacy notice is being prepared. It will be published here before Afflino launches.</p>
    </LegalStub>
  );
}
