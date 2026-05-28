import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { charges } from '../../src/db/schema';
import { upsertCharge } from '../../src/upserts/charges';

const stripeCharge = (overrides: Partial<any> = {}): Stripe.Charge => ({
  id: 'ch_test_1',
  object: 'charge',
  amount: 1000,
  amount_captured: 1000,
  amount_refunded: 0,
  attempted: true,
  billing_details: {},
  captured: true,
  created: 1700000000,
  currency: 'usd',
  disputed: false,
  fraud_details: {},
  livemode: false,
  metadata: {},
  paid: true,
  refunded: false,
  status: 'succeeded',
  ...overrides,
}) as unknown as Stripe.Charge;

describe('upsertCharge', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(charges);
  });

  it('inserts a new charge', async () => {
    const db = getDb(env.DB);
    await upsertCharge(db, stripeCharge(), 1700000100);
    const row = await db.select().from(charges).where(eq(charges.id, 'ch_test_1')).get();
    expect(row?.status).toBe('succeeded');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertCharge(db, stripeCharge({ status: 'succeeded' }), 100);
    await upsertCharge(db, stripeCharge({ status: 'failed' }), 200);
    const row = await db.select().from(charges).where(eq(charges.id, 'ch_test_1')).get();
    expect(row?.status).toBe('failed');
  });

  it('no-ops when incoming event is older', async () => {
    const db = getDb(env.DB);
    await upsertCharge(db, stripeCharge({ status: 'succeeded' }), 200);
    await upsertCharge(db, stripeCharge({ status: 'failed' }), 100);
    const row = await db.select().from(charges).where(eq(charges.id, 'ch_test_1')).get();
    expect(row?.status).toBe('succeeded');
  });
});
