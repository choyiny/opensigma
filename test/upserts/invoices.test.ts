import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { invoices, invoiceLineItems } from '../../src/db/schema';
import { upsertInvoice } from '../../src/upserts/invoices';

const stripeInvoice = (overrides: Partial<any> = {}): Stripe.Invoice => (({
  id: 'in_test_1',
  object: 'invoice',
  customer: 'cus_test_1',
  status: 'open',
  amount_due: 1000,
  amount_paid: 0,
  amount_remaining: 1000,
  attempt_count: 0,
  attempted: false,
  collection_method: 'charge_automatically',
  created: 1700000000,
  currency: 'usd',
  livemode: false,
  metadata: {},
  paid: false,
  paid_out_of_band: false,
  period_end: 1700100000,
  period_start: 1700000000,
  starting_balance: 0,
  subtotal: 1000,
  total: 1000,
  ...overrides,
}) as unknown as Stripe.Invoice);

describe('upsertInvoice', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(invoices);
    await db.delete(invoiceLineItems);
  });

  it('inserts invoice', async () => {
    const db = getDb(env.DB);
    await upsertInvoice(db, stripeInvoice(), 1700000100);
    const inv = await db.select().from(invoices).where(eq(invoices.id, 'in_test_1')).get();
    expect(inv?.status).toBe('open');
  });

  it('freshness guard applies', async () => {
    const db = getDb(env.DB);
    await upsertInvoice(db, stripeInvoice({ status: 'paid' }), 200);
    await upsertInvoice(db, stripeInvoice({ status: 'open' }), 100);
    const inv = await db.select().from(invoices).where(eq(invoices.id, 'in_test_1')).get();
    expect(inv?.status).toBe('paid');
  });
});
