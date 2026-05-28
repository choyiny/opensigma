import type Stripe from 'stripe';
import type { DB } from '../db/client';
import type { AccountListableResource, PerParentResource } from '../env';
import { upsertCustomer } from '../upserts/customers';
import { upsertProduct } from '../upserts/products';
import { upsertPrice } from '../upserts/prices';
import { upsertSubscription } from '../upserts/subscriptions';
import { upsertInvoice } from '../upserts/invoices';
import { upsertCharge } from '../upserts/charges';
import { upsertPaymentIntent } from '../upserts/payment_intents';
import { upsertRefund } from '../upserts/refunds';
import { upsertDispute } from '../upserts/disputes';
import { upsertPayout } from '../upserts/payouts';

export interface AccountListBinding {
  list: (stripe: Stripe, cursor: string | null) => Promise<{ data: any[]; has_more: boolean }>;
  upsert: (db: DB, obj: any, ts: number) => Promise<void>;
  /**
   * Optional hook fired for every object on the page during backload.
   * Used by parents (customers, invoices, credit_notes, checkout_sessions)
   * to seed backload_parent_progress rows for their child resources.
   */
  onObject?: (db: DB, obj: any) => Promise<void>;
}

export interface ChildListBinding {
  /** Identifier of the parent resource whose backload must finish before
   *  this child resource can flip to `done`. */
  parentResource: AccountListableResource;
  list: (stripe: Stripe, parentId: string, cursor: string | null) => Promise<{ data: any[]; has_more: boolean }>;
  upsert: (db: DB, obj: any, ts: number) => Promise<void>;
}

export const ACCOUNT_RESOURCES: Record<AccountListableResource, AccountListBinding> = {
  customers: {
    list: (s, c) => s.customers.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertCustomer(db, obj, ts),
  },
  products: {
    list: (s, c) => s.products.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertProduct(db, obj, ts),
  },
  prices: {
    list: (s, c) => s.prices.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertPrice(db, obj, ts),
  },
  subscriptions: {
    list: (s, c) => s.subscriptions.list({ limit: 100, starting_after: c ?? undefined, status: 'all' }) as any,
    upsert: (db, obj, ts) => upsertSubscription(db, obj, ts),
  },
  invoices: {
    list: (s, c) => s.invoices.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertInvoice(db, obj, ts),
  },
  charges: {
    list: (s, c) => s.charges.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertCharge(db, obj, ts),
  },
  payment_intents: {
    list: (s, c) => s.paymentIntents.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertPaymentIntent(db, obj, ts),
  },
  refunds: {
    list: (s, c) => s.refunds.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertRefund(db, obj, ts),
  },
  disputes: {
    list: (s, c) => s.disputes.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertDispute(db, obj, ts),
  },
  payouts: {
    list: (s, c) => s.payouts.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertPayout(db, obj, ts),
  },
  // disputes, payouts, credit_notes, checkout_sessions, setup_intents, coupons,
  // promotion_codes, subscription_schedules, reviews, early_fraud_warnings
  // are added by their respective tasks in Phase C.
} as Record<AccountListableResource, AccountListBinding>;

export const PER_PARENT_RESOURCES = {} as Record<PerParentResource, ChildListBinding>;
