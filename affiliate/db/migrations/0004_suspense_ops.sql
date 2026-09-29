-- 0004_suspense_ops: human-review bookkeeping for the suspense queue.
--
-- The suspense read model (conversions with click_id IS NULL, status <>
-- 'declined', see packages/workers/src/suspense.ts) is unchanged by this
-- migration: all new columns are nullable metadata written ONLY by human
-- operators via POST /v1/suspense/:id/review. No worker, connector, or
-- webhook path ever writes them, so nothing here can auto-attribute a
-- conversion or change its click_id.
--
-- The row's own click_id stays the single source of truth for attribution;
-- these columns record that a human has LOOKED at the row and recorded why
-- it stays (or stopped being) unattributed.

alter table conversions
  add column reviewed_at timestamptz;

alter table conversions
  add column reviewed_by uuid references users(id);

alter table conversions
  add column review_note text;

-- Supporting the ops list query (org-scoped, newest first, reviewed filter).
create index idx_conversions_org_received on conversions (org_id, received_at desc);
