import type { Metadata } from 'next';
import { LegalStub } from '@/components/shell/LegalStub';

export const metadata: Metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <LegalStub title="Contact">
      <p>Contact details are being prepared. They will be published here before Afflino launches.</p>
    </LegalStub>
  );
}
