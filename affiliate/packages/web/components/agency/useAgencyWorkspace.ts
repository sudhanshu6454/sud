'use client';

/*
 * The agency workspace's browser state: the agency share %, demo invites
 * and demo pending clients (localStorage, AGENCY_STORAGE_KEYS). `ready` is
 * false until the stored values are read, so the share column shows
 * skeletons instead of a figure that is about to change.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AGENCY_INVITE_PLATFORMS } from '@/lib/demo/agency';
import {
  DEFAULT_AGENCY_SHARE_PCT,
  demoId,
  loadInvites,
  loadPendingClients,
  loadSharePct,
  saveInvites,
  savePendingClients,
  saveSharePct,
  type Invite,
  type PendingClient,
} from './agencyModel';

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function useAgencyWorkspace() {
  const [ready, setReady] = useState(false);
  const [sharePct, setSharePctState] = useState<number>(DEFAULT_AGENCY_SHARE_PCT);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [clients, setClients] = useState<PendingClient[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    const storage = browserStorage();
    setSharePctState(loadSharePct(storage));
    setInvites(loadInvites(storage, AGENCY_INVITE_PLATFORMS));
    setClients(loadPendingClients(storage));
    hydrated.current = true;
    setReady(true);
  }, []);

  const persist = useCallback((ok: boolean) => setSaveFailed(!ok), []);

  const setSharePct = useCallback(
    (pct: number) => {
      setSharePctState(pct);
      if (hydrated.current) persist(saveSharePct(browserStorage(), pct));
    },
    [persist],
  );

  const addInvite = useCallback(
    (invite: Omit<Invite, 'id' | 'createdAt'>) => {
      setInvites((list) => {
        const next = [...list, { ...invite, id: demoId('invite'), createdAt: new Date().toISOString() }];
        persist(saveInvites(browserStorage(), next));
        return next;
      });
    },
    [persist],
  );

  const removeInvite = useCallback(
    (id: string) => {
      setInvites((list) => {
        const next = list.filter((i) => i.id !== id);
        persist(saveInvites(browserStorage(), next));
        return next;
      });
    },
    [persist],
  );

  const addClient = useCallback(
    (client: Omit<PendingClient, 'id' | 'createdAt'>) => {
      setClients((list) => {
        const next = [...list, { ...client, id: demoId('client'), createdAt: new Date().toISOString() }];
        persist(savePendingClients(browserStorage(), next));
        return next;
      });
    },
    [persist],
  );

  const removeClient = useCallback(
    (id: string) => {
      setClients((list) => {
        const next = list.filter((c) => c.id !== id);
        persist(savePendingClients(browserStorage(), next));
        return next;
      });
    },
    [persist],
  );

  return { ready, sharePct, setSharePct, invites, addInvite, removeInvite, clients, addClient, removeClient, saveFailed };
}
