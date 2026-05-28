import Stripe from 'stripe';

export function getStripe(apiKey: string): Stripe {
  return new Stripe(apiKey, {
    // The D1 schema mirrors sync-engine, which targets the 2024-10-28.acacia
    // Stripe API. The installed SDK's TS types only expose the latest
    // apiVersion string; per Stripe's own guidance, ts-ignore is the
    // sanctioned escape hatch for pinning an older API version.
    // @ts-ignore - pinning to acacia, see Stripe SDK lib.d.ts apiVersion docs
    apiVersion: '2024-10-28.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}
