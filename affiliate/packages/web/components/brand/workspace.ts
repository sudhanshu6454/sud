'use client';

/*
 * The brand workspace the page is in: the brand's own (no parameter) or an
 * agency client's (/brand?workspace=<client id>, 3e). Same rule as
 * app/brand/BrandShell.tsx: an unknown id falls back to the brand's own
 * workspace. Every in-page link goes through `href()` (withWorkspace) so an
 * agency stays in the client's workspace.
 */

import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { withWorkspace } from '@/components/shell/areas';
import { DEMO_AGENCY_CLIENTS, DEMO_BRAND } from '@/lib/demo/afflino';

export interface BrandWorkspace {
  /** The client id when an agency is in a client's workspace; null for the brand's own. */
  workspace: string | null;
  /** localStorage partition: the client id or "own". */
  key: string;
  /** The brand's display name (sidebar account, eyebrows, preview card). */
  name: string;
  category: string;
  /** withWorkspace(path) for this workspace. */
  href: (path: string) => string;
}

export function useBrandWorkspace(): BrandWorkspace {
  const params = useSearchParams();
  const requested = params?.get('workspace') ?? null;
  const client = requested ? DEMO_AGENCY_CLIENTS.find((c) => c.id === requested) : undefined;
  const workspace = client ? client.id : null;
  const href = useCallback((path: string) => withWorkspace(path, workspace), [workspace]);
  return useMemo(
    () => ({
      workspace,
      key: workspace ?? 'own',
      name: client ? client.name : DEMO_BRAND.name,
      category: client ? client.category : DEMO_BRAND.category,
      href,
    }),
    [workspace, client, href],
  );
}
