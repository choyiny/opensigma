import type Stripe from 'stripe';
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { creditNotes, creditNoteLineItems } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertCreditNote(
  db: DB,
  n: Stripe.CreditNote,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: n.id,
    object: n.object,
    amount: n.amount,
    amountShipping: (n as any).amount_shipping ?? null,
    created: n.created,
    currency: n.currency,
    customer: strOrNull(n.customer),
    customerBalanceTransaction: strOrNull(n.customer_balance_transaction),
    discountAmount: (n as any).discount_amount ?? null,
    discountAmounts: n.discount_amounts ?? null,
    effectiveAt: n.effective_at ?? null,
    invoice: strOrNull(n.invoice),
    livemode: n.livemode,
    memo: n.memo ?? null,
    metadata: n.metadata ?? null,
    number: n.number ?? null,
    outOfBandAmount: n.out_of_band_amount ?? null,
    pdf: n.pdf ?? null,
    pretaxCreditAmounts: n.pretax_credit_amounts ?? null,
    reason: n.reason ?? null,
    refund: strOrNull((n as any).refund),
    refunds: (n as any).refunds ?? null,
    shippingCost: n.shipping_cost ?? null,
    status: n.status,
    subtotal: n.subtotal,
    subtotalExcludingTax: n.subtotal_excluding_tax ?? null,
    taxAmounts: (n as any).tax_amounts ?? null,
    total: n.total,
    totalExcludingTax: n.total_excluding_tax ?? null,
    totalTaxes: (n as any).total_taxes ?? null,
    type: n.type,
    voidedAt: n.voided_at ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(creditNotes).values(row).onConflictDoUpdate({
    target: creditNotes.id,
    set: {
      object: sql`excluded.object`,
      amount: sql`excluded.amount`,
      amountShipping: sql`excluded.amount_shipping`,
      created: sql`excluded.created`,
      currency: sql`excluded.currency`,
      customer: sql`excluded.customer`,
      customerBalanceTransaction: sql`excluded.customer_balance_transaction`,
      discountAmount: sql`excluded.discount_amount`,
      discountAmounts: sql`excluded.discount_amounts`,
      effectiveAt: sql`excluded.effective_at`,
      invoice: sql`excluded.invoice`,
      livemode: sql`excluded.livemode`,
      memo: sql`excluded.memo`,
      metadata: sql`excluded.metadata`,
      number: sql`excluded.number`,
      outOfBandAmount: sql`excluded.out_of_band_amount`,
      pdf: sql`excluded.pdf`,
      pretaxCreditAmounts: sql`excluded.pretax_credit_amounts`,
      reason: sql`excluded.reason`,
      refund: sql`excluded.refund`,
      refunds: sql`excluded.refunds`,
      shippingCost: sql`excluded.shipping_cost`,
      status: sql`excluded.status`,
      subtotal: sql`excluded.subtotal`,
      subtotalExcludingTax: sql`excluded.subtotal_excluding_tax`,
      taxAmounts: sql`excluded.tax_amounts`,
      total: sql`excluded.total`,
      totalExcludingTax: sql`excluded.total_excluding_tax`,
      totalTaxes: sql`excluded.total_taxes`,
      type: sql`excluded.type`,
      voidedAt: sql`excluded.voided_at`,
      lastEventAt: sql`excluded.last_event_at`,
    },
    setWhere: sql`credit_notes.last_event_at < ${eventCreated}`,
  });
}

export async function upsertCreditNoteLine(
  db: DB,
  line: any,
  creditNoteId: string,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: line.id,
    object: line.object,
    amount: line.amount,
    amountExcludingTax: line.amount_excluding_tax ?? null,
    creditNote: creditNoteId,
    description: line.description ?? null,
    discountAmount: line.discount_amount ?? null,
    discountAmounts: line.discount_amounts ?? null,
    invoiceLineItem: line.invoice_line_item ?? null,
    livemode: line.livemode,
    pretaxCreditAmounts: line.pretax_credit_amounts ?? null,
    quantity: line.quantity ?? null,
    taxAmounts: line.tax_amounts ?? null,
    taxRates: line.tax_rates ?? null,
    taxes: line.taxes ?? null,
    type: line.type,
    unitAmount: line.unit_amount ?? null,
    unitAmountDecimal: line.unit_amount_decimal ?? null,
    unitAmountExcludingTax: line.unit_amount_excluding_tax ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(creditNoteLineItems).values(row).onConflictDoUpdate({
    target: creditNoteLineItems.id,
    set: row,
    setWhere: sql`credit_note_line_items.last_event_at < ${eventCreated}`,
  });
}

export async function upsertCreditNoteLines(
  stripe: Stripe,
  db: DB,
  creditNoteId: string,
  eventCreated: number,
): Promise<void> {
  let cursor: string | undefined = undefined;
  while (true) {
    const page: { data: any[]; has_more: boolean } = await (stripe as any).creditNotes.listLines(
      creditNoteId,
      { limit: 100, starting_after: cursor },
    );
    for (const line of page.data) {
      await upsertCreditNoteLine(db, line, creditNoteId, eventCreated);
    }
    if (!page.has_more || page.data.length === 0) break;
    cursor = page.data[page.data.length - 1].id;
  }
}
