import Stripe from 'stripe';

export function getStripe(apiKey: string): Stripe {
  return new Stripe(apiKey, {
    apiVersion: '2024-10-28.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}
