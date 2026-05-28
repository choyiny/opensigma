import type Stripe from 'stripe';
import type { DB } from '../db/client';
import type { AccountListableResource, PerParentResource } from '../env';
import { upsertCustomer } from '../upserts/customers';
import { upsertProduct } from '../upserts/products';
import { upsertPrice } from '../upserts/prices';
import { upsertSubscription } from '../upserts/subscriptions';
import { upsertInvoice } from '../upserts/invoices';
import { upsertInvoiceLineItem } from '../upserts/invoice_line_items';
import { upsertCharge } from '../upserts/charges';
import { upsertPaymentIntent } from '../upserts/payment_intents';
import { upsertRefund } from '../upserts/refunds';
import { upsertDispute } from '../upserts/disputes';
import { upsertPayout } from '../upserts/payouts';
import { upsertSetupIntent } from '../upserts/setup_intents';
import { upsertCoupon } from '../upserts/coupons';
import { upsertPromotionCode } from '../upserts/promotion_codes';
import { upsertSubscriptionSchedule } from '../upserts/subscription_schedules';
import { upsertReview } from '../upserts/reviews';
import { upsertEarlyFraudWarning } from '../upserts/early_fraud_warnings';
import { upsertCreditNote, upsertCreditNoteLine } from '../upserts/credit_notes';
import { upsertCheckoutSession, upsertCheckoutSessionLine } from '../upserts/checkout_sessions';
import { upsertPaymentMethod } from '../upserts/payment_methods';
import { upsertTaxId } from '../upserts/tax_ids';
import { backloadParentProgress } from '../db/schema';

export interface AccountListBinding {
  list: (stripe: Stripe, cursor: string | null) => Promise<{ data: any[]; has_more: boolean }>;
  upsert: (db: DB, obj: any, ts: number, stripe?: Stripe) => Promise<void>;
  /**
   * Optional hook fired for every object on the page during backload.
   * Used by parents (customers, invoices, credit_notes, checkout_sessions)
   * to upsert any inline-expanded children and seed backload_parent_progress
   * rows when the embedded child list reports has_more.
   */
  onObject?: (db: DB, obj: any, stripe: Stripe) => Promise<void>;
}

export interface ChildListBinding {
  /** Identifier of the parent resource whose backload must finish before
   *  this child resource can flip to `done`. */
  parentResource: AccountListableResource;
  list: (stripe: Stripe, parentId: string, cursor: string | null) => Promise<{ data: any[]; has_more: boolean }>;
  upsert: (db: DB, obj: any, ts: number, stripe?: Stripe) => Promise<void>;
}

export const ACCOUNT_RESOURCES: Record<AccountListableResource, AccountListBinding> = {
  customers: {
    list: (s, c) => s.customers.list({
      limit: 100,
      starting_after: c ?? undefined,
      expand: ['data.tax_ids'],
    }) as any,
    upsert: (db, obj, ts) => upsertCustomer(db, obj, ts),
    onObject: async (db, obj) => {
      // payment_methods isn't expandable on customer — always seed for fallback.
      await db.insert(backloadParentProgress).values({
        resource: 'payment_methods', parentId: obj.id, status: 'idle', updatedAt: Date.now(),
      }).onConflictDoNothing();

      const taxIdsField = (obj as any).tax_ids;
      const data: any[] = taxIdsField?.data ?? [];
      for (const t of data) {
        await upsertTaxId(db, t, obj.created);
      }
      if (!taxIdsField || taxIdsField.has_more) {
        const lastId = data.length > 0 ? data[data.length - 1].id : null;
        await db.insert(backloadParentProgress).values({
          resource: 'tax_ids',
          parentId: obj.id,
          cursor: lastId,
          status: 'idle',
          updatedAt: Date.now(),
        }).onConflictDoNothing();
      }
    },
  },
  products: {
    list: (s, c) => s.products.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertProduct(db, obj, ts),
  },
  prices: {
    list: (s, c) => s.prices.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts, stripe) => upsertPrice(db, obj, ts, { stripe }),
  },
  subscriptions: {
    list: (s, c) => s.subscriptions.list({ limit: 100, starting_after: c ?? undefined, status: 'all' }) as any,
    upsert: (db, obj, ts) => upsertSubscription(db, obj, ts),
  },
  invoices: {
    // `lines` is included by default on Invoice (first ~10 with has_more).
    list: (s, c) => s.invoices.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertInvoice(db, obj, ts),
    onObject: async (db, obj, stripe) => {
      const lines = (obj as any).lines;
      const data: any[] = lines?.data ?? [];
      for (const line of data) {
        await upsertInvoiceLineItem(db, line, obj.id, obj.created, { stripe });
      }
      // Only seed the per-parent fallback when there are more pages to fetch.
      if (!lines || lines.has_more) {
        const lastId = data.length > 0 ? data[data.length - 1].id : null;
        await db.insert(backloadParentProgress).values({
          resource: 'invoice_line_items',
          parentId: obj.id,
          cursor: lastId,
          status: 'idle',
          updatedAt: Date.now(),
        }).onConflictDoNothing();
      }
    },
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
  setup_intents: {
    list: (s, c) => s.setupIntents.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertSetupIntent(db, obj, ts),
  },
  coupons: {
    list: (s, c) => s.coupons.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertCoupon(db, obj, ts),
  },
  promotion_codes: {
    list: (s, c) => s.promotionCodes.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertPromotionCode(db, obj, ts),
  },
  subscription_schedules: {
    list: (s, c) => s.subscriptionSchedules.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertSubscriptionSchedule(db, obj, ts),
  },
  reviews: {
    list: (s, c) => s.reviews.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertReview(db, obj, ts),
  },
  early_fraud_warnings: {
    list: (s, c) => s.radar.earlyFraudWarnings.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertEarlyFraudWarning(db, obj, ts),
  },
  credit_notes: {
    list: (s, c) => s.creditNotes.list({
      limit: 100,
      starting_after: c ?? undefined,
      expand: ['data.lines'],
    }) as any,
    upsert: (db, obj, ts) => upsertCreditNote(db, obj, ts),
    onObject: async (db, obj) => {
      const lines = (obj as any).lines;
      const data: any[] = lines?.data ?? [];
      for (const line of data) {
        await upsertCreditNoteLine(db, line, obj.id, obj.created);
      }
      if (!lines || lines.has_more) {
        const lastId = data.length > 0 ? data[data.length - 1].id : null;
        await db.insert(backloadParentProgress).values({
          resource: 'credit_note_line_items',
          parentId: obj.id,
          cursor: lastId,
          status: 'idle',
          updatedAt: Date.now(),
        }).onConflictDoNothing();
      }
    },
  },
  checkout_sessions: {
    list: (s, c) => s.checkout.sessions.list({
      limit: 100,
      starting_after: c ?? undefined,
      expand: ['data.line_items'],
    }) as any,
    upsert: (db, obj, ts) => upsertCheckoutSession(db, obj, ts),
    onObject: async (db, obj, stripe) => {
      const lines = (obj as any).line_items;
      const data: any[] = lines?.data ?? [];
      for (const line of data) {
        await upsertCheckoutSessionLine(db, line, obj.id, obj.created, { stripe });
      }
      if (!lines || lines.has_more) {
        const lastId = data.length > 0 ? data[data.length - 1].id : null;
        await db.insert(backloadParentProgress).values({
          resource: 'checkout_session_line_items',
          parentId: obj.id,
          cursor: lastId,
          status: 'idle',
          updatedAt: Date.now(),
        }).onConflictDoNothing();
      }
    },
  },
  // Remaining parent/child resources are added by their respective tasks in Phase C.
} as Record<AccountListableResource, AccountListBinding>;

export const PER_PARENT_RESOURCES: Record<PerParentResource, ChildListBinding> = {
  payment_methods: {
    parentResource: 'customers',
    list: (s, parentId, c) =>
      (s as any).customers.listPaymentMethods(parentId, { limit: 100, starting_after: c ?? undefined }),
    upsert: (db, obj, ts) => upsertPaymentMethod(db, obj, ts),
  },
  tax_ids: {
    parentResource: 'customers',
    list: (s, parentId, c) =>
      (s as any).customers.listTaxIds(parentId, { limit: 100, starting_after: c ?? undefined }),
    upsert: (db, obj, ts) => upsertTaxId(db, obj, ts),
  },
  credit_note_line_items: {
    parentResource: 'credit_notes',
    list: async (s, parentId, c) => {
      const page = await (s as any).creditNotes.listLines(parentId, {
        limit: 100,
        starting_after: c ?? undefined,
      });
      for (const line of page.data) line.credit_note = parentId;
      return page;
    },
    upsert: (db, obj, ts) => upsertCreditNoteLine(db, obj, obj.credit_note ?? '', ts),
  },
  invoice_line_items: {
    parentResource: 'invoices',
    list: async (s, parentId, c) => {
      const page = await (s as any).invoices.listLineItems(parentId, {
        limit: 100,
        starting_after: c ?? undefined,
      });
      for (const line of page.data) line.invoice = parentId;
      return page;
    },
    upsert: (db, obj, ts, stripe) =>
      upsertInvoiceLineItem(db, obj, (obj as any).invoice ?? '', ts, { stripe }),
  },
  checkout_session_line_items: {
    parentResource: 'checkout_sessions',
    list: async (s, parentId, c) => {
      const page = await (s as any).checkout.sessions.listLineItems(parentId, {
        limit: 100,
        starting_after: c ?? undefined,
      });
      for (const line of page.data) line.checkout_session = parentId;
      return page;
    },
    upsert: (db, obj, ts, stripe) =>
      upsertCheckoutSessionLine(db, obj, (obj as any).checkout_session ?? '', ts, { stripe }),
  },
} as Record<PerParentResource, ChildListBinding>;
