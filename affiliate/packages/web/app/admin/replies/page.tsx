import type { Metadata } from 'next';
import { CommentRepliesScreen } from '@/components/admin/celebrity/CommentRepliesScreen';

export const metadata: Metadata = { title: 'Comment replies' };

/** Comment replies: keyword rules per post, the exact private reply, on / off, accounts, the latest events. */
export default function AdminRepliesPage() {
  return <CommentRepliesScreen />;
}
