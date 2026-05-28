import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { paymentMethods } from '../../src/db/schema';
import { upsertPaymentMethod } from '../../src/upserts/payment_methods';

const pm = (o: Partial<any> = {}): Stripe.PaymentMethod => ({
  id: 'pm_test_1', object: 'payment_method', type: 'card',
  created: 1700000000, customer: 'cus_1', livemode: false, metadata: {},
  ...o,
}) as unknown as Stripe.PaymentMethod;

describe('upsertPaymentMethod', () => {
  beforeEach(async () => { await getDb(env.DB).delete(paymentMethods); });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertPaymentMethod(db, pm(), 1700000100);
    expect((await db.select().from(paymentMethods).where(eq(paymentMethods.id, 'pm_test_1')).get())?.type).toBe('card');
  });
  it('updates on newer', async () => {
    const db = getDb(env.DB);
    await upsertPaymentMethod(db, pm({ customer: 'cus_a' }), 100);
    await upsertPaymentMethod(db, pm({ customer: 'cus_b' }), 200);
    expect((await db.select().from(paymentMethods).where(eq(paymentMethods.id, 'pm_test_1')).get())?.customer).toBe('cus_b');
  });
  it('no-ops on older', async () => {
    const db = getDb(env.DB);
    await upsertPaymentMethod(db, pm({ customer: 'cus_a' }), 200);
    await upsertPaymentMethod(db, pm({ customer: 'cus_b' }), 100);
    expect((await db.select().from(paymentMethods).where(eq(paymentMethods.id, 'pm_test_1')).get())?.customer).toBe('cus_a');
  });
});
