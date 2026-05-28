import type Stripe from 'stripe';
import { and, eq, lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { customers } from '../db/schema';

export async function upsertCustomer(
  db: DB,
  c: Stripe.Customer | Stripe.DeletedCustomer,
  eventCreated: number,
): Promise<void> {
  if ('deleted' in c && c.deleted) {
    await db
      .delete(customers)
      .where(and(eq(customers.id, c.id), lt(customers.lastEventAt, eventCreated)))
      .run();
    return;
  }
  const full = c as Stripe.Customer;
  const row = {
    id: full.id,
    object: full.object,
    address: full.address ?? null,
    balance: full.balance ?? null,
    created: full.created,
    currency: full.currency ?? null,
    defaultSource: typeof full.default_source === 'string' ? full.default_source : null,
    delinquent: full.delinquent ?? null,
    description: full.description ?? null,
    discount: full.discount ?? null,
    email: full.email ?? null,
    invoicePrefix: full.invoice_prefix ?? null,
    invoiceSettings: full.invoice_settings ?? null,
    livemode: full.livemode,
    metadata: full.metadata ?? null,
    name: full.name ?? null,
    nextInvoiceSequence: full.next_invoice_sequence ?? null,
    phone: full.phone ?? null,
    preferredLocales: full.preferred_locales ?? null,
    shipping: full.shipping ?? null,
    taxExempt: full.tax_exempt ?? null,
    testClock: typeof full.test_clock === 'string' ? full.test_clock : null,
    deleted: false,
    lastEventAt: eventCreated,
  };

  await db
    .insert(customers)
    .values(row)
    .onConflictDoUpdate({
      target: customers.id,
      set: row,
      setWhere: lt(customers.lastEventAt, eventCreated),
    });
}
