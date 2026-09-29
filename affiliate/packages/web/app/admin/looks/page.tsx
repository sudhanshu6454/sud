import type { Metadata } from 'next';
import { LooksBoard } from './LooksBoard';

export const metadata: Metadata = { title: 'Looks' };

/** Editorial looks pipeline (was /console): local, TEST demo looks. */
export default function AdminLooksPage() {
  return <LooksBoard />;
}
