# Infrastructure recommendation — pilot deployment

## Decision (2026-09-29): the owner has chosen Linode

The owner has created a Linode for Afflino ("linode is ready", 2026-09-29),
separate from the server that runs the owner's other sites. Its plan, region,
image and address are not recorded in this repository; the owner's
convention for their other servers is Ubuntu 24.04 in Mumbai (ap-west) on a
4 GB plan, with ufw (OpenSSH, 80, 443), fail2ban, unattended-upgrades and
Docker from get.docker.com. **Nothing has been deployed to it, or to
afflino.com, from this repository.** DNS for afflino.com is at GoDaddy
(nameservers `ns01.domaincontrol.com`); on 2026-09-29 its A records were
GoDaddy's parking/forwarding addresses and `www` a CNAME to the apex — the A
record must point at the Linode before the edge can obtain certificates.

**The pilot shape is a single host:** `docker-compose.prod.yml` +
`docker-compose.single-host.yml` — the edge (Caddy: TLS with automatic
certificates for afflino.com and www.afflino.com only), api, redirect,
workers, web and the migrate job, with Postgres 16 and Redis 7 (append-only)
in containers on named volumes, no database port published, and only the
edge listening publicly (README.md "Deploying afflino.com",
`docs/runbooks/deploy.md`). Trade-offs of that choice, recorded rather than
decided:

- Postgres and Redis share the host with the app: a disk-full or host loss
  takes the ledger and the queues with it. Backups are therefore not
  optional (`docs/runbooks/backup-restore.md`: nightly `pg_dump` off the
  host, and a restore drill before real money); the Redis append-only file
  keeps queued jobs across a restart, not across a lost disk.
- No automatic failover, no point-in-time recovery, no managed minor-version
  patching of Postgres; restores are from the last dump (RPO = dump
  interval).
- Capacity: one host for everything; `docs/capacity-plan.md` still applies
  (the soak has not run on real infrastructure). The only number measured:
  in the 2026-09-29 local rehearsal the seven long-running containers used
  about 166 MiB together at idle (one `docker stats` sample: postgres 41,
  web 32, redirect 27, api 25, workers 25, edge 11, redis 5 MiB) — no load,
  so it says nothing about peak; building the web image (`next build`) on the
  host needs noticeably more for a minute or two.

**Managed databases remain an option** — the "Redis: managed vs
self-hosted" reasoning below still holds for a ledger: drop
`docker-compose.single-host.yml` and set `DATABASE_URL` / `REDIS_URL` to a
provider's managed Postgres 16 / Redis (private endpoint); nothing else in
the stack changes. The AWS and DigitalOcean options below are kept as the
record of the earlier recommendation, not as the plan.

---

**Status of the sections below:** the earlier recommendation, superseded by
the decision above. Dated estimates are from public pricing pages checked
**2026-09-23** — they are estimates, not quotes, and will drift.

**Decision that was requested:** approve Option A (AWS, ap-south-1) or
Option B (DigitalOcean, blr1).

## Recommendation: Option A — AWS, ap-south-1 (Mumbai)

- **Region: ap-south-1 (Mumbai).** Lowest latency for an India-first product
  and the strongest India data-residency posture among mainstream clouds.
  (AWS also has ap-south-2 Hyderabad; Mumbai has the broader service
  footprint.)
- **Compute:** 2× EC2 `t4g.micro` (ARM Graviton, 2 vCPU / 1 GiB) — one node
  runs `api` + `workers`, one runs `redirect` + `web`; behind an ALB.
  Graviton is 15–20% cheaper than x86 at this size. Single AZ is acceptable
  for pilot; Multi-AZ is a cost toggle (2× DB cost) reserved for post-pilot.
- **Postgres: Amazon RDS for PostgreSQL**, `db.t4g.micro`, single-AZ,
  20 GiB gp3, automated backups 7-day retention, deletion protection ON.
  Managed wins here: automated backups, point-in-time recovery, minor-version
  patching, and parameter-group tuning without a DBA on staff.
- **Redis: Amazon ElastiCache for Valkey**, `cache.t4g.micro`, single node.
  BullMQ (job queues) + redirect hot-path both ride on this. Valkey is the
  Redis-compatible, license-clean engine AWS now defaults to.
- **Backups:** RDS automated snapshots (7 days) + one weekly manual snapshot
  retained 90 days; `scripts/backup.sh` extended to push a nightly
  `pg_dump` to S3 (Standard, same region) for off-RDS copies. See
  `docs/runbooks/backup-restore.md`.
- **Monitoring:**
  - *Metrics/alarms:* CloudWatch — RDS `FreeableMemory`/`CPUUtilization`,
    ElastiCache `EngineCPUUtilization`/`CurrConnections`, EC2 CPU, ALB
    `TargetResponseTime` + 5xx rate. Alarms → SNS → email + Slack webhook.
  - *Logs:* CloudWatch Logs for all four services (log driver `awslogs`,
    30-day retention; ~$0.50/GB ingest — pilot volume is small).
  - *Uptime:* Route 53 health checks on `/health` (api) and `/` (web) at
    30s intervals from 3+ regions, alarm on failure.
  - *Cost guardrail:* AWS Budgets alert at 80% and 100% of the estimate
    below, delivered to the account owner on day one.
- **Secrets:** AWS Secrets Manager for `DATABASE_URL`, `REDIS_URL`,
  `JWT_SECRET`, `STUB_WEBHOOK_SECRET`, payout-rail keys. See
  [credential-setup.md](credential-setup.md).

## Alternative: Option B — DigitalOcean, blr1 (Bangalore)

Simpler console, flat pricing, and an India region (blr1). Managed
PostgreSQL Basic (1 vCPU / 1 GiB / 10 GiB, $15/mo) and Managed Valkey/Redis
Basic ($15/mo), one 2 vCPU / 4 GiB droplet ($24/mo) running all four
services via `docker-compose.prod.yml`, DO Spaces ($5/mo) for DB dumps.
Trade-offs vs AWS: fewer compliance certifications commonly asked for by
Indian enterprise merchants, smaller Mumbai-region ecosystem, and managed-DB
connection limits (25 on Basic) that need a small pooler (PgBouncer) sooner.
**Pick this if operational simplicity beats enterprise procurement optics.**

## Redis: managed vs self-hosted

Self-hosting Redis on the app node saves ~$9/mo but couples queue durability
to the app host: a node restart or disk-full event can strand BullMQ jobs and
stall the money loop (clicks → conversions → ledger). At pilot scale the
managed premium buys automatic failover and backups. **Stay managed until
monthly Redis spend exceeds the cost of the on-call pain — revisit at
10× pilot traffic.** Same logic applies to Postgres (self-hosted pg on a
droplet is the cheapest option and the riskiest for a ledger).

## Cost estimates (pilot scale, dated 2026-09-23)

Assumed FX: **₹88 = $1** (state your card's actual rate when provisioning).
Pilot load: ≤ 10k redirect hits/day, ≤ 1k conversions/day, ≤ 5 publishers —
well within t4g-class headroom. RPO ≤ 24 h (daily automated backups),
RTO ≤ 4 h (snapshot restore + redeploy).

| Component | Option A — AWS ap-south-1 | Option B — DigitalOcean blr1 |
|---|---|---|
| Managed Postgres | RDS `db.t4g.micro` ≈ $12.50/mo + 20 GiB gp3 ≈ $2.50/mo | Managed PG Basic $15/mo |
| Managed Redis/Valkey | ElastiCache `cache.t4g.micro` ≈ $9.15/mo | Managed Redis Basic $15/mo |
| Compute | 2× EC2 `t4g.micro` ≈ $16/mo + 2× 30 GiB gp3 ≈ $5/mo | 1× droplet 2 vCPU/4 GiB $24/mo |
| Load balancer | ALB ≈ $16.50 + LCU ≈ $5 → ≈ $21/mo | — (droplet-direct, or $12 managed LB) |
| Backups/object storage | S3 dumps ≈ $1/mo (RDS snapshots incl.) | Spaces $5/mo |
| Data transfer | ≈ $5/mo (low egress assumed) | included |
| Secrets | Secrets Manager ≈ $1/mo | — (env via App Platform/droplet) |
| Monitoring | CloudWatch/logs ≈ $3/mo | included |
| **Total** | **≈ $76/mo ≈ ₹6,700/mo** | **≈ $59/mo ≈ ₹5,200/mo** |

Sources (checked 2026-09-23): AWS RDS/ElastiCache/EC2 pricing via
[CloudPrice db.t4g.micro](https://cloudprice.net/aws/rds/instances/db.t4g.micro)
(from $11.68/mo), [Vantage t4g.micro](https://Instances.vantage.sh/aws/ec2/t4g.micro),
[ec2-ondemand-prices](https://github.com/rioastamal/ec2-ondemand-prices),
[AWS 3-tier costing sample](https://github.com/linuxmalaysia/aws-3tier-deployment-for-php-infra/blob/HEAD/docs/executive/costing.md)
(db.t4g.micro Multi-AZ $0.032/hr, cache.t4g.micro $0.0125/hr, ALB $0.0225/hr,
EBS gp3 $0.08/GB-mo); DigitalOcean managed DB pricing via
[DigitalOcean setup guide](https://github.com/umutyerebakmaz/killreport/blob/HEAD/backend/docs/deployment/DIGITALOCEAN_SETUP.MD)
($15/mo Basic PG) and
[DO cost comparison](https://github.com/tomaioo/devops-daily/blob/HEAD/content/posts/migrating-from-heroku-to-digitalocean.md)
($15/mo Basic Redis).
Official pages to re-verify at provisioning: AWS RDS Pricing, ElastiCache
Pricing, EC2 On-Demand Pricing (all under aws.amazon.com pricing), and
digitalocean.com/pricing.

Honest caveats: these are list on-demand prices; actual bills vary with
data transfer, CloudWatch ingestion, and snapshot retention. Enable AWS
Budgets (Option A) or DO billing alerts (Option B) on day one.

## DPDP data-localisation — open counsel questions (not conclusions)

Keeping data in ap-south-1 / blr1 is good hygiene, not a legal opinion.
Confirm with counsel before launch (see
[docs/counsel-briefing.md](counsel-briefing.md)):

1. Does the click → conversion → publisher-ledger pipeline process
   "personal data" under the DPDP Act (hashed IPs, device metadata,
   publisher payout identities)?
2. If yes, which lawful basis applies, and does any cross-border transfer
   occur (e.g. a US-based error-reporting or analytics sub-processor)?
3. Do the retention windows (`RETENTION_*_DAYS`) satisfy purpose-limitation
   and storage-limitation, or must counsel shorten them pre-launch?
4. Are there sector rules (RBI payout directions, ASCI) that impose stricter
   localisation or audit-trail duties on payout records?
5. Does the Data Protection Board's breach-notification timeline change the
   alerting/response runbook in `docs/runbooks/data-incident.md`?

## Assumptions (sanity-check these)

Recorded here per repo convention; challenge any line before provisioning.

- Pilot traffic: ≤ 10k redirects/day, ≤ 1k conversions/day. t4g.micro-class
  instances have ample headroom; the first bottleneck will be RDS
  connections, not CPU.
- RPO ≤ 24 h, RTO ≤ 4 h. No Multi-AZ, no read replicas at pilot.
- Payout rail stays a stub through pilot (sandbox: no real money). Real
  provider credentials are a separate workstream owned by the user.
- Single region, no CDN at pilot. Add CloudFront / a CDN when media traffic
  justifies it.
- TLS terminates at the ALB (ACM certificate, free); services listen on
  plain HTTP inside the VPC / private network. (Single host on Linode: TLS
  terminates at the edge container instead, `docker/Caddyfile`.)
- Web (Next.js) is served as a containerised `next start` behind the same
  ALB; no separate static hosting at pilot.
- Backups are tested: a restore drill is part of the pre-launch checklist in
  [credential-setup.md](credential-setup.md).

## What this doc does not cover

- Merchant approvals, media rights, ASCI/DPDP counsel sign-off, payout-rail
  credentials — owned by the user (external dependencies).
- Load-soak results and pentest — scheduled pre-launch workstreams.
- Terraform/CloudFormation: deliberately omitted at pilot scale; the
  account owner provisions the four managed resources via console with the
  checklist in [credential-setup.md](credential-setup.md). Codify with IaC
  when a second environment (staging) exists.
