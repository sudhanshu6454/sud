/**
 * Suspense queue read model.
 *
 * Conversions whose returned_click_ref matched NO click are stored with
 * click_id = NULL (and, since 0006, placement_id = NULL: no tracking-ID
 * mapping attributed them either). They surface here for HUMAN review by
 * finance/publisher operations.
 *
 * ######################################################################
 * # POLICY: this queue requires HUMAN review. NEVER auto-attribute.     #
 * #                                                                    #
 * # Unknown attribution stays unknown. Do not guess a publisher from    #
 * # IP addresses, timestamps, device fingerprints, coupon codes, or     #
 * # "likely" click-through patterns. A user screenshot alone must not   #
 * # create a payable sale (brief §5: support tickets need evidence;     #
 * # a screenshot is not evidence of a payable transaction).             #
 * #                                                                    #
 * # Resolving a suspense item means a human found DETERMINISTIC         #
 * # evidence (e.g. the provider's own click reference in an amended    #
 * # report) and recorded the actor, reason and timestamp. Anything less  #
 * # stays unknown.                                                      #
 * ######################################################################
 */

import type { Pool } from 'pg';

export interface SuspenseItem {
  id: string;
  programme_id: string;
  provider_account_id: string;
  source_transaction_id: string;
  returned_click_ref: string | null;
  currency: string;
  eligible_value_minor: number;
  commission_minor: number;
  provider_status: string;
  status: string;
  received_at: string;
}

/**
 * List unattributed conversions (click_id IS NULL, placement_id IS NULL, not
 * declined), newest first.
 * Intended for the finance operations review UI / daily operating queue.
 */
export async function listSuspenseQueue(
  pool: Pool,
  orgId: string,
  limit: number = 100,
): Promise<SuspenseItem[]> {
  const { rows } = await pool.query<SuspenseItem>(
    `select id,
            programme_id,
            provider_account_id,
            source_transaction_id,
            returned_click_ref,
            currency,
            eligible_value_minor,
            commission_minor,
            provider_status,
            status,
            received_at
     from conversions
     where org_id = $1
       and click_id is null
       and placement_id is null
       and status <> 'declined'
     order by received_at desc
     limit $2`,
    [orgId, limit],
  );
  return rows;
}
