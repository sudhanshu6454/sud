import type { Metadata } from 'next';
import { StubPage } from '@/components/marketing/StubPage';
import { Button } from '@/components/ui';

export const metadata: Metadata = { title: 'Contact' };

/**
 * Honest stub ("Talk to sales →" lands here). No email address or phone
 * number exists yet, so none is printed.
 */
export default function ContactPage() {
  return (
    <StubPage
      eyebrow="Get in touch"
      title="Contact"
      action={
        <Button variant="primary" href="/join" arrow>
          Join the network
        </Button>
      }
    >
      <p>The contact channel will be published with the launch.</p>
      <p>Until then, you can still join the network.</p>
    </StubPage>
  );
}
