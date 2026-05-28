import type Stripe from 'stripe';
import { and, eq, lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { coupons } from '../db/schema';

export async function upsertCoupon(
  db: DB,
  c: Stripe.Coupon | Stripe.DeletedCoupon,
  eventCreated: number,
): Promise<void> {
  if ('deleted' in c && c.deleted) {
    await db
      .delete(coupons)
      .where(and(eq(coupons.id, c.id), lt(coupons.lastEventAt, eventCreated)))
      .run();
    return;
  }
  const full = c as Stripe.Coupon;
  const row = {
    id: full.id,
    object: full.object,
    amountOff: full.amount_off ?? null,
    appliesTo: full.applies_to ?? null,
    created: full.created,
    currency: full.currency ?? null,
    currencyOptions: (full as any).currency_options ?? null,
    duration: full.duration,
    durationInMonths: full.duration_in_months ?? null,
    livemode: full.livemode,
    maxRedemptions: full.max_redemptions ?? null,
    metadata: full.metadata ?? null,
    name: full.name ?? null,
    percentOff: full.percent_off ?? null,
    redeemBy: full.redeem_by ?? null,
    timesRedeemed: full.times_redeemed,
    valid: full.valid,
    deleted: false,
    lastEventAt: eventCreated,
  };
  await db.insert(coupons).values(row).onConflictDoUpdate({
    target: coupons.id,
    set: row,
    setWhere: lt(coupons.lastEventAt, eventCreated),
  });
}
