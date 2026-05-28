import type Stripe from 'stripe';
import type { DB } from '../db/client';
import { upsertCustomer } from '../upserts/customers';
import { upsertProduct } from '../upserts/products';
import { upsertPrice } from '../upserts/prices';
import { upsertSubscription } from '../upserts/subscriptions';
import { upsertInvoice } from '../upserts/invoices';
import { upsertCharge } from '../upserts/charges';
import { upsertPaymentIntent } from '../upserts/payment_intents';
import { upsertRefund } from '../upserts/refunds';

type Handler = (db: DB, obj: any, eventCreated: number) => Promise<void>;

const customerHandler: Handler = (db, obj, ts) => upsertCustomer(db, obj as Stripe.Customer, ts);
const productHandler: Handler = (db, obj, ts) => upsertProduct(db, obj as Stripe.Product, ts);
const priceHandler: Handler = (db, obj, ts) => upsertPrice(db, obj as Stripe.Price, ts);
const subscriptionHandler: Handler = (db, obj, ts) => upsertSubscription(db, obj as Stripe.Subscription, ts);
const invoiceHandler: Handler = (db, obj, ts) => upsertInvoice(db, obj as Stripe.Invoice, ts);
const chargeHandler: Handler = (db, obj, ts) => upsertCharge(db, obj as Stripe.Charge, ts);
const paymentIntentHandler: Handler = (db, obj, ts) => upsertPaymentIntent(db, obj as Stripe.PaymentIntent, ts);
const refundHandler: Handler = (db, obj, ts) => upsertRefund(db, obj as Stripe.Refund, ts);

export const HANDLERS: Record<string, Handler> = {
  'customer.created': customerHandler,
  'customer.updated': customerHandler,
  'customer.deleted': customerHandler,

  'product.created': productHandler,
  'product.updated': productHandler,
  'product.deleted': productHandler,

  'price.created': priceHandler,
  'price.updated': priceHandler,
  'price.deleted': priceHandler,

  'customer.subscription.created': subscriptionHandler,
  'customer.subscription.updated': subscriptionHandler,
  'customer.subscription.deleted': subscriptionHandler,
  'customer.subscription.paused': subscriptionHandler,
  'customer.subscription.resumed': subscriptionHandler,
  'customer.subscription.trial_will_end': subscriptionHandler,
  'customer.subscription.pending_update_applied': subscriptionHandler,
  'customer.subscription.pending_update_expired': subscriptionHandler,

  'invoice.created': invoiceHandler,
  'invoice.updated': invoiceHandler,
  'invoice.finalized': invoiceHandler,
  'invoice.finalization_failed': invoiceHandler,
  'invoice.paid': invoiceHandler,
  'invoice.payment_succeeded': invoiceHandler,
  'invoice.payment_failed': invoiceHandler,
  'invoice.payment_action_required': invoiceHandler,
  'invoice.sent': invoiceHandler,
  'invoice.voided': invoiceHandler,
  'invoice.marked_uncollectible': invoiceHandler,
  'invoice.deleted': invoiceHandler,
  'invoice.upcoming': invoiceHandler,

  'charge.captured': chargeHandler,
  'charge.expired': chargeHandler,
  'charge.failed': chargeHandler,
  'charge.pending': chargeHandler,
  'charge.refunded': chargeHandler,
  'charge.succeeded': chargeHandler,
  'charge.updated': chargeHandler,

  'payment_intent.amount_capturable_updated': paymentIntentHandler,
  'payment_intent.canceled': paymentIntentHandler,
  'payment_intent.created': paymentIntentHandler,
  'payment_intent.payment_failed': paymentIntentHandler,
  'payment_intent.processing': paymentIntentHandler,
  'payment_intent.requires_action': paymentIntentHandler,
  'payment_intent.succeeded': paymentIntentHandler,
  'payment_intent.partially_funded': paymentIntentHandler,

  'refund.created': refundHandler,
  'refund.updated': refundHandler,
  'refund.failed': refundHandler,
  'charge.refund.updated': refundHandler,
};
