# Runbook: merchant nonpayment

A merchant (via their programme) stops remitting — settlements dry up while
attributed conversions keep posting. The platform must never pay publishers
out of thin air: payouts are capped by collected cash
(`merchant_settlements`), so the exposure is publisher trust, not platform
cash.

## Owner
Finance operator (detection, dunning) + network_admin (pause decision).

## Detection — what alert fires
- **Settlement gap**: a programme with approved conversions in the last 14
  days and zero `merchant_settlements` rows in the same window.
- **Collected ratio drop**: per `(programme, currency)`, collected cash vs
  approved publisher liability falls below 20% at payout-prepare time for
  two consecutive cycles.
- **Payout prepare shrinks**: batch items repeatedly capped by the collected
  allocation (`computeCollectedAllocation`) while eligible earnings grow.
- Human signal: dunning emails bounce / go unanswered past the contract's
  payment terms.

## Immediate containment
1. Finance opens dunning per the contract terms (reminder → formal notice).
   Log every step; keep `statement_ref`s on partial payments.
2. If payment is > 15 days overdue (or the contract's cure period, whichever
   is shorter): network_admin pauses the programme
   (`POST /v1/programmes/:id/pause`) to stop new commissionable traffic
   from accruing against a non-paying merchant. Existing approved
   conversions keep their ledger entries — pausing does not erase debt.
3. Do NOT approve payout batches that would exceed collected cash — the
   prepare gate already caps items at the collected allocation; do not
   override it manually. "Payable" is a function of cash in hand.

## Recovery
1. Merchant pays (full or agreed schedule): record each remittance in
   `merchant_settlements` with its `statement_ref`; reconcile against the
   programme's open approved liability.
2. Resume the programme only after the first catch-up payment clears AND
   finance signs off on the schedule for the remainder.
3. Next payout-prepare automatically includes the caught-up publishers
   (thresholds and returns windows still apply).
4. If the merchant never pays: legal pursues per the contract; publishers
   are told honestly that their approved earnings are awaiting merchant
   remittance — the portal shows the `approved` vs `collected` split for
   exactly this reason. Write-offs, if any, are finance adjustments with
   dual approval, never silent ledger edits.

## Comms
- Publishers (affected programmes): banner + email — what is owed, what has
  been collected, what the platform is doing. No promises of platform-funded
  payouts.
- Merchant: formal dunning trail; pause notice citing the contract clause.
- Internal: finance + legal looped from the first missed payment, not after
  the pause.
