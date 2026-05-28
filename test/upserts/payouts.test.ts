import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { payouts } from '../../src/db/schema';
import { upsertPayout } from '../../src/upserts/payouts';

const stripePayout = (overrides: Partial<any> = {}): Stripe.Payout => ({
  id: 'po_test_1',
  object: 'payout',
  amount: 5000,
  arrival_date: 1700000500,
  automatic: true,
  created: 1700000000,
  currency: 'usd',
  livemode: false,
  metadata: {},
  method: 'standard',
  source_type: 'card',
  status: 'pending',
  type: 'bank_account',
  ...overrides,
}) as unknown as Stripe.Payout;

describe('upsertPayout', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(payouts);
  });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertPayout(db, stripePayout(), 1700000100);
    const row = await db.select().from(payouts).where(eq(payouts.id, 'po_test_1')).get();
    expect(row?.status).toBe('pending');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates on newer event', async () => {
    const db = getDb(env.DB);
    await upsertPayout(db, stripePayout({ status: 'pending' }), 100);
    await upsertPayout(db, stripePayout({ status: 'paid' }), 200);
    const row = await db.select().from(payouts).where(eq(payouts.id, 'po_test_1')).get();
    expect(row?.status).toBe('paid');
  });

  it('no-ops on older event', async () => {
    const db = getDb(env.DB);
    await upsertPayout(db, stripePayout({ status: 'paid' }), 200);
    await upsertPayout(db, stripePayout({ status: 'failed' }), 100);
    const row = await db.select().from(payouts).where(eq(payouts.id, 'po_test_1')).get();
    expect(row?.status).toBe('paid');
  });
});
