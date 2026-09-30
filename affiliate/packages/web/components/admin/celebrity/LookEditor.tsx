'use client';

/*
 * One celebrity look for the editors (admin, no artboard): the moment, the
 * still with its licence panel, the outfit piece by piece, products tagged
 * per piece, the publish gate in plain words, and the status moves.
 *
 * Live: GET /v1/editorial/looks/:id (with the gate report), POST
 * /v1/editorial/looks/:id (the moment), /transition, /links; POST
 * /v1/editorial/looks/:id/pieces, /v1/editorial/pieces/:id (rename, category,
 * order, marker), /remove; POST /v1/editorial/instant-links (paste an
 * amazon.in link or ASIN straight into a piece, SIMILAR by default, EXACT
 * with its evidence), /v1/editorial/pieces/:id/items (an existing offer);
 * POST /v1/editorial/look-items/:id/review (a second person approves an
 * EXACT tag; the tagger cannot) and /remove; POST /v1/editorial/assets/:id
 * (the frame screen and the frame's flags). The API decides every rule; the
 * screen says what it answered.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import { Banner, Button, Checkbox, Field, Input, Select, Tag, Textarea } from '@/components/ui';
import { IdempotencyKeys } from '@/lib/idempotency';
import {
  GARMENT_CATEGORIES,
  PLACE_KINDS,
  allowsText,
  gateLabel,
  hotspotFrom,
  linkablePages,
  lookStatusLabel,
  looksLikeProductInput,
  nextStatuses,
  sortedItems,
  statusLabel,
  statusTone,
  tagProblems,
  type EditorialItem,
  type EditorialLook,
  type EditorialPiece,
  type GateReport,
  type InstantLinksResult,
  type PropertyRow,
} from '@/lib/celebrity-admin';
import { DEMO_EDITORIAL_LOOK, DEMO_PROPERTIES } from '@/lib/demo/celebrity';
import { formatMoney } from '@/lib/format';
import { NO_MARKER_CATEGORIES, categoryLabel } from '@/lib/spotted';
import { LiveBadge, LiveBanner } from './LiveStatus';
import { send, tokenRole, useLiveData } from './useLiveData';
import styles from './admin.module.css';

const pieceKeys = new IdempotencyKeys('look-piece');
const instantKeys = new IdempotencyKeys('instant-link');
const tagKeys = new IdempotencyKeys('piece-item');

type Flash = { ok: boolean; text: string } | null;

export function LookEditor({ id }: { id: string }) {
  const look = useLiveData<EditorialLook>(`/v1/editorial/looks/${id}`, { ...DEMO_EDITORIAL_LOOK, id }, 'this look');
  const props = useLiveData<{ items: PropertyRow[] }>('/v1/editorial/properties', DEMO_PROPERTIES, 'the in-house pages');
  const [flash, setFlash] = useState<Flash>(null);
  const [gate, setGate] = useState<GateReport | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => setRole(tokenRole()), []);
  const stillRef = useRef<HTMLDivElement>(null);
  const l = look.value;
  // Placing a marker: the still comes into view (it can be far above the piece's row), with its instruction beside it.
  useEffect(() => {
    if (placing && stillRef.current && typeof stillRef.current.scrollIntoView === 'function') stillRef.current.scrollIntoView({ block: 'nearest' });
  }, [placing]);
  const demo = look.demo;
  const report = gate ?? l.gate;

  async function act<T>(label: string, path: string, body: unknown, key?: string): Promise<T | null> {
    setFlash(null);
    const r = await send<T>(path, body, key);
    if (!r.ok) {
      const g = r.body?.gate as GateReport | undefined;
      if (g) setGate(g);
      setFlash({ ok: false, text: `${label}: ${r.message} (${r.code})` });
      return null;
    }
    setFlash({ ok: true, text: `${label}: done.` });
    setGate(null);
    await look.reload();
    return r.data;
  }

  /** Back to the piece's own marker button (keyboard and screen-reader users land where they started). */
  function focusMarkerButton(pieceId: string) {
    window.setTimeout(() => document.getElementById(`marker-btn-${pieceId}`)?.focus(), 0);
  }

  async function placeMarker(e: MouseEvent<HTMLDivElement>) {
    if (!placing) return;
    const spot = hotspotFrom(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    const pieceId = placing;
    setPlacing(null);
    if (spot) await act('Marker placed', `/v1/editorial/pieces/${pieceId}`, { hotspot: spot });
    focusMarkerButton(pieceId);
  }

  function cancelPlacing() {
    const pieceId = placing;
    setPlacing(null);
    if (pieceId) focusMarkerButton(pieceId);
  }

  /** Move a piece one place up or down: the new order is written as positions 0..n-1 (only the ones that change). */
  async function reorder(pieceId: string, dir: -1 | 1) {
    const order = [...l.pieces];
    const i = order.findIndex((p) => p.id === pieceId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j] as EditorialPiece, order[i] as EditorialPiece];
    setFlash(null);
    for (const [pos, p] of order.entries()) {
      if (p.position === pos) continue;
      const r = await send(`/v1/editorial/pieces/${p.id}`, { position: pos });
      if (!r.ok) {
        setFlash({ ok: false, text: `Order: ${r.message} (${r.code})` });
        break;
      }
    }
    await look.reload();
  }

  const editable = !demo && l.status !== 'published' && l.status !== 'withdrawn' && !l.takedown_id;
  const pages = useMemo(() => props.value.items.filter((p) => p.platform === 'facebook' || p.platform === 'instagram'), [props.value.items]);

  return (
    <>
      <h1 className="sr-only">Admin: look {l.celebrity?.name ?? ''}</h1>
      <AdminSection
        title={<Link href="/admin/looks">Looks pipeline</Link>}
        titleId="look-editor-title"
        badge={<LiveBadge demo={demo} cause={look.cause} />}
        aside={
          <span className={styles.actions}>
            <Tag>{lookStatusLabel(l.status)}</Tag>
            {l.status === 'published' ? (
              <a href={`/looks/${l.id}`} className={styles.okLine}>
                Open the public page →
              </a>
            ) : null}
          </span>
        }
      >
        <LiveBanner notice={look.notice} />
        <div className={styles.pieceHead}>
          <h2 className={`${styles.h3} ${styles.noMargin}`}>
            {l.celebrity?.name ?? 'No celebrity'} · {[l.moment.event, l.moment.date].filter(Boolean).join(' · ')}
          </h2>
          {l.celebrity ? <Tag variant={statusTone(l.celebrity.rights_status)}>{statusLabel(l.celebrity.rights_status)}</Tag> : null}
        </div>
        <PageNote>
          {l.celebrity ? `The rights allow: ${allowsText(l.celebrity.effective)}. ` : ''}
          This look shows: {l.display.name ? 'the name' : 'nothing'}
          {l.display.image ? ', the still' : ''}
          {l.display.shoppable ? ', products and links' : ', no products'}.{l.library_ref ? ` Library: ${l.library_ref}.` : ''}
          {l.takedown_id ? ' Under a takedown: withdrawn everywhere.' : ''}
        </PageNote>
        {flash ? flash.ok ? <p className={styles.okLine}>{flash.text}</p> : <Banner title="Not done.">{flash.text}</Banner> : null}

        <div className={styles.split}>
          <div className={styles.stack}>
            <StillPanel
              look={l}
              placing={placing}
              stillRef={stillRef}
              onClick={placeMarker}
              onCancel={cancelPlacing}
              demo={demo}
              onScreen={(body) => void act('Still updated', `/v1/editorial/assets/${l.still?.id}`, body)}
            />
            <MomentForm look={l} pages={pages} disabled={!editable} onSave={(body) => void act('Moment saved', `/v1/editorial/looks/${l.id}`, body)} />
          </div>
          <div className={styles.stack}>
            <GatePanel
              report={report}
              status={l.status}
              demo={demo}
              canConfirmPlace={role === 'rights_reviewer' && (l.moment.place_kind === 'street' || l.moment.place_kind === 'other') && !l.moment.place_confirmed_at}
              onConfirmPlace={(note) => void act('Place confirmed', `/v1/editorial/looks/${l.id}/confirm-place`, { note })}
              onMove={(to) => void act(to === 'published' ? 'Publish' : 'Status', `/v1/editorial/looks/${l.id}/transition`, { to })}
              onLinks={() => void act("The look's links", `/v1/editorial/looks/${l.id}/links`, {})}
            />
            <div>
              <h3 className={styles.h4}>The outfit, piece by piece</h3>
              {!editable && !demo ? <p className={styles.okLine}>Unpublish the look to change its pieces (the order and the markers can still move).</p> : null}
              <p className={styles.muted}>
                Pieces in your words, in order. Each piece takes one EXACT product at most (the same item, with evidence and a second person&apos;s approval) and
                any number of SIMILAR ones (the default). Place the marker on the garment, never on a face. Never a celebrity&apos;s name in a label.
              </p>
              {l.pieces.map((p, i) => (
                <PieceEditor
                  key={p.id}
                  piece={p}
                  index={i}
                  count={l.pieces.length}
                  onMove={(dir) => void reorder(p.id, dir)}
                  editable={editable}
                  published={l.status === 'published' && !l.takedown_id}
                  demo={demo}
                  lookPropertyId={l.property?.id ?? null}
                  pages={linkablePages(props.value.items)}
                  placing={placing === p.id}
                  onPlace={() => setPlacing(placing === p.id ? null : p.id)}
                  act={act}
                  hasImage={!!l.still?.public_url}
                />
              ))}
              {l.pieces.length === 0 ? <p className={styles.muted}>No piece yet.</p> : null}
              <AddPiece disabled={!editable} onAdd={(body) => void act('Piece added', `/v1/editorial/looks/${l.id}/pieces`, body, pieceKeys.keyFor({ look: l.id, ...body }))} />
            </div>
          </div>
        </div>
      </AdminSection>
    </>
  );
}

interface StillPanelProps {
  look: EditorialLook;
  placing: string | null;
  stillRef: RefObject<HTMLDivElement>;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  onCancel: () => void;
  onScreen: (body: Record<string, unknown>) => void;
  demo: boolean;
}

function StillPanel({ look, placing, stillRef, onClick, onCancel, onScreen, demo }: StillPanelProps) {
  const s = look.still;
  // As on the page: no marker for a piece worn at the face (type never sits on a face).
  const markers = look.pieces.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => p.hotspot && !NO_MARKER_CATEGORIES.includes(p.category));
  const placingIndex = placing ? look.pieces.findIndex((p) => p.id === placing) : -1;
  const placingPiece = placingIndex >= 0 ? look.pieces[placingIndex] : null;
  return (
    <div className={`${styles.panel} ${placing ? styles.stickyPanel : ''}`} ref={stillRef}>
      <h3 className={styles.h4}>The still and its licence</h3>
      {placingPiece ? (
        <div className={styles.actions} role="status">
          <p className={styles.okLine}>
            Placing the marker for {placingIndex + 1}. {placingPiece.label}: click the garment on the still (or type X and Y in the piece&apos;s row).
          </p>
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {s?.public_url ? (
        <div className={styles.stillBox} onClick={onClick} role="presentation">
          {/* eslint-disable-next-line @next/next/no-img-element -- the library's own host */}
          <img src={s.public_url} alt="The still" className="grayscale" />
          {markers.map(({ p, n }) => (
            <span key={p.id} className={`${styles.marker} ${placing === p.id ? styles.markerActive : ''}`} style={{ left: `${(p.hotspot?.x ?? 0) * 100}%`, top: `${(p.hotspot?.y ?? 0) * 100}%` }}>
              {n}
            </span>
          ))}
        </div>
      ) : (
        <div className={styles.stillEmpty}>{s ? 'No public copy of the still (still_url)' : 'No still'}</div>
      )}
      {s ? (
        <>
          <dl className={`${styles.facts} ${styles.gapTop3}`}>
            <dt>Licence</dt>
            <dd>{s.licence.license ?? '—'}</dd>
            <dt>Commercial reuse</dt>
            <dd>{s.licence.commercial_reuse ?? '—'}</dd>
            <dt>Territory</dt>
            <dd>{s.licence.territory ?? '—'}</dd>
            <dt>Expires</dt>
            <dd>{s.licence.expires_at ? s.licence.expires_at.slice(0, 10) : 'No expiry'}</dd>
            <dt>Copyright</dt>
            <dd>
              {s.licence.copyright_owner ?? '—'}
              {s.licence.author ? ` · shot by ${s.licence.author}` : ''}
            </dd>
            <dt>Chain of title</dt>
            <dd>
              {s.licence.acquisition ?? '—'}
              {s.licence.assignment_ref ? ` · ${s.licence.assignment_ref}` : ''}
            </dd>
            <dt>Source</dt>
            <dd className={styles.mono}>{s.licence.source_ref ?? s.storage_key}</dd>
            <dt>Frame screen</dt>
            <dd>{s.screen_status ?? 'unscreened'}</dd>
          </dl>
          <div className={`${styles.form} ${styles.gapTop3}`}>
            <p className={styles.muted}>
              The frame screen: no minor, no bystander, no home, hospital, school or place of worship, no live performance, no voyeuristic or body-zoom
              framing. Any flag keeps the still off every page.
            </p>
            <div className={styles.formRow}>
              {(
                [
                  ['minor_in_frame', 'A minor in the frame'],
                  ['bystanders', 'Bystanders'],
                  ['sensitive_location', 'A sensitive place'],
                  ['live_performance', 'A live performance'],
                ] as const
              ).map(([k, label]) => (
                <Checkbox key={k} checked={!!s.flags[k]} disabled={demo} onChange={(e) => onScreen({ [k]: e.target.checked })}>
                  {label}
                </Checkbox>
              ))}
            </div>
            <div className={styles.actions}>
              <Button size="sm" disabled={demo || s.screen_status === 'passed'} onClick={() => onScreen({ screen_status: 'passed' })}>
                Frame screen passed
              </Button>
              <Button size="sm" variant="ghost" disabled={demo || s.screen_status === 'rejected'} onClick={() => onScreen({ screen_status: 'rejected' })}>
                Reject the frame
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MomentForm({ look, pages, disabled, onSave }: { look: EditorialLook; pages: PropertyRow[]; disabled: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [f, setF] = useState(() => formOf(look));
  useEffect(() => setF(formOf(look)), [look]);
  const body = {
    event_name: f.event || null,
    place: f.place || null,
    place_kind: f.place_kind || null,
    moment_date: f.date || null,
    property_id: f.property_id || null,
    post_permalink: f.permalink || null,
    platform_post_id: f.post_id || null,
    celebrity_display: f.display,
  };
  return (
    <div className={styles.panel}>
      <h3 className={styles.h4}>The moment</h3>
      <div className={styles.form}>
        <div className={styles.formRow}>
          <Field label="Event" hint="A public event, never a home or hospital">
            <Input value={f.event} disabled={disabled} onChange={(e) => setF({ ...f, event: e.target.value })} />
          </Field>
          <Field label="Place" hint="Coarse: a venue or a city">
            <Input value={f.place} disabled={disabled} onChange={(e) => setF({ ...f, place: e.target.value })} />
          </Field>
        </div>
        <div className={styles.formRow}>
          <Field label="Kind of place">
            <Select value={f.place_kind} disabled={disabled} onChange={(e) => setF({ ...f, place_kind: e.target.value })} placeholder="Not set" options={PLACE_KINDS.map((k) => ({ value: k, label: k }))} />
          </Field>
          <Field label="Date" hint="In the past (never live whereabouts)">
            <Input type="date" value={f.date} disabled={disabled} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Show">
            <Select value={f.display} disabled={disabled} onChange={(e) => setF({ ...f, display: e.target.value })} options={[{ value: 'name_only', label: 'The name only' }, { value: 'name_and_image', label: 'The name and the still' }]} />
          </Field>
        </div>
        <Field label="The in-house page that posted it">
          <Select
            value={f.property_id}
            disabled={disabled}
            onChange={(e) => setF({ ...f, property_id: e.target.value })}
            placeholder="Choose a page"
            options={pages.map((p) => ({ value: p.id, label: `${p.platform}: ${p.account}${p.owner_operated ? '' : ' (not owner-operated)'}` }))}
          />
        </Field>
        <div className={styles.formRow}>
          <Field label="The post (https)">
            <Input value={f.permalink} disabled={disabled} onChange={(e) => setF({ ...f, permalink: e.target.value })} />
          </Field>
          <Field label="The post's id" hint="Comment replies need it">
            <Input value={f.post_id} disabled={disabled} onChange={(e) => setF({ ...f, post_id: e.target.value })} />
          </Field>
        </div>
        <div className={styles.actions}>
          <Button disabled={disabled} onClick={() => onSave(body)}>
            Save the moment
          </Button>
          {disabled ? <span className={styles.muted}>Unpublish the look to change it.</span> : null}
        </div>
      </div>
    </div>
  );
}

function formOf(l: EditorialLook) {
  return {
    event: l.moment.event ?? '',
    place: l.moment.place ?? '',
    place_kind: l.moment.place_kind ?? '',
    date: l.moment.date ?? '',
    property_id: l.property?.id ?? '',
    permalink: l.post.permalink ?? '',
    post_id: l.post.platform_post_id ?? '',
    display: l.celebrity_display === 'name_and_image' ? 'name_and_image' : 'name_only',
  };
}

function GatePanel({
  report,
  status,
  demo,
  canConfirmPlace,
  onConfirmPlace,
  onMove,
  onLinks,
}: {
  report: GateReport;
  status: string;
  demo: boolean;
  canConfirmPlace: boolean;
  onConfirmPlace: (note: string) => void;
  onMove: (to: string) => void;
  onLinks: () => void;
}) {
  const failing = report.checks.filter((c) => !c.ok);
  const [placeNote, setPlaceNote] = useState('');
  return (
    <div className={styles.panel}>
      <h3 className={styles.h4}>Publish gate: {report.ok ? 'every check passes' : `${failing.length} check(s) to fix`}</h3>
      <ul className={styles.checks}>
        {report.checks.map((c) => (
          <li key={c.code}>
            <span className={c.ok ? styles.pass : styles.fail} aria-label={c.ok ? 'passes' : 'fails'}>
              {c.ok ? '✓' : '✗'}
            </span>
            <span>
              {gateLabel(c.code)}
              {!c.ok && c.detail ? <div className={styles.error}>{c.detail}</div> : null}
            </span>
          </li>
        ))}
      </ul>
      {canConfirmPlace ? (
        <div className={`${styles.form} ${styles.gapTop3}`}>
          <Field label="Confirm the place (the rights reviewer)" hint="A public street or place — never a residence, clinic, school or place of worship">
            <Input value={placeNote} onChange={(e) => setPlaceNote(e.target.value)} placeholder="What the place is" />
          </Field>
          <div className={styles.actions}>
            <Button size="sm" disabled={demo || placeNote.trim().length < 3} onClick={() => onConfirmPlace(placeNote.trim())}>
              Confirm the place
            </Button>
          </div>
        </div>
      ) : null}
      <div className={`${styles.actions} ${styles.gapTop3}`}>
        {nextStatuses(status).map((n) => (
          <Button key={n.to} size="sm" variant={n.to === 'published' ? 'primary' : 'secondary'} disabled={demo || (n.to === 'published' && !report.ok)} onClick={() => onMove(n.to)}>
            {n.label}
          </Button>
        ))}
        {status === 'published' ? (
          <Button size="sm" variant="ghost" disabled={demo} onClick={onLinks}>
            Make the look&apos;s links
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface PieceEditorProps {
  piece: EditorialPiece;
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  editable: boolean;
  /** The look is published: labels wait for an unpublish, the order and the markers do not. */
  published: boolean;
  demo: boolean;
  lookPropertyId: string | null;
  pages: PropertyRow[];
  placing: boolean;
  hasImage: boolean;
  onPlace: () => void;
  act: <T>(label: string, path: string, body: unknown, key?: string) => Promise<T | null>;
}

function PieceEditor({ piece, index, count, onMove, editable, published, demo, lookPropertyId, pages, placing, hasImage, onPlace, act }: PieceEditorProps) {
  const [label, setLabel] = useState(piece.label);
  const [category, setCategory] = useState(piece.category);
  useEffect(() => {
    setLabel(piece.label);
    setCategory(piece.category);
  }, [piece.label, piece.category]);
  const items = sortedItems(piece.items);
  const hasExact = items.some((i) => i.match_type === 'exact');
  const noMarker = NO_MARKER_CATEGORIES.includes(piece.category);
  // The order and the markers may change on a published look (they point at the piece, never at a product).
  const movable = !demo && !!piece && (editable || published);

  return (
    <div className={styles.piece} id={`piece-${piece.id}`}>
      <div className={styles.pieceHead}>
        <span className={styles.num}>{index + 1}</span>
        <Input compact value={label} disabled={!editable} onChange={(e) => setLabel(e.target.value)} aria-label={`Piece ${index + 1} label`} className={styles.inline} />
        <Select compact value={category} disabled={!editable} onChange={(e) => setCategory(e.target.value)} aria-label={`Piece ${index + 1} garment category`} className={styles.inline} options={GARMENT_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))} />
        <Button size="xs" disabled={!editable || (label === piece.label && category === piece.category)} onClick={() => void act('Piece saved', `/v1/editorial/pieces/${piece.id}`, { label: label.trim(), garment_category: category })}>
          Save
        </Button>
        <Button size="xs" variant="ghost" disabled={!movable || index === 0} onClick={() => onMove(-1)} aria-label={`Move ${piece.label} up`}>
          ↑
        </Button>
        <Button size="xs" variant="ghost" disabled={!movable || index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${piece.label} down`}>
          ↓
        </Button>
        {noMarker ? (
          <span className={styles.muted}>No marker on the page (worn at the face)</span>
        ) : (
          <Button id={`marker-btn-${piece.id}`} size="xs" variant="ghost" disabled={!movable || !hasImage} onClick={onPlace} aria-pressed={placing}>
            {placing ? 'Click the still… (Cancel beside it)' : piece.hotspot ? 'Move marker' : 'Place marker'}
          </Button>
        )}
        {piece.hotspot ? (
          <Button size="xs" variant="ghost" disabled={!movable} onClick={() => void act('Marker removed', `/v1/editorial/pieces/${piece.id}`, { hotspot: null })}>
            {noMarker ? 'Clear the stored marker' : 'Remove marker'}
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          disabled={!editable}
          aria-label={`Remove the piece ${piece.label}`}
          onClick={() => {
            if (window.confirm(`Remove the piece "${piece.label}" and pause its links?`)) void act('Piece removed', `/v1/editorial/pieces/${piece.id}/remove`, {});
          }}
        >
          Remove
        </Button>
      </div>
      {!noMarker && hasImage ? <MarkerByNumbers piece={piece} index={index} disabled={!movable} act={act} /> : null}
      {items.map((it) => (
        <ItemRowEditor key={it.id} item={it} pieceLabel={piece.label} demo={demo} act={act} />
      ))}
      {items.length === 0 ? <p className={`${styles.muted} ${styles.gapTop2}`}>No product yet: the look cannot be published until every piece has one.</p> : null}
      <TagForm piece={piece} hasExact={hasExact} demo={demo} lookPropertyId={lookPropertyId} pages={pages} act={act} />
    </div>
  );
}

function ItemRowEditor({ item, pieceLabel, demo, act }: { item: EditorialItem; pieceLabel: string; demo: boolean; act: PieceEditorProps['act'] }) {
  const pending = item.match_type === 'exact' && item.review_state === 'pending';
  const price = item.offer && item.offer.price_minor !== null ? formatMoney(item.offer.price_minor, item.offer.currency) : item.offer ? 'No price shown (see the merchant)' : 'No live offer';
  return (
    <div className={`${styles.item} ${item.match_type === 'exact' ? styles.itemExact : ''}`}>
      <div>
        <div>
          <Tag variant={item.match_type === 'exact' ? 'accent' : 'neutral'}>{item.match_type === 'exact' ? 'Exact match' : 'Similar style'}</Tag>{' '}
          {pending ? <Tag variant="outline">Waits for a second person</Tag> : null}
        </div>
        <div className={`${styles.strong} ${styles.gapTop1}`}>
          {item.product.brand} — {item.product.model}
        </div>
        <div className={styles.muted}>
          {price}
          {item.variant.merchant_sku ? ` · ${item.variant.merchant_sku}` : ''} · {item.links.length} link(s)
        </div>
        {item.match_type === 'exact' ? (
          <div className={styles.muted}>
            Evidence: {item.evidence ?? '—'}
            {item.evidence_source ? <div className={styles.mono}>{item.evidence_source}</div> : null}
            {item.match_reviewed_at ? <div>Approved {item.match_reviewed_at.slice(0, 10)}</div> : null}
          </div>
        ) : null}
      </div>
      <div className={styles.actions}>
        {pending ? (
          <>
            <Button size="xs" variant="primary" disabled={demo} onClick={() => void act('EXACT approved', `/v1/editorial/look-items/${item.id}/review`, { decision: 'approve' })}>
              Approve EXACT
            </Button>
            <Button size="xs" disabled={demo} onClick={() => void act('Changed to SIMILAR', `/v1/editorial/look-items/${item.id}/review`, { decision: 'downgrade' })}>
              Make it SIMILAR
            </Button>
            <Button size="xs" variant="ghost" disabled={demo} onClick={() => void act('EXACT rejected', `/v1/editorial/look-items/${item.id}/review`, { decision: 'reject' })}>
              Reject
            </Button>
          </>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          disabled={demo}
          aria-label={`Remove ${item.product.brand} — ${item.product.model} from ${pieceLabel}`}
          onClick={() => {
            if (window.confirm('Remove this product from the piece and pause its links?')) void act('Product removed', `/v1/editorial/look-items/${item.id}/remove`, {});
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

function TagForm({ piece, hasExact, demo, lookPropertyId, pages, act }: { piece: EditorialPiece; hasExact: boolean; demo: boolean; lookPropertyId: string | null; pages: PropertyRow[]; act: PieceEditorProps['act'] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ input: '', brand: '', model: '', category: 'Clothing', match_type: 'similar' as 'similar' | 'exact', evidence: '', evidence_source: '' });
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<InstantLinksResult | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    if (lookPropertyId) setChosen([lookPropertyId]);
  }, [lookPropertyId]);
  const [touched, setTouched] = useState(false);
  const problems = [
    ...tagProblems({ ...f, input: f.input, brand: f.brand, model: f.model }),
    ...(f.match_type === 'exact' && hasExact ? ['This piece has its EXACT product already (one per piece).'] : []),
  ];
  const ready = looksLikeProductInput(f.input) && problems.length === 0;

  async function submit() {
    setTouched(true);
    if (!ready) return;
    const body = {
      asin_or_url: f.input.trim(),
      brand: f.brand.trim(),
      model: f.model.trim(),
      category: f.category.trim(),
      piece_id: piece.id,
      match_type: f.match_type,
      property_ids: chosen,
      ...(f.match_type === 'exact' ? { evidence: f.evidence.trim(), evidence_source: f.evidence_source.trim(), evidence_captured_at: new Date().toISOString() } : {}),
    };
    const r = await act<InstantLinksResult>('Product tagged', '/v1/editorial/instant-links', body, instantKeys.keyFor(body));
    if (r) {
      setResult(r);
      setTouched(false);
      setF({ ...f, input: '', brand: '', model: '', evidence: '', evidence_source: '' });
    }
  }
  const blur = () => setTouched(true);

  if (!open) {
    return (
      <div className={`${styles.actions} ${styles.gapTop2}`}>
        <Button size="xs" disabled={demo} onClick={() => setOpen(true)}>
          + Tag a product (paste an amazon.in link)
        </Button>
        <ExistingOfferTag piece={piece} demo={demo} act={act} />
      </div>
    );
  }
  return (
    <div className={`${styles.panel} ${styles.gapTop2}`}>
      <div className={styles.form}>
        <Field label="amazon.in link or ASIN" labelSuffix="(required)">
          <Input value={f.input} onChange={(e) => setF({ ...f, input: e.target.value })} onBlur={blur} placeholder="Paste the product link or its ASIN" />
        </Field>
        <p className={styles.muted}>
          In your own words (nothing is copied from Amazon). Never a celebrity&apos;s name, &quot;as worn by&quot;, &quot;dupe&quot;, &quot;for less&quot;,
          &quot;inspired&quot;, &quot;first copy&quot; or a brand-style name.
        </p>
        <div className={styles.formRow}>
          <Field label="Brand" labelSuffix="(required)">
            <Input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} onBlur={blur} />
          </Field>
          <Field label="Product" labelSuffix="(required)">
            <Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} onBlur={blur} />
          </Field>
          <Field label="Category">
            <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          </Field>
        </div>
        <Field label="Match">
          <Select
            value={f.match_type}
            onChange={(e) => setF({ ...f, match_type: e.target.value as 'similar' | 'exact' })}
            options={[
              { value: 'similar', label: 'SIMILAR: a similar style (the default)' },
              { value: 'exact', label: 'EXACT: the same item the celebrity wore (evidence required)', disabled: hasExact },
            ]}
          />
        </Field>
        {f.match_type === 'exact' ? (
          <>
            <Field label="Evidence" labelSuffix="(required)" hint="What shows it is the same item: the brand's tag, a label, a detail at a timecode. A second editor approves it.">
              <Textarea rows={2} value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} />
            </Field>
            <Field label="Evidence source" labelSuffix="(required)" hint="A URL or the library reference with its timecode">
              <Input value={f.evidence_source} onChange={(e) => setF({ ...f, evidence_source: e.target.value })} />
            </Field>
          </>
        ) : null}
        <Field label="Tracked links for" group hint="Pages with their own tracking ID only (the Amazon rule). The look page's own link is made when it is published.">
          <div className={styles.formRow}>
            {pages.map((p) => (
              <Checkbox key={p.id} checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))}>
                {p.platform}: {p.account}
              </Checkbox>
            ))}
            {pages.length === 0 ? <span className={styles.muted}>No page has its own tracking ID yet.</span> : null}
          </div>
        </Field>
        {touched && problems.length ? (
          <ul className={styles.problems} aria-live="polite">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={() => void submit()}>
            Tag into “{piece.label}”
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
        {result ? <InstantResult result={result} /> : null}
      </div>
    </div>
  );
}

function ExistingOfferTag({ piece, demo, act }: { piece: EditorialPiece; demo: boolean; act: PieceEditorProps['act'] }) {
  const [open, setOpen] = useState(false);
  const [offerId, setOfferId] = useState('');
  if (!open) {
    return (
      <Button size="xs" variant="ghost" disabled={demo} onClick={() => setOpen(true)}>
        Tag an existing offer (SIMILAR)
      </Button>
    );
  }
  const body = { offer_id: offerId.trim(), match_type: 'similar' };
  return (
    <span className={styles.actions}>
      <Input compact value={offerId} onChange={(e) => setOfferId(e.target.value)} placeholder="Offer id (uuid)" aria-label="Offer id" className={styles.inline} />
      <Button size="xs" disabled={!/^[0-9a-f-]{36}$/i.test(offerId.trim())} onClick={() => void act('Product tagged', `/v1/editorial/pieces/${piece.id}/items`, body, tagKeys.keyFor({ piece: piece.id, ...body }))}>
        Tag
      </Button>
    </span>
  );
}

export function InstantResult({ result }: { result: InstantLinksResult }) {
  return (
    <div>
      <p className={styles.okLine}>
        ASIN {result.asin}: offer {result.offer.created ? 'created' : 'found'}
        {result.item ? `; tagged ${result.item.match_type.toUpperCase()}${result.item.review_state === 'pending' ? ' (waits for a second person)' : ''}` : ''}.
      </p>
      {result.links_withheld ? <p className={styles.error}>Links withheld: {result.links_withheld}</p> : null}
      {result.links.length ? (
        <table className={`${styles.matrix} ${styles.gapTop2}`}>
          <thead>
            <tr>
              <th>Page</th>
              <th>Tracking ID</th>
              <th>Link (posts on that page only)</th>
            </tr>
          </thead>
          <tbody>
            {result.links.map((row) => (
              <tr key={row.property_id}>
                <td>
                  {row.platform}: {row.account}
                </td>
                <td className={styles.mono}>{row.tracking_id ?? '—'}</td>
                <td>
                  {row.link_url ? (
                    <>
                      <span className={styles.mono}>{row.link_url}</span>
                      <div className={styles.muted}>{row.post_label}</div>
                    </>
                  ) : (
                    <span className={styles.error}>{row.refused ? `${row.refused.code}: ${row.refused.message}` : 'Not made'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {result.look_url ? (
        <p className={`${styles.muted} ${styles.gapTop2}`}>
          For a message or a comment reply, only the look page: <span className={styles.mono}>{result.look_url}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The keyboard route to a marker: X and Y as a percentage of the still's width and height. */
function MarkerByNumbers({ piece, index, disabled, act }: { piece: EditorialPiece; index: number; disabled: boolean; act: PieceEditorProps['act'] }) {
  const pct = (v: number | null | undefined) => (typeof v === 'number' ? String(Math.round(v * 1000) / 10) : '');
  const [x, setX] = useState(pct(piece.hotspot?.x));
  const [y, setY] = useState(pct(piece.hotspot?.y));
  useEffect(() => {
    setX(pct(piece.hotspot?.x));
    setY(pct(piece.hotspot?.y));
  }, [piece.hotspot?.x, piece.hotspot?.y]);
  const nx = Number(x);
  const ny = Number(y);
  const valid = x.trim() !== '' && y.trim() !== '' && nx >= 0 && nx <= 100 && ny >= 0 && ny <= 100;
  return (
    <div className={`${styles.actions} ${styles.gapTop2}`}>
      <span className={styles.muted}>Marker at</span>
      <Input compact type="number" min={0} max={100} step={0.1} value={x} disabled={disabled} onChange={(e) => setX(e.target.value)} aria-label={`Piece ${index + 1} marker X, % of the width`} className={styles.numberInput} />
      <span className={styles.muted}>% across,</span>
      <Input compact type="number" min={0} max={100} step={0.1} value={y} disabled={disabled} onChange={(e) => setY(e.target.value)} aria-label={`Piece ${index + 1} marker Y, % of the height`} className={styles.numberInput} />
      <span className={styles.muted}>% down</span>
      <Button size="xs" disabled={disabled || !valid} onClick={() => void act('Marker placed', `/v1/editorial/pieces/${piece.id}`, { hotspot: { x: Math.round(nx * 100) / 10_000, y: Math.round(ny * 100) / 10_000 } })}>
        Set the marker
      </Button>
    </div>
  );
}

function AddPiece({ disabled, onAdd }: { disabled: boolean; onAdd: (body: { label: string; garment_category: string }) => void }) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<string>('top');
  return (
    <div className={`${styles.actions} ${styles.gapTop3}`}>
      <Input compact value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New piece, e.g. The jacket" aria-label="New piece label" disabled={disabled} className={styles.inline} />
      <Select compact value={category} onChange={(e) => setCategory(e.target.value)} aria-label="New piece category" disabled={disabled} className={styles.inline} options={GARMENT_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))} />
      <Button size="sm" disabled={disabled || label.trim() === ''} onClick={() => { onAdd({ label: label.trim(), garment_category: category }); setLabel(''); }}>
        Add piece
      </Button>
    </div>
  );
}
