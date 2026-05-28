import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { disputes } from '../../src/db/schema';
import { upsertDispute } from '../../src/upserts/disputes';

const stripeDispute = (overrides: Partial<any> = {}): Stripe.Dispute => ({
  id: 'dp_test_1',
  object: 'dispute',
  amount: 1000,
  charge: 'ch_test_1',
  created: 1700000000,
  currency: 'usd',
  livemode: false,
  metadata: {},
  reason: 'fraudulent',
  status: 'warning_needs_response',
  ...overrides,
}) as unknown as Stripe.Dispute;

describe('upsertDispute', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(disputes);
  });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertDispute(db, stripeDispute(), 1700000100);
    const row = await db.select().from(disputes).where(eq(disputes.id, 'dp_test_1')).get();
    expect(row?.status).toBe('warning_needs_response');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates on newer event', async () => {
    const db = getDb(env.DB);
    await upsertDispute(db, stripeDispute({ status: 'warning_needs_response' }), 100);
    await upsertDispute(db, stripeDispute({ status: 'won' }), 200);
    const row = await db.select().from(disputes).where(eq(disputes.id, 'dp_test_1')).get();
    expect(row?.status).toBe('won');
  });

  it('no-ops on older event', async () => {
    const db = getDb(env.DB);
    await upsertDispute(db, stripeDispute({ status: 'won' }), 200);
    await upsertDispute(db, stripeDispute({ status: 'lost' }), 100);
    const row = await db.select().from(disputes).where(eq(disputes.id, 'dp_test_1')).get();
    expect(row?.status).toBe('won');
  });
});
