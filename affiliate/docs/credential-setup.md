# Credential setup — pilot launch

**Rule zero:** no real secret ever lives in git, in chat, in a ticket, or in
a shell history file. Secrets live in the **Secure Vault** (AWS Secrets
Manager for Option A; the provider's secret store / a restricted file on the
droplet for Option B) and are injected as environment variables at deploy
time. `.env.prod.example` documents the *shape*; the filled copy lives at a
secure path (e.g. `/run/secrets/paparazzi.env`, mode `0600`, root-owned) and
is gitignored.

## What goes where

| Secret / value | Where it lives | Who provides it |
|---|---|---|
| `DATABASE_URL` (incl. password) | Secure Vault → env | Platform (generated at DB provisioning) |
| `REDIS_URL` (incl. password/auth token) | Secure Vault → env | Platform |
| `JWT_SECRET` | Secure Vault → env | Platform (generated, see below) |
| `STUB_WEBHOOK_SECRET` | Secure Vault → env | Platform (generated, see below) |
| Payout-rail API key / webhook secret | Secure Vault → env | **User** — only when the real rail is integrated (post-pilot) |
| `ALERT_WEBHOOK_URL` | Secure Vault → env (or alarm config) | Platform (Slack/PagerDuty webhook created by user) |
| Cloud account root / IAM | Cloud console + MFA | **User** (account owner) |
| Non-secret config (`RETENTION_*`, `*_PORT`, `LOG_LEVEL`, …) | `.env.prod.example` values / compose file | Platform |

Non-secret config may live in the compose file or a plain env file.
Anything that authenticates or signs goes in the vault — no exceptions.

## Generating secrets

Run on a trusted machine, never on a shared host, and pipe straight into
the vault (don't leave values in terminal scrollback):

```sh
# JWT_SECRET and STUB_WEBHOOK_SECRET — 256+ bits each, independent values
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # STUB_WEBHOOK_SECRET (must differ from JWT_SECRET)
```

Database and Redis credentials: accept the provider-generated values at
provisioning time (RDS master password, ElastiCache auth token, DO
`doadmin` password) — do not invent your own weaker ones. Create a
least-privilege app user for the application (`paparazzi_app`) and keep the
master credentials for break-glass only:

```sql
-- run once, as the master user, on the fresh database
CREATE ROLE paparazzi_app WITH LOGIN PASSWORD '<from-vault>';
GRANT CONNECT ON DATABASE paparazzi TO paparazzi_app;
GRANT USAGE ON SCHEMA public TO paparazzi_app;
-- grant table privileges as needed by db/migrations (or ALL for pilot simplicity)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO paparazzi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO paparazzi_app;
```

`DATABASE_URL` then uses `paparazzi_app`, never the master user.

## Rotation procedure and cadence

| Secret | Cadence | How |
|---|---|---|
| `JWT_SECRET` | On suspected compromise; scheduled every 12 months | Generate new → update vault → rolling restart of `api`. **Note:** rotating invalidates outstanding tokens — schedule in a maintenance window and warn publishers. |
| `STUB_WEBHOOK_SECRET` | Same as above | Generate new → update vault → restart `workers`. |
| DB password (`paparazzi_app`) | Every 12 months, or on staff change | `ALTER ROLE … PASSWORD` → update vault → rolling restart of `api`, `redirect`, `workers`, `migrate` job. |
| Redis auth token | Every 12 months, or on compromise | Provider console rotation → update vault → restart all services. |
| Payout-rail keys | Per provider policy (post-pilot) | Provider dashboard → vault → restart `api`/`workers`. |

Rotation steps (all secrets): 1) generate new value; 2) write to vault;
3) rolling restart services (`docker compose up -d` re-reads env on
recreate); 4) verify `/healthz` on api + redirect and one end-to-end click
in staging/pilot; 5) revoke the old value at the provider. Log the rotation
in the ops log (date + which secret, never the value).

## Who provides what (checklist for the user)

- [ ] Cloud account (AWS or DigitalOcean) with billing enabled + MFA on root
- [ ] IAM user/group for the platform deployer (no root keys floating around)
- [ ] Approval of the infra recommendation (Option A or B)
- [ ] Slack/PagerDuty webhook URL for alerts (`ALERT_WEBHOOK_URL`)
- [ ] Domain(s) for api / redirect / web + DNS access (for ACM / TLS)
- [ ] Payout-rail provider choice + API credentials — **post-pilot only**;
      the sandbox rail moves no real money and needs nothing at launch

## Pre-launch credential checklist

- [ ] All four secrets (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
      `STUB_WEBHOOK_SECRET`) exist in the vault; none in git
      (`git log -S 'BEGIN' -- .env*` and a manual scan of `.env.prod.example`
      show placeholders only)
- [ ] `JWT_SECRET` ≠ `STUB_WEBHOOK_SECRET`; both ≥ 256 bits from `openssl rand`
- [ ] App connects as least-privilege `paparazzi_app`, not the DB master user
- [ ] RDS deletion protection ON; automated backups 7-day retention verified
- [ ] TLS: ACM certificate issued for all three public hostnames; ALB (or
      droplet) redirects HTTP → HTTPS
- [ ] `scripts/backup.sh` dry-run against prod DB succeeds with
      `PAPARAZZI_ALLOW_PROD=1`; first manual snapshot taken and **restore
      drill completed** (restore to a scratch instance, run acceptance tests)
- [ ] CloudWatch alarms (or DO alerts) firing to `ALERT_WEBHOOK_URL` —
      tested with one forced alarm
- [ ] AWS Budgets / DO billing alert at 80% and 100% of the estimate in
      `docs/infrastructure-recommendation.md`
- [ ] Rotation calendar entries created (12-month cadence)
- [ ] Old/placeholder secrets from sandbox (`dev-only-change-me`) confirmed
      absent from every production host
