import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { reviews } from '../../src/db/schema';
import { upsertReview } from '../../src/upserts/reviews';

const stripeReview = (overrides: Partial<any> = {}): Stripe.Review => ({
  id: 'prv_test_1',
  object: 'review',
  charge: 'ch_test_1',
  created: 1700000000,
  livemode: false,
  open: true,
  reason: 'rule',
  ...overrides,
}) as unknown as Stripe.Review;

describe('upsertReview', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(reviews);
  });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertReview(db, stripeReview(), 1700000100);
    const row = await db.select().from(reviews).where(eq(reviews.id, 'prv_test_1')).get();
    expect(row?.open).toBe(true);
    expect(row?.charge).toBe('ch_test_1');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates on newer event', async () => {
    const db = getDb(env.DB);
    await upsertReview(db, stripeReview({ open: true }), 100);
    await upsertReview(db, stripeReview({ open: false, closed_reason: 'approved' }), 200);
    const row = await db.select().from(reviews).where(eq(reviews.id, 'prv_test_1')).get();
    expect(row?.open).toBe(false);
    expect(row?.closedReason).toBe('approved');
    expect(row?.lastEventAt).toBe(200);
  });

  it('no-ops on older event', async () => {
    const db = getDb(env.DB);
    await upsertReview(db, stripeReview({ open: false, closed_reason: 'approved' }), 200);
    await upsertReview(db, stripeReview({ open: true }), 100);
    const row = await db.select().from(reviews).where(eq(reviews.id, 'prv_test_1')).get();
    expect(row?.open).toBe(false);
    expect(row?.closedReason).toBe('approved');
    expect(row?.lastEventAt).toBe(200);
  });
});
