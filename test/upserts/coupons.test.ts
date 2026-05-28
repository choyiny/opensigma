import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { coupons } from '../../src/db/schema';
import { upsertCoupon } from '../../src/upserts/coupons';

const stripeCoupon = (overrides: Partial<any> = {}): Stripe.Coupon => ({
  id: 'coupon_test_1',
  object: 'coupon',
  amount_off: null,
  created: 1700000000,
  currency: null,
  duration: 'once',
  livemode: false,
  max_redemptions: null,
  metadata: {},
  name: '20% off',
  percent_off: 20,
  redeem_by: null,
  times_redeemed: 0,
  valid: true,
  ...overrides,
}) as unknown as Stripe.Coupon;

describe('upsertCoupon', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(coupons);
  });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertCoupon(db, stripeCoupon(), 1700000100);
    const row = await db.select().from(coupons).where(eq(coupons.id, 'coupon_test_1')).get();
    expect(row?.name).toBe('20% off');
    expect(row?.percentOff).toBe(20);
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates on newer event', async () => {
    const db = getDb(env.DB);
    await upsertCoupon(db, stripeCoupon({ name: 'old' }), 100);
    await upsertCoupon(db, stripeCoupon({ name: 'new' }), 200);
    const row = await db.select().from(coupons).where(eq(coupons.id, 'coupon_test_1')).get();
    expect(row?.name).toBe('new');
    expect(row?.lastEventAt).toBe(200);
  });

  it('no-ops on older event', async () => {
    const db = getDb(env.DB);
    await upsertCoupon(db, stripeCoupon({ name: 'new' }), 200);
    await upsertCoupon(db, stripeCoupon({ name: 'stale' }), 100);
    const row = await db.select().from(coupons).where(eq(coupons.id, 'coupon_test_1')).get();
    expect(row?.name).toBe('new');
    expect(row?.lastEventAt).toBe(200);
  });

  it('deletes on incoming deleted=true with newer event', async () => {
    const db = getDb(env.DB);
    await upsertCoupon(db, stripeCoupon(), 100);
    await upsertCoupon(
      db,
      { id: 'coupon_test_1', object: 'coupon', deleted: true } as Stripe.DeletedCoupon,
      200,
    );
    const row = await db.select().from(coupons).where(eq(coupons.id, 'coupon_test_1')).get();
    expect(row).toBeUndefined();
  });
});
