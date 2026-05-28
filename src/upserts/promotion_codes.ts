import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { promotionCodes } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertPromotionCode(
  db: DB,
  p: Stripe.PromotionCode,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: p.id,
    object: p.object,
    active: p.active,
    code: p.code,
    coupon:
      typeof (p as any).coupon === 'string'
        ? (p as any).coupon
        : (p as any).coupon?.id ?? null,
    created: p.created,
    customer: strOrNull(p.customer),
    expiresAt: p.expires_at ?? null,
    livemode: p.livemode,
    maxRedemptions: p.max_redemptions ?? null,
    metadata: p.metadata ?? null,
    restrictions: p.restrictions ?? null,
    timesRedeemed: p.times_redeemed,
    lastEventAt: eventCreated,
  };
  await db.insert(promotionCodes).values(row).onConflictDoUpdate({
    target: promotionCodes.id,
    set: row,
    setWhere: lt(promotionCodes.lastEventAt, eventCreated),
  });
}
