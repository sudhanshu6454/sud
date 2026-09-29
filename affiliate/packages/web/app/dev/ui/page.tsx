import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Gallery } from './Gallery';

export const metadata: Metadata = { title: 'UI gallery (dev)', robots: { index: false, follow: false } };

/** Dev-only gallery of every UI primitive and state. 404 in production builds. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Gallery />;
}
