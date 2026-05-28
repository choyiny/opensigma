import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { promotionCodes } from '../../src/db/schema';
import { upsertPromotionCode } from '../../src/upserts/promotion_codes';

const stripePromotionCode = (overrides: Partial<any> = {}): Stripe.PromotionCode => ({
  id: 'promo_test_1',
  object: 'promotion_code',
  active: true,
  code: 'SAVE20',
  coupon: { id: 'coupon_test_1' } as any,
  created: 1700000000,
  livemode: false,
  metadata: {},
  times_redeemed: 0,
  restrictions: { first_time_transaction: false, minimum_amount: null, minimum_amount_currency: null },
  ...overrides,
}) as unknown as Stripe.PromotionCode;

describe('upsertPromotionCode', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(promotionCodes);
  });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertPromotionCode(db, stripePromotionCode(), 1700000100);
    const row = await db.select().from(promotionCodes).where(eq(promotionCodes.id, 'promo_test_1')).get();
    expect(row?.code).toBe('SAVE20');
    expect(row?.active).toBe(true);
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates on newer event', async () => {
    const db = getDb(env.DB);
    await upsertPromotionCode(db, stripePromotionCode({ active: true }), 100);
    await upsertPromotionCode(db, stripePromotionCode({ active: false }), 200);
    const row = await db.select().from(promotionCodes).where(eq(promotionCodes.id, 'promo_test_1')).get();
    expect(row?.active).toBe(false);
    expect(row?.lastEventAt).toBe(200);
  });

  it('no-ops on older event', async () => {
    const db = getDb(env.DB);
    await upsertPromotionCode(db, stripePromotionCode({ active: false }), 200);
    await upsertPromotionCode(db, stripePromotionCode({ active: true }), 100);
    const row = await db.select().from(promotionCodes).where(eq(promotionCodes.id, 'promo_test_1')).get();
    expect(row?.active).toBe(false);
    expect(row?.lastEventAt).toBe(200);
  });
});
