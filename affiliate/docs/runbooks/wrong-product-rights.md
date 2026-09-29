# Runbook: wrong product / rights issue

A look links to the wrong product (mis-match), or a rights problem surfaces:
unlicensed asset, expired territory license, withdrawn look, or a takedown
request from a brand/rights holder. The platform must stop monetising the
affected content immediately — this is what the kill switch is for.

## Owner
Editorial lead (content decision) + network_admin (executes the switch).

## Detection — what alert fires
- Rights holder / brand complaint (email/ticket) — treat as P0.
- Automated: `assets.expires_at < now()` sweep (daily job) flags looks using
  expired licenses; `look_items` with `match_type = 'similar'` above the
  editorial risk threshold queue for re-review.
- Publisher or user report via the disputes channel.
- Merchant flags a product page as wrong/removed behind a live link.

## Immediate containment (first 15 min)
1. Identify the blast radius: which `look_items` / `offers` / `programmes`
   are affected.
   - Wrong product on a live offer: pause the **programme** —
     `POST /v1/programmes/:id/pause`. All its links serve the paused page
     within the cache-invalidation window; new link minting is blocked.
   - Single bad look/asset: set the look to `withdrawn` and pause the
     affected offers (`offers.status = 'stale'`) — redirects for those
     links serve the paused page; no fabricated prices are ever shown.
2. Do NOT delete rows. Pausing preserves the audit trail (who, when, why in
   `audit_log` + `programme.paused` outbox event).
3. If the issue is a rights takedown: also suspend the asset
   (`assets` row flagged; editorial removes it from all look_items).

## Recovery
1. Editorial fixes the match (correct variant/offer) or clears the rights
   issue, with evidence recorded on the look_item (`evidence` field).
2. Re-verify: fresh `verifications` row for the property if the dispute
   touched attribution.
3. `POST /v1/programmes/:id/resume` only after editorial sign-off; the
   resume invalidates the route cache so the paused page stops serving
   immediately.
4. Conversions that occurred while paused: any provider webhooks arriving
   late are processed normally (idempotent, revision-ordered). No manual
   ledger entries — the ledger stays provider-sourced.

## Comms
- Rights holder / complainant: acknowledge within 2 h, confirm containment
  (paused at <timestamp>), share resolution or a dated remediation plan.
- Publishers: portal banner if their links were paused — what, why, and the
  expected resume window. Never disclose the complainant's identity beyond
  what the takedown itself requires.
- Internal: postmortem covering how the wrong match/rights lapse got
  through review; tighten the checklist that missed it.
