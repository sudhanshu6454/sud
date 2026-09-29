import { AppError } from '@paparazzi/shared';
import type { DbClient } from './finance.js';

/**
 * Fake sandbox payout rail.
 *
 * This is a stand-in for a real provider (RazorpayX / bank file / etc.):
 * transfers move initiated → processing → paid|failed|unknown entirely
 * through the functions below plus the provider-callback route. No real
 * money moves. The status machine and the unknown-state guard mirror what
 * a real rail integration must enforce; swapping in the real provider
 * means reimplementing this module's four functions against its API.
 */

export type TransferRowStatus = 'initiated' | 'processing' | 'paid' | 'failed' | 'unknown';
export type PayoutOutcome = 'paid' | 'failed' | 'unknown';

export interface InitiatedTransfer {
  id: string;
  provider_ref: string;
  status: TransferStatus;
}

export type TransferStatus = TransferRowStatus;

const UNKNOWN_REQUERY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Submit every transfer of a batch to the (fake) provider.
 * initiated → processing. Terminal transfers (paid/failed) are left alone.
 *
 * UNKNOWN GUARD: re-initiating a transfer stuck in 'unknown' throws
 * TRANSFER_STATUS_UNKNOWN unless queryTransferStatus was called within the
 * last 5 minutes — blindly resubmitting a transfer whose outcome is
 * genuinely unknown risks a double payout at a real provider.
 */
export async function initiateTransfers(
  db: DbClient,
  orgId: string,
  batchId: string,
): Promise<InitiatedTransfer[]> {
  const { rows } = await db.query<{
    id: string;
    provider_ref: string;
    status: string;
    /** timestamptz: pg returns string, pg-mem returns Date — both Date-parseable. */
    last_status_query_at: string | Date | null;
  }>(
    `select id, provider_ref, status, last_status_query_at
       from payout_transfers
      where org_id = $1 and payout_batch_id = $2`,
    [orgId, batchId],
  );

  const out: InitiatedTransfer[] = [];
  for (const t of rows) {
    if (t.status === 'unknown') {
      const last = t.last_status_query_at ? new Date(t.last_status_query_at).getTime() : 0;
      if (Date.now() - last > UNKNOWN_REQUERY_WINDOW_MS) {
        throw new AppError(
          'TRANSFER_STATUS_UNKNOWN',
          `Transfer ${t.provider_ref} is in 'unknown' state; query its provider status before re-initiating (last queried ${t.last_status_query_at ?? 'never'})`,
          409,
        );
      }
    }
    if (t.status === 'initiated' || t.status === 'unknown') {
      await db.query(`update payout_transfers set status = 'processing' where org_id = $1 and id = $2`, [
        orgId,
        t.id,
      ]);
      t.status = 'processing';
    }
    out.push({ id: t.id, provider_ref: t.provider_ref, status: t.status as TransferStatus });
  }
  return out;
}

export interface ProviderCallbackResult {
  transfer_id: string;
  payout_batch_id: string;
  status: TransferStatus;
}

/**
 * Apply a provider outcome to a transfer. Returns null when no transfer
 * carries that provider_ref (caller → 404). Batch-level transitions
 * (paid/failed) are the callback route's job, not the rail's.
 */
export async function handleProviderCallback(
  db: DbClient,
  orgId: string,
  provider_ref: string,
  outcome: PayoutOutcome,
): Promise<ProviderCallbackResult | null> {
  const { rows } = await db.query<{ id: string; payout_batch_id: string; status: string }>(
    `update payout_transfers
        set status = $3
      where org_id = $1 and provider_ref = $2
      returning id, payout_batch_id, status`,
    [orgId, provider_ref, outcome],
  );
  const t = rows[0];
  if (!t) return null;
  return { transfer_id: t.id, payout_batch_id: t.payout_batch_id, status: t.status as TransferStatus };
}

/**
 * Ask the (fake) provider for a transfer's current status. Records
 * last_status_query_at — this is what arms the unknown-retry guard in
 * initiateTransfers for the next 5 minutes. Returns null when the
 * provider_ref is unknown (caller → 404).
 */
export async function queryTransferStatus(
  db: DbClient,
  orgId: string,
  provider_ref: string,
): Promise<TransferStatus | null> {
  const { rows } = await db.query<{ status: string }>(
    `update payout_transfers
        set last_status_query_at = now()
      where org_id = $1 and provider_ref = $2
      returning status`,
    [orgId, provider_ref],
  );
  const status = rows[0]?.status;
  return (status as TransferStatus | undefined) ?? null;
}
