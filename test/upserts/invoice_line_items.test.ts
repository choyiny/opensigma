import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { invoiceLineItems } from '../../src/db/schema';
import { upsertInvoiceLineItem } from '../../src/upserts/invoice_line_items';

const line = (o: Partial<any> = {}) => ({
  id: 'il_test_1',
  object: 'line_item',
  amount: 1000,
  currency: 'usd',
  description: 'Test line',
  discountable: true,
  invoice: 'in_test_1',
  livemode: false,
  metadata: {},
  quantity: 1,
  subtotal: 1000,
  ...o,
});

describe('upsertInvoiceLineItem', () => {
  beforeEach(async () => { await getDb(env.DB).delete(invoiceLineItems); });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertInvoiceLineItem(db, line(), 'in_test_1', 1700000100);
    expect((await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, 'il_test_1')).get())?.amount).toBe(1000);
  });

  it('updates on newer', async () => {
    const db = getDb(env.DB);
    await upsertInvoiceLineItem(db, line({ amount: 500 }), 'in_test_1', 100);
    await upsertInvoiceLineItem(db, line({ amount: 999 }), 'in_test_1', 200);
    expect((await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, 'il_test_1')).get())?.amount).toBe(999);
  });

  it('no-ops on older', async () => {
    const db = getDb(env.DB);
    await upsertInvoiceLineItem(db, line({ amount: 999 }), 'in_test_1', 200);
    await upsertInvoiceLineItem(db, line({ amount: 500 }), 'in_test_1', 100);
    expect((await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, 'il_test_1')).get())?.amount).toBe(999);
  });
});
