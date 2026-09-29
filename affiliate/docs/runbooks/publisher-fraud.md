# Runbook: publisher fraud suspicion

Incentivised clicks, self-referral loops, bot traffic, cookie stuffing, or
attribution gaming. Treat as investigation-first: the ledger is append-only,
so the response is to stop new exposure and reverse proven fraud through
adjustments — never to edit ledger rows.

## Owner
Fraud analyst (investigation) + network_admin (suspension/pause).

## Detection — what alert fires
- **Click/conversion anomaly**: conversion rate per `(property, programme)`
  > 5× the network median for 24 h; click bursts from a single IP hash
  (`clicks.context->>'ip_hash'`) or UA string.
- **Self-referral pattern**: provider `returned_click_ref`s resolving to
  clicks whose IP hash matches the publisher's known ranges.
- **Reversal clustering**: a publisher's conversions reversing at > 3× the
  programme baseline (possible incentivised-then-returned abuse).
- **Settlement mismatch**: provider reports conversions the click log never
  saw (high suspense rate concentrated on one publisher).
- Human report: merchant complaint, whistleblower.

## Immediate containment
1. Do not tip off the publisher during the first look — gather 24–48 h of
   data if the abuse is ongoing but not accelerating; act immediately if it
   is accelerating or the amounts are material.
2. Containment options, escalating:
   - Pause the publisher's **programmes** (`POST /v1/programmes/:id/pause`)
     if the abuse is programme-specific.
   - Set the publisher `status = 'suspended'` + `onboarding_state` stays as
     is; suspended publishers' properties fail the mint guard at the
     property level — additionally set their properties to `suspended` so
     `POST /v1/links` returns 403 and existing links can be paused per
     programme.
   - Hold pending payout batches: do not approve/disburse batches containing
     the publisher until the investigation closes (maker-checker means this
     needs a second pair of eyes anyway).
3. Preserve evidence: export the click/conversion/adjustment rows for the
   window (read-only queries); snapshot `audit_log` and the provider's raw
   payloads (`conversions.raw`).

## Recovery
1. **Confirmed fraud**: post reversal adjustments (`kind = 'reversal'`,
   provider-style via the integrations endpoint or a finance correction
   with dual approval) against the fraudulent conversions — the mirror
   entries net the publisher's liability to zero through the normal
   double-entry path. Exclude the publisher from future batches until
   reinstated by network_admin + fraud analyst jointly.
2. **False alarm**: reinstate (property/programme status back, resume
   programmes), release held batches, and tell the publisher what happened
   in general terms.
3. **Uncertain**: keep the hold, narrow the scope (single property), and set
   a dated re-review. Do not pay out "to be nice".

## Comms
- Publisher: factual, minimal during investigation ("we're reviewing
  activity on your account"); full reasons only at suspension/termination,
  with the contract clause cited and an appeal path.
- Merchant: share aggregate impact (reversed commission totals), not
  investigative methods.
- Internal: fraud analyst owns the case file; legal is looped before any
  termination. Postmortem feeds new detection rules.
