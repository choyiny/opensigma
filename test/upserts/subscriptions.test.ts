import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { subscriptions, subscriptionItems } from '../../src/db/schema';
import { upsertSubscription } from '../../src/upserts/subscriptions';

const stripeSub = (overrides: Partial<any> = {}) => ({
  id: 'sub_test_1',
  object: 'subscription',
  customer: 'cus_test_1',
  status: 'active',
  created: 1700000000,
  current_period_start: 1700000000,
  current_period_end: 1700100000,
  livemode: false,
  metadata: {},
  items: {
    object: 'list',
    data: [
      {
        id: 'si_test_1',
        object: 'subscription_item',
        subscription: 'sub_test_1',
        price: { id: 'price_test_1' },
        quantity: 1,
        created: 1700000000,
        metadata: {},
      },
    ],
    has_more: false,
  },
  ...overrides,
});

describe('upsertSubscription', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(subscriptions);
    await db.delete(subscriptionItems);
  });

  it('inserts subscription and its items', async () => {
    const db = getDb(env.DB);
    await upsertSubscription(db, stripeSub(), 1700000100);
    const sub = await db.select().from(subscriptions).where(eq(subscriptions.id, 'sub_test_1')).get();
    const item = await db.select().from(subscriptionItems).where(eq(subscriptionItems.id, 'si_test_1')).get();
    expect(sub?.status).toBe('active');
    expect(item?.subscription).toBe('sub_test_1');
    expect(item?.lastEventAt).toBe(1700000100);
  });

  it('freshness guard applies to subscription and items', async () => {
    const db = getDb(env.DB);
    await upsertSubscription(db, stripeSub({ status: 'active' }), 200);
    await upsertSubscription(db, stripeSub({ status: 'canceled' }), 100);
    const sub = await db.select().from(subscriptions).where(eq(subscriptions.id, 'sub_test_1')).get();
    expect(sub?.status).toBe('active');
  });
});
