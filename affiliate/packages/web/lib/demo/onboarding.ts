/**
 * TEST DEMO DATA — NOT REAL. What the /join demo flows fill in, because no
 * OAuth (Instagram / YouTube / Snapchat), SMS or PAN-verification provider
 * exists: "Connect" marks a platform connected with the account below, and a
 * PAN that passes the format check shows the demo holder name. Nothing is
 * read from any platform and nothing is verified.
 *
 * Same rule as lib/demo/afflino.ts (platform invariant 11): every name is
 * "Demo …" / "demo.…". Instagram and YouTube are the 3a artboard's rows
 * (DEMO_CREATOR); Snapchat is not drawn connected anywhere in the design,
 * so its handle and figures are invented TEST values.
 */

import type { PlatformId } from '../onboarding';
import { DEMO_CREATOR } from './afflino';

export interface DemoConnectedAccount {
  /** Handle or channel name as the row prints it. */
  handle: string;
  followers: number;
  /** Share of the audience in India, in percent; null where the design prints none (YouTube). */
  pctIndia: number | null;
}

export const DEMO_CONNECTED_ACCOUNTS: Readonly<Record<PlatformId, DemoConnectedAccount>> = {
  // 3a: "@priyanair · 1.2M · 84% India"
  instagram: {
    handle: DEMO_CREATOR.instagramHandle,
    followers: DEMO_CREATOR.followersInstagram,
    pctIndia: DEMO_CREATOR.pctIndiaInstagram,
  },
  // 3a: "Priya Nair Money · 310K"
  youtube: { handle: DEMO_CREATOR.youtubeChannel, followers: DEMO_CREATOR.subscribersYoutube, pctIndia: null },
  // Not drawn: TEST values.
  snapchat: { handle: '@demo.priyanair', followers: 96_000, pctIndia: 88 },
};

/** 3a "Verified · PRIYA NAIR" — the demo PAN holder name (DEMO_CREATOR.panName). */
export const DEMO_PAN_HOLDER = DEMO_CREATOR.panName;
