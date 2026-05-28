import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { invoices, invoiceLineItems } from '../../src/db/schema';
import { upsertInvoice } from '../../src/upserts/invoices';

const stripeInvoice = (overrides: Partial<any> = {}) => ({
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
  lines: {
    object: 'list',
    data: [
      {
        id: 'il_test_1',
        object: 'line_item',
        amount: 1000,
        currency: 'usd',
        discountable: true,
        invoice: 'in_test_1',
        livemode: false,
        metadata: {},
        proration: false,
        quantity: 1,
        type: 'invoiceitem',
      },
    ],
    has_more: false,
  },
  ...overrides,
});

describe('upsertInvoice', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(invoices);
    await db.delete(invoiceLineItems);
  });

  it('inserts invoice and its line items', async () => {
    const db = getDb(env.DB);
    await upsertInvoice(db, stripeInvoice(), 1700000100);
    const inv = await db.select().from(invoices).where(eq(invoices.id, 'in_test_1')).get();
    const line = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, 'il_test_1')).get();
    expect(inv?.status).toBe('open');
    expect(line?.invoice).toBe('in_test_1');
  });

  it('freshness guard applies', async () => {
    const db = getDb(env.DB);
    await upsertInvoice(db, stripeInvoice({ status: 'paid' }), 200);
    await upsertInvoice(db, stripeInvoice({ status: 'open' }), 100);
    const inv = await db.select().from(invoices).where(eq(invoices.id, 'in_test_1')).get();
    expect(inv?.status).toBe('paid');
  });
});
