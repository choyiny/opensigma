import type Stripe from 'stripe';
import { inArray } from 'drizzle-orm';
import type { DB } from '../db/client';
import { products, prices } from '../db/schema';
import { upsertProduct } from './products';
import { upsertPrice } from './prices';

/**
 * Cascading backfill of referenced entities — mirrors the
 * `backfillRelatedEntities` pattern from stripe/sync-engine v0.48.5.
 *
 * Stripe's `*.list` endpoints (Products in particular) hide certain objects
 * — most notably products created inline via `price_data.product_data`
 * (Payment Links / Checkout). The single-object `retrieve` API still
 * surfaces them, so we close gaps by diffing FK references against what's
 * in the DB and individually retrieving the misses.
 */

async function findMissingProductIds(db: DB, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const found = await db
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, ids));
  const have = new Set(found.map((r) => r.id));
  return ids.filter((id) => !have.has(id));
}

async function findMissingPriceIds(db: DB, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const found = await db
    .select({ id: prices.id })
    .from(prices)
    .where(inArray(prices.id, ids));
  const have = new Set(found.map((r) => r.id));
  return ids.filter((id) => !have.has(id));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)));
}

/**
 * Retrieve any missing products by ID and upsert them. Tolerates
 * `resource_missing` (product was hard-deleted on Stripe's side) — logs and
 * skips rather than poisoning the queue.
 */
export async function backfillProducts(
  db: DB,
  stripe: Stripe,
  productIds: Array<string | null | undefined>,
  ts: number,
): Promise<void> {
  const ids = uniqueStrings(productIds);
  const missing = await findMissingProductIds(db, ids);
  for (const id of missing) {
    try {
      const product = await stripe.products.retrieve(id);
      await upsertProduct(db, product, product.created ?? ts);
    } catch (err: any) {
      if (err?.code === 'resource_missing' || err?.statusCode === 404) {
        console.log(JSON.stringify({ level: 'info', msg: 'backfill_product_missing', id }));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Retrieve any missing prices by ID and upsert them — which transitively
 * triggers product backfill via `upsertPrice`.
 */
export async function backfillPrices(
  db: DB,
  stripe: Stripe,
  priceIds: Array<string | null | undefined>,
  ts: number,
): Promise<void> {
  const ids = uniqueStrings(priceIds);
  const missing = await findMissingPriceIds(db, ids);
  for (const id of missing) {
    try {
      const price = await stripe.prices.retrieve(id);
      await upsertPrice(db, price, price.created ?? ts, { stripe });
    } catch (err: any) {
      if (err?.code === 'resource_missing' || err?.statusCode === 404) {
        console.log(JSON.stringify({ level: 'info', msg: 'backfill_price_missing', id }));
        continue;
      }
      throw err;
    }
  }
}
