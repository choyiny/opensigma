import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { subscriptions, subscriptionItems } from '../db/schema';

export async function upsertSubscription(
  db: DB,
  s: Stripe.Subscription,
  eventCreated: number,
): Promise<void> {
  const customerId = typeof s.customer === 'string' ? s.customer : s.customer.id;

  const subRow = {
    id: s.id,
    object: s.object,
    application: typeof s.application === 'string' ? s.application : null,
    applicationFeePercent: s.application_fee_percent ?? null,
    automaticTax: s.automatic_tax ?? null,
    billingCycleAnchor: s.billing_cycle_anchor,
    billingCycleAnchorConfig: s.billing_cycle_anchor_config ?? null,
    billingMode: s.billing_mode ?? null,
    billingSchedules: s.billing_schedules ?? null,
    billingThresholds: s.billing_thresholds ?? null,
    cancelAt: s.cancel_at ?? null,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    canceledAt: s.canceled_at ?? null,
    cancellationDetails: s.cancellation_details ?? null,
    collectionMethod: s.collection_method,
    created: s.created,
    currency: s.currency,
    customer: customerId,
    customerAccount: s.customer_account ?? null,
    daysUntilDue: s.days_until_due ?? null,
    defaultPaymentMethod: typeof s.default_payment_method === 'string' ? s.default_payment_method : null,
    defaultSource: typeof s.default_source === 'string' ? s.default_source : null,
    defaultTaxRates: s.default_tax_rates ?? null,
    description: s.description ?? null,
    discounts: s.discounts ?? null,
    endedAt: s.ended_at ?? null,
    invoiceSettings: s.invoice_settings ?? null,
    latestInvoice: typeof s.latest_invoice === 'string' ? s.latest_invoice : null,
    livemode: s.livemode,
    managedPayments: s.managed_payments ?? null,
    metadata: s.metadata ?? null,
    nextPendingInvoiceItemInvoice: s.next_pending_invoice_item_invoice ?? null,
    onBehalfOf: typeof s.on_behalf_of === 'string' ? s.on_behalf_of : null,
    pauseCollection: s.pause_collection ?? null,
    paymentSettings: s.payment_settings ?? null,
    pendingInvoiceItemInterval: s.pending_invoice_item_interval ?? null,
    pendingSetupIntent: typeof s.pending_setup_intent === 'string' ? s.pending_setup_intent : null,
    pendingUpdate: s.pending_update ?? null,
    presentmentDetails: s.presentment_details ?? null,
    schedule: typeof s.schedule === 'string' ? s.schedule : null,
    startDate: s.start_date,
    status: s.status,
    testClock: typeof s.test_clock === 'string' ? s.test_clock : null,
    transferData: s.transfer_data ?? null,
    trialEnd: s.trial_end ?? null,
    trialSettings: s.trial_settings ?? null,
    trialStart: s.trial_start ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(subscriptions).values(subRow).onConflictDoUpdate({
    target: subscriptions.id,
    set: subRow,
    setWhere: lt(subscriptions.lastEventAt, eventCreated),
  });

  for (const item of s.items.data) {
    const itemRow = {
      id: item.id,
      object: item.object,
      billedUntil: item.billed_until ?? null,
      billingThresholds: item.billing_thresholds ?? null,
      created: item.created,
      currentPeriodEnd: item.current_period_end,
      currentPeriodStart: item.current_period_start,
      discounts: item.discounts ?? null,
      metadata: item.metadata ?? null,
      price: item.price.id,
      quantity: item.quantity ?? null,
      subscription: s.id,
      taxRates: item.tax_rates ?? null,
      lastEventAt: eventCreated,
    };
    await db.insert(subscriptionItems).values(itemRow).onConflictDoUpdate({
      target: subscriptionItems.id,
      set: itemRow,
      setWhere: lt(subscriptionItems.lastEventAt, eventCreated),
    });
  }
}
