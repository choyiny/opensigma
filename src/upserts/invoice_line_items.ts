import type Stripe from 'stripe';
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { invoiceLineItems } from '../db/schema';
import { backfillPrices } from './backfill';

export interface UpsertInvoiceLineItemOpts {
  /**
   * If provided, the line item's referenced price is backfilled before
   * upserting — closes gaps for ad-hoc prices/products (created inline via
   * `price_data`) that aren't returned by `Prices.list` / `Products.list`.
   */
  stripe?: Stripe;
}

export async function upsertInvoiceLineItem(
  db: DB,
  line: any,
  invoiceId: string,
  eventCreated: number,
  opts: UpsertInvoiceLineItemOpts = {},
): Promise<void> {
  if (opts.stripe) {
    const priceId = line?.pricing?.price_details?.price;
    if (typeof priceId === 'string') {
      await backfillPrices(db, opts.stripe, [priceId], eventCreated);
    }
  }

  const row = {
    id: line.id,
    object: line.object,
    amount: line.amount,
    currency: line.currency,
    description: line.description ?? null,
    discountAmounts: line.discount_amounts ?? null,
    discountable: line.discountable,
    discounts: line.discounts ?? null,
    invoice: invoiceId,
    livemode: line.livemode,
    metadata: line.metadata ?? null,
    parent: line.parent ?? null,
    period: line.period ?? null,
    pretaxCreditAmounts: line.pretax_credit_amounts ?? null,
    pricing: line.pricing ?? null,
    quantity: line.quantity ?? null,
    quantityDecimal: line.quantity_decimal == null ? null : String(line.quantity_decimal),
    subscription: typeof line.subscription === 'string' ? line.subscription : null,
    subtotal: line.subtotal,
    taxes: line.taxes ?? null,
    lastEventAt: eventCreated,
  };
  await db.insert(invoiceLineItems).values(row).onConflictDoUpdate({
    target: invoiceLineItems.id,
    set: {
      object: sql`excluded.object`,
      amount: sql`excluded.amount`,
      currency: sql`excluded.currency`,
      description: sql`excluded.description`,
      discountAmounts: sql`excluded.discount_amounts`,
      discountable: sql`excluded.discountable`,
      discounts: sql`excluded.discounts`,
      invoice: sql`excluded.invoice`,
      livemode: sql`excluded.livemode`,
      metadata: sql`excluded.metadata`,
      parent: sql`excluded.parent`,
      period: sql`excluded.period`,
      pretaxCreditAmounts: sql`excluded.pretax_credit_amounts`,
      pricing: sql`excluded.pricing`,
      quantity: sql`excluded.quantity`,
      quantityDecimal: sql`excluded.quantity_decimal`,
      subscription: sql`excluded.subscription`,
      subtotal: sql`excluded.subtotal`,
      taxes: sql`excluded.taxes`,
      lastEventAt: sql`excluded.last_event_at`,
    },
    setWhere: sql`invoice_line_items.last_event_at < ${eventCreated}`,
  });
}

export async function upsertInvoiceLineItems(
  stripe: Stripe,
  db: DB,
  invoiceId: string,
  eventCreated: number,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const page: any = await (stripe as any).invoices.listLineItems(invoiceId, {
      limit: 100,
      starting_after: cursor,
    });
    for (const line of page.data) {
      await upsertInvoiceLineItem(db, line, invoiceId, eventCreated, { stripe });
    }
    if (!page.has_more) break;
    cursor = page.data[page.data.length - 1]?.id;
    if (!cursor) break;
  }
}
