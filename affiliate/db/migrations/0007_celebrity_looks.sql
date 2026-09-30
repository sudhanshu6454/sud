-- 0007_celebrity_looks: celebrity looks from the owner's paparazzi library,
-- the outfit piece by piece, rights controls, takedowns, storefronts per
-- in-house page, comment replies and click rollups
-- (packages/api/ASSUMPTIONS.md "Celebrity looks").
--
-- Additive only: new tables, nullable columns, columns with defaults, and
-- checks that every row already in the database satisfies (the live database
-- holds the seeded network and the Amazon account: no celebrity, no look
-- from the library). No triggers and no regular expressions in CHECKs (pg-mem
-- runs these files in the test suite); the code checks formats (slugs,
-- keywords, URLs) before it writes. Every new tenant table carries org_id
-- references organisations(id).
--
-- Nothing here is a legal conclusion: the columns record the decisions of
-- humans (counsel's rights reviewer, the editors, the owner) and the facts of
-- the library; the rules that read them are in @paparazzi/shared
-- (celebrity.ts: the capability matrix, the image rule, the wording).

-- ---------------------------------------------------------------------------
-- 1. Counsel's reviewer: the only role that sets a celebrity's rights status
--    beyond 'blocked' and restores a takedown.
alter table memberships drop constraint memberships_role_check;
alter table memberships add constraint memberships_role_check
  check (role in ('network_admin','editor','publisher_owner','publisher_analyst','merchant_manager',
                  'finance_operator','finance_approver','rights_reviewer'));

-- ---------------------------------------------------------------------------
-- 2. Celebrities. rights_status is counsel's (default unreviewed); the
--    capability matrix (@paparazzi/shared CELEBRITY_RIGHTS_MATRIX) is the
--    ceiling per status; max_display / shoppable are what the review allowed
--    for this one person. The database enforces the floor: unreviewed and
--    blocked allow nothing; a minor or a never-listed celebrity can never
--    leave unreviewed / blocked; any other status names its reviewer, time
--    and evidence reference.
--    name_key = the normalised name (celebrityNameKey), for matching library
--    rows; aliases likewise normalised.
create table celebrities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  name text not null check (char_length(name) between 1 and 120),
  name_key text not null check (char_length(name_key) between 1 and 120),
  slug text not null check (char_length(slug) between 1 and 80),
  aliases text[] not null default '{}',
  is_minor boolean not null default false,
  never_list boolean not null default false,
  rights_status text not null default 'unreviewed'
    check (rights_status in ('unreviewed','editorial','cleared','blocked')),
  max_display text not null default 'none'
    check (max_display in ('none','name_only','name_and_image')),
  shoppable boolean not null default false,
  rights_note text,
  rights_evidence_ref text,
  rights_reviewed_by uuid references users(id),
  rights_reviewed_at timestamptz,
  -- the active takedown (set and cleared by the takedown path only)
  takedown_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug),
  unique (org_id, name_key),
  check (rights_status not in ('unreviewed','blocked') or (max_display = 'none' and shoppable = false)),
  check (not (is_minor or never_list) or rights_status in ('unreviewed','blocked')),
  check (rights_status = 'unreviewed' or (rights_reviewed_by is not null and rights_reviewed_at is not null)),
  check (rights_status not in ('editorial','cleared') or (rights_evidence_ref is not null and char_length(rights_evidence_ref) >= 3)),
  check (max_display <> 'none' or shoppable = false)
);
create index idx_celebrities_org on celebrities(org_id);

-- Every rights decision, append-only (the celebrity row carries the latest).
-- kind: review (the rights reviewer, or 'blocked' by an editor), rename (a
-- renamed celebrity goes back to unreviewed), minor_flag (flagged a minor or
-- never-listed: back to unreviewed / blocked).
create table celebrity_rights_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  celebrity_id uuid not null references celebrities(id),
  kind text not null default 'review' check (kind in ('review','rename','minor_flag')),
  rights_status text not null check (rights_status in ('unreviewed','editorial','cleared','blocked')),
  max_display text not null check (max_display in ('none','name_only','name_and_image')),
  shoppable boolean not null,
  note text,
  evidence_ref text,
  reviewed_by uuid not null references users(id),
  reviewed_role text not null,
  reviewed_at timestamptz not null default now()
);
create index idx_celebrity_rights_reviews_org_celebrity on celebrity_rights_reviews(org_id, celebrity_id, reviewed_at);

-- ---------------------------------------------------------------------------
-- 3. Licence metadata of assets (the brief's B4). An image is shown only
--    while commercial_reuse = 'yes', the territory covers India, expires_at
--    is null or in the future, an editor's frame screen passed, and none of
--    the exclusion flags is set (@paparazzi/shared assetImageRefusals).
--    Existing rows keep today's rule (legacy look covers: expiry only).
--    kind          still | video | cover | evidence (null for rows before 0007)
--    source_ref    where the file came from in the library (batch, card, file)
--    acquisition   staff | freelance | agency | licensed | other; with
--                  assignment_ref (the written assignment or licence, owner O1)
--    licence_via   where the licence facts came from: 'import' (the library
--                  file's own columns), 'statement' (the owner's ownership
--                  statement, section 11), 'review' (a person's edit through
--                  the API); a re-import never widens a 'review' row
alter table assets add column kind text check (kind is null or kind in ('still','video','cover','evidence'));
alter table assets add column commercial_reuse text not null default 'unknown'
  check (commercial_reuse in ('yes','no','unknown'));
alter table assets add column source_ref text;
alter table assets add column copyright_owner text;
alter table assets add column author text;
alter table assets add column acquisition text
  check (acquisition is null or acquisition in ('staff','freelance','agency','licensed','other'));
alter table assets add column assignment_ref text;
alter table assets add column licence_via text
  check (licence_via is null or licence_via in ('import','statement','review'));
alter table assets add column live_performance boolean not null default false;
alter table assets add column minor_in_frame boolean not null default false;
alter table assets add column bystanders boolean not null default false;
alter table assets add column sensitive_location boolean not null default false;
alter table assets add column screen_status text not null default 'unscreened'
  check (screen_status in ('unscreened','passed','rejected'));
alter table assets add column screened_by uuid references users(id);
alter table assets add column screened_at timestamptz;
alter table assets add column updated_at timestamptz;
-- library imports are idempotent on (kind, storage_key)
create unique index uq_assets_org_kind_key on assets(org_id, kind, storage_key) where kind is not null;

-- ---------------------------------------------------------------------------
-- 4. The paparazzi moment on looks. celebrity_display is the operator's
--    choice for this look, capped by the celebrity's rights at every read.
--    place is coarse (an event or public venue, never a residence);
--    place_kind the same vocabulary as @paparazzi/shared PLACE_KINDS.
--    property_id = the in-house page that published the moment;
--    platform_post_id / post_permalink = that post (comment replies match on
--    the post id). library_ref = the video reference (+ '#<moment>' when one
--    video holds several looks): the import's idempotency key.
--    takedown_id = the active takedown (so every read gate needs no EXISTS).
alter table looks add column celebrity_id uuid references celebrities(id);
alter table looks add column event_name text check (event_name is null or char_length(event_name) <= 120);
alter table looks add column place text check (place is null or char_length(place) <= 120);
alter table looks add column place_kind text
  check (place_kind is null or place_kind in ('event','venue','airport','street','studio','other'));
alter table looks add column moment_date date;
alter table looks add column source_video_asset_id uuid references assets(id);
alter table looks add column still_asset_id uuid references assets(id);
alter table looks add column property_id uuid references properties(id);
alter table looks add column post_permalink text check (post_permalink is null or post_permalink like 'https://%');
alter table looks add column platform_post_id text check (platform_post_id is null or char_length(platform_post_id) <= 100);
alter table looks add column library_ref text check (library_ref is null or char_length(library_ref) <= 200);
alter table looks add column celebrity_display text not null default 'name_only'
  check (celebrity_display in ('name_only','name_and_image'));
alter table looks add column takedown_id uuid;
alter table looks add column withdrawn_at timestamptz;
alter table looks add column updated_at timestamptz;
-- A 'street' or 'other' place is published only after the rights reviewer
-- confirmed it (no word list tells a residence gate or a clinic's pavement
-- from a public street; counsel's list, Q6); changing the event, the place
-- or its kind clears the confirmation (the code does, before it writes).
alter table looks add column place_confirmed_by uuid references users(id);
alter table looks add column place_confirmed_at timestamptz;
alter table looks add column place_confirmed_note text check (place_confirmed_note is null or char_length(place_confirmed_note) <= 300);
alter table looks add constraint looks_place_confirmed_check
  check ((place_confirmed_by is null) = (place_confirmed_at is null));
create unique index uq_looks_org_library_ref on looks(org_id, library_ref) where library_ref is not null;
create index idx_looks_org_celebrity on looks(org_id, celebrity_id);
create index idx_looks_org_property on looks(org_id, property_id);
create index idx_looks_org_post on looks(org_id, platform_post_id);

-- ---------------------------------------------------------------------------
-- 5. The outfit, piece by piece: a label in the owner's words, a garment
--    category (@paparazzi/shared GARMENT_CATEGORIES; the list below is the
--    same, tested), an order, and optionally a hotspot on the still (both
--    coordinates or neither, 0..1 of the width / height). Removed pieces
--    keep their row (removed_at).
create table look_pieces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  look_id uuid not null references looks(id),
  label text not null check (char_length(label) between 1 and 60),
  garment_category text not null check (garment_category in (
    'top','shirt','t_shirt','kurta','dress','saree','lehenga','outerwear','suit','trousers','jeans',
    'skirt','shorts','co_ord_set','ethnic_set','footwear','bag','eyewear','watch','jewellery','belt',
    'headwear','scarf','other')),
  position int not null default 0 check (position >= 0),
  hotspot_x numeric(5,4) check (hotspot_x is null or (hotspot_x >= 0 and hotspot_x <= 1)),
  hotspot_y numeric(5,4) check (hotspot_y is null or (hotspot_y >= 0 and hotspot_y <= 1)),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((hotspot_x is null) = (hotspot_y is null))
);
create index idx_look_pieces_org_look on look_pieces(org_id, look_id);

-- ---------------------------------------------------------------------------
-- 6. look_items belong to a piece. Every check is scoped to piece items
--    (piece_id is not null), so legacy items (and the Amazon offers CLI's
--    shelf items) are untouched:
--    - a piece item has a match type, a review state and its tagger;
--    - SIMILAR is the default and needs no review (always 'approved');
--    - EXACT needs evidence (what it shows, and its source) and a SECOND
--      person's approval: 'pending' until then; approved names a reviewer
--      other than the tagger (maker-checker);
--    - at most one EXACT per piece, and a product once per piece (partial
--      unique indexes over the rows not removed).
alter table look_items alter column asset_id drop not null;
alter table look_items add column piece_id uuid references look_pieces(id);
alter table look_items add column position int not null default 0 check (position >= 0);
alter table look_items add column review_state text check (review_state is null or review_state in ('pending','approved'));
alter table look_items add column evidence_source text;
alter table look_items add column evidence_captured_at timestamptz;
alter table look_items add column tagged_by uuid references users(id);
alter table look_items add column match_reviewed_by uuid references users(id);
alter table look_items add column match_reviewed_at timestamptz;
alter table look_items add column removed_at timestamptz;
alter table look_items add column updated_at timestamptz;
alter table look_items add constraint look_items_piece_tag_check
  check (piece_id is null or (match_type is not null and review_state is not null and tagged_by is not null));
alter table look_items add constraint look_items_piece_similar_check
  check (piece_id is null or match_type <> 'similar' or review_state = 'approved');
alter table look_items add constraint look_items_piece_exact_evidence_check
  check (piece_id is null or match_type <> 'exact'
         or (evidence is not null and char_length(evidence) >= 10
             and evidence_source is not null and char_length(evidence_source) >= 3));
alter table look_items add constraint look_items_piece_exact_review_check
  check (piece_id is null or match_type <> 'exact' or review_state = 'pending'
         or (match_reviewed_by is not null and match_reviewed_at is not null and match_reviewed_by <> tagged_by));
create unique index uq_look_items_piece_exact on look_items(piece_id)
  where piece_id is not null and match_type = 'exact' and removed_at is null;
create unique index uq_look_items_piece_variant on look_items(piece_id, variant_id)
  where piece_id is not null and removed_at is null;
create index idx_look_items_org_piece on look_items(org_id, piece_id);
create index idx_look_items_org_look on look_items(org_id, look_id);

-- ---------------------------------------------------------------------------
-- 7. A storefront per in-house page (the page's link-in-bio): its looks.
create table storefronts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  property_id uuid not null unique references properties(id),
  slug text not null check (char_length(slug) between 1 and 80),
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio text check (bio is null or char_length(bio) <= 300),
  status text not null default 'draft' check (status in ('draft','live','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);
create index idx_storefronts_org on storefronts(org_id);

-- ---------------------------------------------------------------------------
-- 8. Takedowns: one per celebrity (every look) or per look. One transaction
--    withdraws every affected look, pauses its links and turns its comment
--    replies off; the snapshot (takedown_looks) is what a restore reads.
--    requested_at = when the notice was received; actioned_at = when this
--    row committed; completed_at = when the caches were cleared after it.
--    requester_ref is an opaque reference to the notice (no personal data).
--    Restoring needs the rights reviewer and a review newer than actioned_at.
create table takedowns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  scope text not null check (scope in ('celebrity','look')),
  celebrity_id uuid references celebrities(id),
  look_id uuid references looks(id),
  reason_code text not null check (reason_code in (
    'rights_holder_request','legal_notice','court_order','licence_expired','privacy_request',
    'counsel_instruction','operator_error','other')),
  reason_note text check (reason_note is null or char_length(reason_note) <= 500),
  requester_ref text check (requester_ref is null or char_length(requester_ref) <= 200),
  requested_at timestamptz not null,
  actioned_at timestamptz not null default now(),
  actioned_by uuid not null references users(id),
  completed_at timestamptz,
  status text not null default 'active' check (status in ('active','restored')),
  restored_at timestamptz,
  restored_by uuid references users(id),
  restore_note text,
  restore_review_id uuid references celebrity_rights_reviews(id),
  looks_withdrawn int not null default 0,
  links_paused int not null default 0,
  rules_disabled int not null default 0,
  created_at timestamptz not null default now(),
  check ((scope = 'celebrity') = (celebrity_id is not null)),
  check ((scope = 'look') = (look_id is not null)),
  check (status = 'active' or (restored_at is not null and restored_by is not null))
);
create index idx_takedowns_org on takedowns(org_id, status);

create table takedown_looks (
  takedown_id uuid not null references takedowns(id),
  org_id uuid not null references organisations(id),
  look_id uuid not null references looks(id),
  previous_status text not null,
  -- the owner's confirmation that the in-house post was deleted on Meta
  post_removed_at timestamptz,
  primary key (takedown_id, look_id)
);
create index idx_takedown_looks_org on takedown_looks(org_id, look_id);

alter table celebrities add constraint celebrities_takedown_fk foreign key (takedown_id) references takedowns(id);
alter table looks add constraint looks_takedown_fk foreign key (takedown_id) references takedowns(id);

-- Links minted for one tagged item (the look page, instant links); a pause
-- records who paused it, so a restore reactivates exactly those.
alter table links add column look_item_id uuid references look_items(id);
alter table links add column paused_by_takedown_id uuid references takedowns(id);
alter table links add column paused_reason text
  check (paused_reason is null or paused_reason in ('takedown','rights_review','item_removed','look_unpublished'));
create index idx_links_org_look_item on links(org_id, look_item_id);

-- ---------------------------------------------------------------------------
-- 9. Comment replies. No token is stored anywhere (the workers derive Page
--    tokens in memory); no comment text, username or raw commenter id is
--    stored: commenter_hash = HMAC-SHA256(COMMENT_ID_HASH_KEY,
--    platform:account:scoped id), for one-reply-per-comment and opt-outs.
--    meta_accounts maps a Meta account id (the webhook's entry.id) to its
--    in-house property (Instagram properties are stored by handle).
create table meta_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  property_id uuid not null unique references properties(id),
  platform text not null check (platform in ('facebook','instagram')),
  meta_account_id text not null check (char_length(meta_account_id) between 1 and 64),
  linked_page_id text,
  messaging_status text not null default 'unknown'
    check (messaging_status in ('unknown','ok','disabled','token_invalid','rate_limited','not_linked')),
  last_error_code text,
  paused_until timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, meta_account_id)
);
create index idx_meta_accounts_org on meta_accounts(org_id);

-- public_reply: optional text-only public answer (no link: a CHECK refuses
-- anything with http or www.). enabled defaults to false.
create table reply_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  look_id uuid not null references looks(id),
  property_id uuid not null references properties(id),
  platform_post_id text not null check (char_length(platform_post_id) between 1 and 100),
  keywords text[] not null,
  public_reply text check (public_reply is null
    or (char_length(public_reply) <= 300 and public_reply not ilike '%http%' and public_reply not ilike '%www.%')),
  enabled boolean not null default false,
  disabled_by_takedown_id uuid references takedowns(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, property_id, platform_post_id)
);
create index idx_reply_rules_org_look on reply_rules(org_id, look_id);

-- One row per comment that matched a rule: the idempotency key is
-- (platform, comment_id) — Meta retries for 36 hours and duplicates
-- deliveries; ten deliveries give one row, one message.
create table reply_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  rule_id uuid not null references reply_rules(id),
  property_id uuid not null references properties(id),
  platform text not null check (platform in ('facebook','instagram')),
  meta_account_id text not null,
  comment_id text not null check (char_length(comment_id) between 1 and 128),
  media_id text,
  commenter_hash text not null check (char_length(commenter_hash) = 64),
  matched_keyword text not null,
  comment_at timestamptz,
  received_at timestamptz not null default now(),
  status text not null default 'queued' check (status in (
    'queued','sending','sent','unknown','skipped_suppressed','skipped_expired','skipped_disabled',
    'skipped_shadow','failed_permanent','failed_transient')),
  attempts int not null default 0 check (attempts >= 0),
  error_code text,
  message_id text,
  sent_at timestamptz,
  next_attempt_at timestamptz,
  public_reply_status text check (public_reply_status is null or public_reply_status in ('sent','failed','skipped')),
  updated_at timestamptz not null default now(),
  unique (platform, comment_id)
);
create index idx_reply_events_org_status on reply_events(org_id, status);
create index idx_reply_events_status_next on reply_events(status, next_attempt_at);

-- The opt-out list (a STOP comment or message): hashes only, kept.
create table reply_suppressions (
  org_id uuid not null references organisations(id),
  platform text not null check (platform in ('facebook','instagram')),
  commenter_hash text not null check (char_length(commenter_hash) = 64),
  created_at timestamptz not null default now(),
  primary key (org_id, platform, commenter_hash)
);

-- Daily counts, kept after reply_events are purged (RETENTION_REPLY_EVENTS_DAYS).
create table reply_daily (
  org_id uuid not null references organisations(id),
  day date not null,
  rule_id uuid not null references reply_rules(id),
  received int not null default 0 check (received >= 0),
  sent int not null default 0 check (sent >= 0),
  skipped int not null default 0 check (skipped >= 0),
  failed int not null default 0 check (failed >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, day, rule_id)
);

-- ---------------------------------------------------------------------------
-- 10. Click rollups: human clicks per (IST day, link, surface). `via` is the
--     page surface the click came from (the redirect's ?via=, e.g. 's-<slug>'
--     for a storefront), '' when none; it names a page, never a person.
--     Recomputed for today and yesterday by the workers (idempotent), read by
--     the analytics endpoints; money is never read or written.
create table click_daily (
  org_id uuid not null references organisations(id),
  day date not null,
  link_id uuid not null references links(id),
  via text not null default '',
  clicks int not null default 0 check (clicks >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, day, link_id, via)
);
-- The rollup reads one day of one org at a time. Built inside the migration's
-- transaction (not CONCURRENTLY): fine at the pilot's size (docs/capacity-plan.md).
create index idx_clicks_org_occurred on clicks(org_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 11. The owner's statement that the organisation owns its library footage
--     (looks/ownership.ts; the owner, 2026-09-30: "all clips are owned by
--     us"). Append-only; the row with the highest seq decides: 'owned' is in
--     force, 'withdrawn' means none is. While one is in force, a library row
--     that leaves every licence column blank takes its licence from it
--     (assets.licence_via = 'statement', assignment_ref naming the
--     statement). It records the owner's word about the footage only; the
--     celebrity's own rights stay with each celebrity's review.
create table library_ownership_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  seq int not null check (seq >= 1),
  kind text not null check (kind in ('owned','withdrawn')),
  copyright_owner text check (copyright_owner is null or char_length(copyright_owner) between 2 and 200),
  acquisition text check (acquisition is null or acquisition in ('staff','other')),
  statement text not null check (char_length(statement) between 10 and 2000),
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default now(),
  unique (org_id, seq),
  check (kind <> 'owned' or (copyright_owner is not null and acquisition is not null))
);
