import Stripe from 'stripe';

export function getStripe(apiKey: string): Stripe {
  return new Stripe(apiKey, {
    apiVersion: '2026-05-27.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}
