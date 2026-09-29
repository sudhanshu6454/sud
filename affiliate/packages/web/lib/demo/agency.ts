/**
 * TEST DEMO DATA — NOT REAL. Extras for the agency workspace (3e) beyond
 * lib/demo/afflino.ts (DEMO_AGENCY, DEMO_AGENCY_CLIENTS, DEMO_AGENCY_ROSTER,
 * which carry the drawn names and numbers). No v1 endpoint serves agencies,
 * so the page shows <DemoBadge variant="mock" />.
 */

import { DEMO_OFFER_CATEGORIES, type Platform } from './afflino';

/** The roster's "Earned · Sep" column. */
export const DEMO_AGENCY_PERIOD = { month: 'September', monthShort: 'Sep' } as const;

/** Category choices in the "Add brand client" dialog: the offer browser's categories, plus Other. */
export const AGENCY_CLIENT_CATEGORIES: ReadonlyArray<string> = [...DEMO_OFFER_CATEGORIES, 'Other'];

/** Main-platform choices in the "Invite creator" dialog. */
export const AGENCY_INVITE_PLATFORMS: ReadonlyArray<Platform> = ['instagram', 'youtube', 'snapchat', 'telegram', 'web'];
