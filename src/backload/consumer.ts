import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import type { Env, BackloadJob } from '../env';
import { getDb, type DB } from '../db/client';
import { backloadState } from '../db/schema';
import { getStripe } from '../stripe';
import { upsertCustomer } from '../upserts/customers';
import { upsertProduct } from '../upserts/products';
import { upsertPrice } from '../upserts/prices';
import { upsertSubscription } from '../upserts/subscriptions';
import { upsertInvoice } from '../upserts/invoices';
import { upsertCharge } from '../upserts/charges';
import { upsertPaymentIntent } from '../upserts/payment_intents';
import { upsertRefund } from '../upserts/refunds';

type Resource = BackloadJob['resource'];

interface ResourceBinding {
  list: (stripe: Stripe, cursor: string | null) => Promise<{ data: any[]; has_more: boolean }>;
  upsert: (db: DB, obj: any, ts: number) => Promise<void>;
}

const RESOURCES: Record<Resource, ResourceBinding> = {
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
};

export async function processBackloadMessage(
  env: Env,
  job: BackloadJob,
  stripeOverride?: Stripe,
): Promise<void> {
  const db = getDb(env.DB);
  const state = await db.select().from(backloadState).where(eq(backloadState.resource, job.resource)).get();
  if (!state || state.status === 'done') return;

  await db.update(backloadState)
    .set({ status: 'in_progress', updatedAt: Date.now() })
    .where(eq(backloadState.resource, job.resource));

  const binding = RESOURCES[job.resource];
  const stripe = stripeOverride ?? getStripe(env.STRIPE_API_KEY);
  const page = await binding.list(stripe, job.cursor);

  for (const obj of page.data) {
    await binding.upsert(db, obj, obj.created);
  }

  if (page.has_more) {
    const lastId = page.data[page.data.length - 1]?.id ?? job.cursor;
    await db.update(backloadState)
      .set({ cursor: lastId, status: 'idle', updatedAt: Date.now(), lastSyncedAt: Date.now() })
      .where(eq(backloadState.resource, job.resource));
    await env.BACKLOAD_QUEUE.send({ resource: job.resource, cursor: lastId });
  } else {
    await db.update(backloadState)
      .set({ cursor: null, status: 'done', updatedAt: Date.now(), lastSyncedAt: Date.now() })
      .where(eq(backloadState.resource, job.resource));
  }
}

export const queueHandler: ExportedHandlerQueueHandler<Env, BackloadJob> = async (batch, env) => {
  for (const msg of batch.messages) {
    try {
      await processBackloadMessage(env, msg.body);
      msg.ack();
    } catch (err) {
      console.log(JSON.stringify({ level: 'error', msg: 'backload_failed', job: msg.body, err: String(err) }));
      msg.retry();
    }
  }
};
