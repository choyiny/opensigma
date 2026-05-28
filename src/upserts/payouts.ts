import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { payouts } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertPayout(db: DB, p: Stripe.Payout, eventCreated: number): Promise<void> {
  const row = {
    id: p.id,
    object: p.object,
    amount: p.amount,
    applicationFeeAmount: p.application_fee_amount ?? null,
    arrivalDate: p.arrival_date,
    automatic: p.automatic,
    balanceTransaction: strOrNull(p.balance_transaction),
    created: p.created,
    currency: p.currency,
    description: p.description ?? null,
    destination: strOrNull(p.destination),
    failureBalanceTransaction: strOrNull(p.failure_balance_transaction),
    failureCode: p.failure_code ?? null,
    failureMessage: p.failure_message ?? null,
    livemode: p.livemode,
    metadata: p.metadata ?? null,
    method: p.method,
    originalPayout: strOrNull(p.original_payout),
    reconciliationStatus: p.reconciliation_status ?? null,
    reversedBy: strOrNull(p.reversed_by),
    sourceType: p.source_type,
    statementDescriptor: p.statement_descriptor ?? null,
    status: p.status,
    traceId: (p as any).trace_id ?? null,
    type: p.type,
    lastEventAt: eventCreated,
  };
  await db.insert(payouts).values(row).onConflictDoUpdate({
    target: payouts.id,
    set: row,
    setWhere: lt(payouts.lastEventAt, eventCreated),
  });
}
