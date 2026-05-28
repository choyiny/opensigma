export interface Env {
  DB: D1Database;
  BACKLOAD_QUEUE: Queue<BackloadJob>;
  STRIPE_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

export interface BackloadJob {
  resource:
    | 'customers'
    | 'products'
    | 'prices'
    | 'subscriptions'
    | 'invoices'
    | 'charges'
    | 'payment_intents'
    | 'refunds';
  cursor: string | null;
}
