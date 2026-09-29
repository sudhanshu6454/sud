# Runbook: dependency vulnerability review

Dated 2026-09-23. Sandbox TypeScript monorepo; all work local, no
credentials, no provisioning.

## Method (and why `pnpm audit` was not run directly)

`pnpm audit` could not complete: the audit endpoint
(`POST https://registry.npmjs.org/-/npm/v1/security/audits`) is reset by
this environment's egress filter (`ECONNRESET`, retried 3× then failed).
Regular registry reads work, but the security-audit endpoint does not.

Fallback, run 2026-09-23: resolved every package pinned in
`pnpm-lock.yaml` (lockfileVersion 9.0, 171 packages — direct + transitive)
plus the two root dev tools installed in `node_modules` but absent from the
lockfile importers (`vitest@3.2.7`, `pg-mem@3.0.14`), and queried the
[OSV API](https://api.osv.dev) `GET /v1/query` per package
(name + exact pinned version). OSV ingests the same npm advisories
`pnpm audit` is based on, so coverage is equivalent for known CVEs in the
npm ecosystem.

**PENDING:** re-run `pnpm audit` (or an SCA tool such as Snyk/Dependabot)
from a network where the audit endpoint is reachable — ideally on the CI
runner once it exists — and reconcile against this report.

## Findings

**No known vulnerabilities found in any of the 173 checked packages** at
their pinned versions (direct + transitive, production + dev).

Direct dependencies checked (resolved versions from the lockfile):

| Package | Version | OSV result |
|---|---|---|
| fastify | 4.29.1 | clean |
| ioredis | 5.11.1 | clean |
| jsonwebtoken | 9.0.3 | clean |
| pg | 8.23.0 | clean |
| zod | 3.25.76 | clean |
| bullmq | 5.81.5 | clean |
| next | 14.2.35 | clean |
| react / react-dom | 18.3.1 | clean |
| pg-mem | 3.0.14 | clean |
| vitest | 3.2.7 | clean |
| tsx | 4.23.15 | clean |
| typescript | 5.9.3 | clean |
| yaml | 2.9.1 | clean |
| @types/* | various | clean |

Plus all 152 transitive packages in `pnpm-lock.yaml` snapshots: **clean**.

## Decisions

| # | Finding | Severity | Decision | Rationale |
|---|---|---|---|---|
| 1 | None found | — | No upgrades required | No known advisories at pinned versions. No safe-upgrade action to take. |
| 2 | `pnpm audit` endpoint unreachable | process | **Accepted risk (temporary)** | Audited via OSV instead; must re-run `pnpm audit` on CI (PENDING above). If CI shows anything this report missed, treat it as a new finding. |

### Noted for the next review

- `pnpm-lock.yaml` importers list root devDeps (`vitest`, `pg-mem`) as an
  empty importer block `{}` even though both are installed at root —
  the lockfile does not record their resolved versions. They were checked
  via `node_modules` (clean). Consider running `pnpm install --lockfile-only`
  at the next dependency change so the lockfile covers the root importer
  too; stale/untracked lock entries are a supply-chain blind spot.
- The lockfile pins exact versions; all `^` specifiers in
  `package.json` files are satisfied by versions newer than the specifier
  floors (e.g. ioredis `^5.4.1` → 5.11.1, zod `^3.23.8` → 3.25.76) — no
  major-version jumps pending anywhere in the tree.
- A few lockfile snapshot entries carry peer-suffixed versions (e.g.
  `ajv-formats@3.0.1(ajv@8.20.0)`); OSV was queried on the base version
  (`3.0.1`). Both are tiny, widely-used packages; risk of a missed
  advisory from this normalization is negligible.
- Dev-only deps (tsx, vitest, pg-mem, typescript) never ship to
  production containers — but they run in CI and the sandbox demo, so
  they were checked anyway.

## Cadence

- Re-run this check **monthly** and **before every production deploy**,
  from CI where `pnpm audit` works. Record the outcome here with the date.
- Add `pnpm audit --audit-level=high` as a CI gate when the CI pipeline is
  created (PENDING INFRA — currently no CI exists).
- New dependency additions: check the new package (and its subtree) in
  OSV or via `pnpm audit` before merging.
