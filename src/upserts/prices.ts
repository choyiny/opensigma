import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { prices } from '../db/schema';

export async function upsertPrice(
  db: DB,
  p: Stripe.Price,
  eventCreated: number,
): Promise<void> {
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
