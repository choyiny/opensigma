import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { prices } from '../db/schema';
import { upsertProduct } from './products';
import { backfillProducts } from './backfill';

export interface UpsertPriceOpts {
  /**
   * If provided, the referenced product is backfilled before upserting —
   * closes gaps for ad-hoc products (created inline via
   * `price_data.product_data`) that aren't returned by `Products.list`.
   */
  stripe?: Stripe;
}

export async function upsertPrice(
  db: DB,
  p: Stripe.Price,
  eventCreated: number,
  opts: UpsertPriceOpts = {},
): Promise<void> {
  // If the price's product is an expanded object, upsert it directly —
  // saves an HTTP call. If it's a string ID and we have a Stripe client,
  // retrieve+upsert any product not yet in the DB.
  if (typeof p.product === 'object' && p.product && !(p.product as any).deleted) {
    const prod = p.product as Stripe.Product;
    await upsertProduct(db, prod, prod.created ?? eventCreated);
  } else if (opts.stripe && typeof p.product === 'string') {
    await backfillProducts(db, opts.stripe, [p.product], eventCreated);
  }

  const row = {
    id: p.id,
    object: p.object,
    active: p.active,
    billingScheme: p.billing_scheme,
    created: p.created,
    currency: p.currency,
    customUnitAmount: p.custom_unit_amount ?? null,
    livemode: p.livemode,
    lookupKey: p.lookup_key ?? null,
    metadata: p.metadata ?? null,
    nickname: p.nickname ?? null,
    product: typeof p.product === 'string' ? p.product : (p.product as Stripe.Product).id,
    recurring: p.recurring ?? null,
    taxBehavior: p.tax_behavior ?? null,
    tiers: p.tiers ?? null,
    tiersMode: p.tiers_mode ?? null,
    transformQuantity: p.transform_quantity ?? null,
    type: p.type,
    unitAmount: p.unit_amount ?? null,
    unitAmountDecimal: p.unit_amount_decimal == null ? null : String(p.unit_amount_decimal),
    lastEventAt: eventCreated,
  };
  await db.insert(prices).values(row).onConflictDoUpdate({
    target: prices.id,
    set: row,
    setWhere: lt(prices.lastEventAt, eventCreated),
  });
}
