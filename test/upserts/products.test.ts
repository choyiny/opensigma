// test/upserts/products.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { products } from '../../src/db/schema';
import { upsertProduct } from '../../src/upserts/products';

const stripeProduct = (overrides: Partial<any> = {}) => ({
  id: 'prod_test_1',
  object: 'product',
  active: true,
  name: 'Widget',
  created: 1700000000,
  livemode: false,
  metadata: {},
  ...overrides,
});

describe('upsertProduct', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(products);
  });

  it('inserts a new product', async () => {
    const db = getDb(env.DB);
    await upsertProduct(db, stripeProduct(), 1700000100);
    const row = await db.select().from(products).where(eq(products.id, 'prod_test_1')).get();
    expect(row?.name).toBe('Widget');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertProduct(db, stripeProduct({ name: 'Old' }), 100);
    await upsertProduct(db, stripeProduct({ name: 'New' }), 200);
    const row = await db.select().from(products).where(eq(products.id, 'prod_test_1')).get();
    expect(row?.name).toBe('New');
  });

  it('no-ops when incoming event is older', async () => {
    const db = getDb(env.DB);
    await upsertProduct(db, stripeProduct({ name: 'New' }), 200);
    await upsertProduct(db, stripeProduct({ name: 'Stale' }), 100);
    const row = await db.select().from(products).where(eq(products.id, 'prod_test_1')).get();
    expect(row?.name).toBe('New');
  });
});
