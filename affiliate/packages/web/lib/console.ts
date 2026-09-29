/**
 * Editorial console pipeline state.
 *
 * Client-side only (localStorage `paparazzi_console_looks`), seeded with demo
 * looks when empty. No API wiring yet — the review workflow API is not part of
 * the documented v1 surface, so all moves are local and clearly internal.
 */

export type ConsoleState =
  | 'draft'
  | 'product_review'
  | 'commercial_review'
  | 'ready'
  | 'published'
  | 'paused';

export const STATES: { id: ConsoleState; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'product_review', label: 'Product review' },
  { id: 'commercial_review', label: 'Commercial review' },
  { id: 'ready', label: 'Ready' },
  { id: 'published', label: 'Published' },
  { id: 'paused', label: 'Paused / Withdrawn' },
];

export function stateLabel(state: ConsoleState): string {
  return STATES.find((s) => s.id === state)?.label ?? state;
}

export interface Gate {
  id: string;
  label: string;
}

/** A guarded move between two states. `gates` must all be checked to proceed. */
export interface Transition {
  id: string;
  from: ConsoleState;
  to: ConsoleState;
  label: string;
  gates: Gate[];
  /** Pause/withdraw: needs a free-text reason instead of gates. */
  requiresReason?: boolean;
  /** Ready→Published: record the live post details on completion. */
  recordPublish?: boolean;
}

export const TRANSITIONS: Transition[] = [
  {
    id: 'draft>product_review',
    from: 'draft',
    to: 'product_review',
    label: 'Send to product review',
    gates: [
      { id: 'source_asset', label: 'Source asset attached' },
      { id: 'creator', label: 'Creator identified' },
      { id: 'usage_rights', label: 'Usage rights captured' },
      { id: 'target_category', label: 'Target category set' },
    ],
  },
  {
    id: 'product_review>commercial_review',
    from: 'product_review',
    to: 'commercial_review',
    label: 'Send to commercial review',
    gates: [
      { id: 'match_status', label: 'Exact / similar status set for every product' },
      { id: 'evidence', label: 'Match evidence attached' },
      { id: 'fresh_offer', label: 'Offer is fresh (not stale)' },
    ],
  },
  {
    id: 'commercial_review>ready',
    from: 'commercial_review',
    to: 'ready',
    label: 'Mark ready',
    gates: [
      { id: 'merchant', label: 'Merchant selected' },
      { id: 'property', label: 'Property approved' },
      { id: 'placement', label: 'Placement configured' },
      { id: 'geo', label: 'Geography eligibility confirmed' },
    ],
  },
  {
    id: 'ready>published',
    from: 'ready',
    to: 'published',
    label: 'Publish',
    gates: [
      { id: 'disclosure', label: 'Affiliate disclosure added' },
      { id: 'caption', label: 'Caption written' },
      { id: 'destination', label: 'Destination URL verified' },
      { id: 'media_approval', label: 'Media approval granted' },
    ],
    recordPublish: true,
  },
];

export interface PublishRecord {
  url: string;
  postId: string;
  publisher: string;
  placement: string;
  creativeVersion: string;
}

export interface CandidateMatch {
  productId: string;
  /** Set on the review screen; null = undecided. */
  verdict: 'exact' | 'similar' | null;
  evidence: string;
}

export interface ConsoleLook {
  id: string;
  title: string;
  sourcePage: string;
  category: string;
  state: ConsoleState;
  /** Gate checkmarks, keyed `${transitionId}:${gateId}`. */
  checks: Record<string, boolean>;
  /** State to resume to after a pause. */
  resumeState?: ConsoleState;
  pauseReason?: string;
  publishRecord?: PublishRecord;
  candidates: CandidateMatch[];
  /** Rights checklist from the match-review screen. */
  rights: Record<string, boolean>;
  updatedAt: string; // ISO
}

export const RIGHTS_GATES: Gate[] = [
  { id: 'footage_license', label: 'Footage licence covers the source asset' },
  { id: 'commercial_reuse', label: 'Commercial reuse permitted' },
  { id: 'territory', label: 'Territory cleared (IN)' },
  { id: 'expiry', label: 'Rights expiry checked and on file' },
];

const STORAGE_KEY = 'paparazzi_console_looks';

function seed(): ConsoleLook[] {
  const t = new Date().toISOString();
  return [
    {
      id: 'look-1',
      title: 'Demo airport street style',
      sourcePage: 'Demo Candid Frames',
      category: 'Fashion',
      state: 'product_review',
      checks: {},
      candidates: [
        { productId: 'p3', verdict: null, evidence: '' },
        { productId: 'p1', verdict: null, evidence: '' },
      ],
      rights: {},
      updatedAt: t,
    },
    {
      id: 'look-2',
      title: 'Demo red-carpet evening look',
      sourcePage: 'Demo Star Sightings',
      category: 'Accessories',
      state: 'draft',
      checks: {
        'draft>product_review:source_asset': true,
        'draft>product_review:creator': true,
      },
      candidates: [
        { productId: 'p4', verdict: null, evidence: '' },
        { productId: 'p5', verdict: null, evidence: '' },
      ],
      rights: {},
      updatedAt: t,
    },
    {
      id: 'look-3',
      title: 'Demo monsoon city stroll',
      sourcePage: 'Demo Candid Frames',
      category: 'Footwear',
      state: 'commercial_review',
      checks: {},
      candidates: [
        { productId: 'p2', verdict: 'similar', evidence: 'Toe shape differs; same colour family.' },
        { productId: 'p6', verdict: null, evidence: '' },
      ],
      rights: {
        footage_license: true,
        commercial_reuse: true,
        territory: true,
        expiry: true,
      },
      updatedAt: t,
    },
    {
      id: 'look-4',
      title: 'Demo fashion week front row',
      sourcePage: 'Demo Style Diaries',
      category: 'Fashion',
      state: 'paused',
      resumeState: 'ready',
      pauseReason: 'Brand requested takedown review.',
      checks: {},
      candidates: [{ productId: 'p4', verdict: 'similar', evidence: 'Same silhouette, different label.' }],
      rights: {},
      updatedAt: t,
    },
  ];
}

export function loadLooks(): ConsoleLook[] {
  if (typeof window === 'undefined') return seed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const s = seed();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return s;
    }
    return JSON.parse(raw) as ConsoleLook[];
  } catch {
    return seed();
  }
}

export function saveLooks(looks: ConsoleLook[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(looks));
  } catch {
    /* storage full or unavailable — board stays in memory */
  }
}

export function getLook(id: string, looks: ConsoleLook[]): ConsoleLook | undefined {
  return looks.find((l) => l.id === id);
}

/** Next forward transition available from a state (pause handled separately). */
export function nextTransition(state: ConsoleState): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === state);
}
