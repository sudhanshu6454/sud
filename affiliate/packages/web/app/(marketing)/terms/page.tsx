import type { Metadata } from 'next';
import { LegalStub } from '@/components/shell/LegalStub';

export const metadata: Metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <LegalStub title="Terms of use">
      <p>Afflino&apos;s terms of use are being prepared. They will be published here before Afflino launches.</p>
    </LegalStub>
  );
}
