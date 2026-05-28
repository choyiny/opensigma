import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { refunds } from '../../src/db/schema';
import { upsertRefund } from '../../src/upserts/refunds';

const stripeRefund = (overrides: Partial<any> = {}) => ({
  id: 're_test_1',
  object: 'refund',
  amount: 500,
  charge: 'ch_test_1',
  created: 1700000000,
  currency: 'usd',
  metadata: {},
  status: 'succeeded',
  ...overrides,
});

describe('upsertRefund', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(refunds);
  });

  it('inserts a new refund', async () => {
    const db = getDb(env.DB);
    await upsertRefund(db, stripeRefund(), 1700000100);
    const row = await db.select().from(refunds).where(eq(refunds.id, 're_test_1')).get();
    expect(row?.status).toBe('succeeded');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertRefund(db, stripeRefund({ status: 'succeeded' }), 100);
    await upsertRefund(db, stripeRefund({ status: 'pending' }), 200);
    const row = await db.select().from(refunds).where(eq(refunds.id, 're_test_1')).get();
    expect(row?.status).toBe('pending');
  });

  it('no-ops when incoming event is older', async () => {
    const db = getDb(env.DB);
    await upsertRefund(db, stripeRefund({ status: 'succeeded' }), 200);
    await upsertRefund(db, stripeRefund({ status: 'pending' }), 100);
    const row = await db.select().from(refunds).where(eq(refunds.id, 're_test_1')).get();
    expect(row?.status).toBe('succeeded');
  });
});
