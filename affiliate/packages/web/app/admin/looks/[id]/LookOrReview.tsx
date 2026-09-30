'use client';

import { useEffect, useState } from 'react';
import { LookEditor } from '@/components/admin/celebrity/LookEditor';
import { getToken } from '@/lib/api';
import { MatchReview } from './MatchReview';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A live look (a uuid, signed in) opens the outfit editor; the local board's TEST looks keep their match review. */
export function LookOrReview({ id }: { id: string }) {
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => setLive(UUID.test(id) && !!getToken()), [id]);
  if (live === null) return null;
  return live ? <LookEditor id={id} /> : <MatchReview id={id} />;
}
