/**
 * Stub-network fixtures: a fake merchant, programme, capabilities and offers.
 *
 * These exist so the full pipeline (link -> click -> conversion -> outbox ->
 * reconciliation) can be exercised locally without any real affiliate
 * relationship. Nothing here is a real merchant, rate, or approval.
 */

import type { ConnectorCapabilities } from '@paparazzi/shared';

export interface MerchantFixture {
  id: string;
  name: string;
}

export interface ProgrammeFixture {
  id: string;
  connector: string;
  merchant_id: string;
}

export interface OfferFixture {
  offer_id: string;
  /** Integer minor units (paise for INR). */
  price_minor: number;
  currency: 'INR';
  url: string;
}

export const stubMerchant: MerchantFixture = {
  id: 'merch_stub_1',
  name: 'StubMart',
};

export const stubProgramme: ProgrammeFixture = {
  id: 'prog_stub_1',
  connector: 'stub-network',
  merchant_id: stubMerchant.id,
};

export const stubCapabilities: ConnectorCapabilities = {
  countries: ['IN'],
  currencies: ['INR'],
  supportsSubpublisher: true,
  attributionWindowDays: 30,
  reportingLatencyHours: 2,
  returnsWindowDays: 15,
  itemLevelData: true,
  socialAppPermissions: ['web'],
};

export const stubOffers: OfferFixture[] = [
  {
    offer_id: 'offer_1',
    price_minor: 199900, // INR 1,999.00
    currency: 'INR',
    url: 'https://stubmart.example/p/offer_1',
  },
  {
    offer_id: 'offer_2',
    price_minor: 499900, // INR 4,999.00
    currency: 'INR',
    url: 'https://stubmart.example/p/offer_2',
  },
  {
    offer_id: 'offer_3',
    price_minor: 299900, // INR 2,999.00
    currency: 'INR',
    url: 'https://stubmart.example/p/offer_3',
  },
];
