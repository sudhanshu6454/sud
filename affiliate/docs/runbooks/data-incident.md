# Runbook: data incident (privacy / PII)

Suspected or confirmed exposure of personal data: IP addresses, user agents
tied to individuals, publisher KYC documents, payout bank details, or any
DB/Redis/log leak. DPDP Act 2023 applies — the platform is a data fiduciary
for publisher data it holds.

## Owner
Security lead (incident commander) + network_admin (access revocation).

## Detection — what alert fires
- Anomalous DB access (new client IP, bulk `SELECT` on `users` /
  `payout_items` / publisher KYC stores).
- Secret/credential leak scanner hit on the repo or logs.
- A log pipeline found storing raw IPs — note the click path hashes IPs
  (`sha256(ip)`) by design; a raw IP in any log is itself a finding.
- External report (researcher, publisher, vendor).

## Immediate containment (first hour)
1. Revoke the exposed surface: rotate the credential / JWT secret
   (note: rotating `JWT_SECRET` invalidates all sessions and link
   `route_signature`s — plan a maintenance window; minted links keep working
   because the redirect service trusts the token, not the signature), revoke
   tokens, close the network path.
2. Stop the bleeding before investigating: if a log sink is capturing raw
   IPs or PII, disable that sink first, then diagnose.
3. Preserve forensic copies (DB snapshot, access logs) before remediation
   changes state.

## Recovery
1. Scope the exposure: which tables/keys, which subjects, what time window.
   Query access logs, not vibes.
2. Remediate the root cause (query scoping, log redaction, retention fix).
   The `consent_records` table exists for DPDP consent tracking — if the
   incident touches consent state, reconcile it before any new processing.
3. Rotate anything that might have been in the blast radius; verify with a
   fresh `pnpm test` + `pnpm demo` in a clean environment.

## Comms
- **DPDP clock**: assess whether the breach must be notified to the Data
  Protection Board and affected data principals, and on what timeline —
  counsel decides, not engineering. Do not freelance the notification.
- Affected publishers/users: what was exposed, what wasn't (e.g. "passwords
  were never stored; click IPs are stored hashed"), what we're doing.
- Internal: blameless postmortem; the fix list becomes checklist items in
  `docs/pilot-checklist.md`.
- Never put PII in the incident ticket itself — reference row counts and
  table names, not values.
