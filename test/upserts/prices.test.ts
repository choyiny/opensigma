import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { prices } from '../../src/db/schema';
import { upsertPrice } from '../../src/upserts/prices';

const stripePrice = (overrides: Partial<any> = {}) => ({
  id: 'price_test_1',
  object: 'price',
  active: true,
  billing_scheme: 'per_unit',
  created: 1700000000,
  currency: 'usd',
  livemode: false,
  metadata: {},
  product: 'prod_test_1',
  type: 'one_time',
  unit_amount: 1000,
  ...overrides,
});

describe('upsertPrice', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(prices);
  });

  it('inserts a new price', async () => {
    const db = getDb(env.DB);
    await upsertPrice(db, stripePrice(), 1700000100);
    const row = await db.select().from(prices).where(eq(prices.id, 'price_test_1')).get();
    expect(row?.unitAmount).toBe(1000);
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertPrice(db, stripePrice({ unit_amount: 1000 }), 100);
    await upsertPrice(db, stripePrice({ unit_amount: 2000 }), 200);
    const row = await db.select().from(prices).where(eq(prices.id, 'price_test_1')).get();
    expect(row?.unitAmount).toBe(2000);
  });

  it('no-ops when incoming event is older', async () => {
    const db = getDb(env.DB);
    await upsertPrice(db, stripePrice({ unit_amount: 2000 }), 200);
    await upsertPrice(db, stripePrice({ unit_amount: 1000 }), 100);
    const row = await db.select().from(prices).where(eq(prices.id, 'price_test_1')).get();
    expect(row?.unitAmount).toBe(2000);
  });
});
