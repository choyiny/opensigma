export interface Env {
  DB: D1Database;
  BACKLOAD_QUEUE: Queue<BackloadJob>;
  STRIPE_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

export type AccountListableResource =
  | 'customers' | 'products' | 'prices' | 'subscriptions'
  | 'invoices' | 'charges' | 'payment_intents' | 'refunds'
  | 'disputes' | 'payouts' | 'credit_notes' | 'checkout_sessions'
  | 'setup_intents' | 'coupons' | 'promotion_codes'
  | 'subscription_schedules' | 'reviews' | 'early_fraud_warnings'
  | 'balance_transactions';

export type PerParentResource =
  | 'payment_methods' | 'tax_ids'
  | 'credit_note_line_items' | 'checkout_session_line_items'
  | 'invoice_line_items';

export type BackloadJob =
  | { kind: 'page'; resource: AccountListableResource; cursor: string | null }
  | { kind: 'child-page'; resource: PerParentResource; parent_id: string; cursor: string | null }
  | { kind: 'events' };
