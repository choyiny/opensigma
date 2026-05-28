// test/upserts/customers.test.ts
import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { customers } from '../../src/db/schema';
import { upsertCustomer } from '../../src/upserts/customers';

const stripeCustomer = (overrides: Partial<any> = {}): Stripe.Customer => ({
  id: 'cus_test_1',
  object: 'customer',
  email: 'a@example.com',
  name: 'Alice',
  metadata: { tier: 'pro' },
  created: 1700000000,
  livemode: false,
  ...overrides,
}) as unknown as Stripe.Customer;

describe('upsertCustomer', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(customers);
  });

  it('inserts a new customer', async () => {
    const db = getDb(env.DB);
    await upsertCustomer(db, stripeCustomer(), 1700000100);
    const row = await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get();
    expect(row?.email).toBe('a@example.com');
    expect(row?.lastEventAt).toBe(1700000100);
    expect(row?.metadata).toEqual({ tier: 'pro' });
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertCustomer(db, stripeCustomer({ email: 'old@example.com' }), 100);
    await upsertCustomer(db, stripeCustomer({ email: 'new@example.com' }), 200);
    const row = await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get();
    expect(row?.email).toBe('new@example.com');
    expect(row?.lastEventAt).toBe(200);
  });

  it('no-ops when incoming event is older (out-of-order guard)', async () => {
    const db = getDb(env.DB);
    await upsertCustomer(db, stripeCustomer({ email: 'new@example.com' }), 200);
    await upsertCustomer(db, stripeCustomer({ email: 'stale@example.com' }), 100);
    const row = await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get();
    expect(row?.email).toBe('new@example.com');
    expect(row?.lastEventAt).toBe(200);
  });
});
