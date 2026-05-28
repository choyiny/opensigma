import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { paymentIntents } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertPaymentIntent(
  db: DB,
  p: Stripe.PaymentIntent,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: p.id,
    object: p.object,
    amount: p.amount,
    amountCapturable: p.amount_capturable,
    amountDetails: (p as any).amount_details ?? null,
    amountReceived: p.amount_received,
    application: strOrNull(p.application),
    applicationFeeAmount: p.application_fee_amount ?? null,
    automaticPaymentMethods: p.automatic_payment_methods ?? null,
    canceledAt: p.canceled_at ?? null,
    cancellationReason: p.cancellation_reason ?? null,
    captureMethod: p.capture_method,
    clientSecret: p.client_secret ?? null,
    confirmationMethod: p.confirmation_method,
    created: p.created,
    currency: p.currency,
    customer: strOrNull(p.customer),
    description: p.description ?? null,
    lastPaymentError: p.last_payment_error ?? null,
    latestCharge: strOrNull(p.latest_charge),
    livemode: p.livemode,
    metadata: p.metadata ?? null,
    nextAction: p.next_action ?? null,
    onBehalfOf: strOrNull(p.on_behalf_of),
    paymentMethod: strOrNull(p.payment_method),
    paymentMethodConfigurationDetails: (p as any).payment_method_configuration_details ?? null,
    paymentMethodOptions: p.payment_method_options ?? null,
    paymentMethodTypes: p.payment_method_types ?? null,
    processing: p.processing ?? null,
    receiptEmail: p.receipt_email ?? null,
    review: strOrNull(p.review),
    setupFutureUsage: p.setup_future_usage ?? null,
    shipping: p.shipping ?? null,
    source: strOrNull((p as any).source),
    statementDescriptor: p.statement_descriptor ?? null,
    statementDescriptorSuffix: p.statement_descriptor_suffix ?? null,
    status: p.status,
    transferData: p.transfer_data ?? null,
    transferGroup: p.transfer_group ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(paymentIntents).values(row).onConflictDoUpdate({
    target: paymentIntents.id,
    set: row,
    setWhere: lt(paymentIntents.lastEventAt, eventCreated),
  });
}
