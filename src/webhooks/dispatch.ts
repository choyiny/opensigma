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
import { upsertDispute } from '../upserts/disputes';
import { upsertPayout } from '../upserts/payouts';
import { upsertSetupIntent } from '../upserts/setup_intents';
import { upsertCoupon } from '../upserts/coupons';
import { upsertPromotionCode } from '../upserts/promotion_codes';
import { upsertSubscriptionSchedule } from '../upserts/subscription_schedules';
import { upsertReview } from '../upserts/reviews';
import { upsertEarlyFraudWarning } from '../upserts/early_fraud_warnings';
import { upsertCreditNote } from '../upserts/credit_notes';
import { upsertCheckoutSession } from '../upserts/checkout_sessions';

type Handler = (db: DB, obj: any, eventCreated: number) => Promise<void>;

const customerHandler: Handler = (db, obj, ts) => upsertCustomer(db, obj as Stripe.Customer, ts);
const productHandler: Handler = (db, obj, ts) => upsertProduct(db, obj as Stripe.Product, ts);
const priceHandler: Handler = (db, obj, ts) => upsertPrice(db, obj as Stripe.Price, ts);
const subscriptionHandler: Handler = (db, obj, ts) => upsertSubscription(db, obj as Stripe.Subscription, ts);
const invoiceHandler: Handler = (db, obj, ts) => upsertInvoice(db, obj as Stripe.Invoice, ts);
const chargeHandler: Handler = (db, obj, ts) => upsertCharge(db, obj as Stripe.Charge, ts);
const paymentIntentHandler: Handler = (db, obj, ts) => upsertPaymentIntent(db, obj as Stripe.PaymentIntent, ts);
const refundHandler: Handler = (db, obj, ts) => upsertRefund(db, obj as Stripe.Refund, ts);
const disputeHandler: Handler = (db, obj, ts) => upsertDispute(db, obj as Stripe.Dispute, ts);
const payoutHandler: Handler = (db, obj, ts) => upsertPayout(db, obj as Stripe.Payout, ts);
const setupIntentHandler: Handler = (db, obj, ts) => upsertSetupIntent(db, obj as Stripe.SetupIntent, ts);
const couponHandler: Handler = (db, obj, ts) => upsertCoupon(db, obj as Stripe.Coupon, ts);
const promotionCodeHandler: Handler = (db, obj, ts) => upsertPromotionCode(db, obj as Stripe.PromotionCode, ts);
const subscriptionScheduleHandler: Handler = (db, obj, ts) => upsertSubscriptionSchedule(db, obj as Stripe.SubscriptionSchedule, ts);
const reviewHandler: Handler = (db, obj, ts) => upsertReview(db, obj as Stripe.Review, ts);
const earlyFraudWarningHandler: Handler = (db, obj, ts) => upsertEarlyFraudWarning(db, obj as Stripe.Radar.EarlyFraudWarning, ts);
const creditNoteHandler: Handler = async (db, obj, ts) => {
  await upsertCreditNote(db, obj as Stripe.CreditNote, ts);
  // Child re-fetch is wired in Task 21 once dispatch can access env/stripe.
};
const checkoutSessionHandler: Handler = async (db, obj, ts) => {
  await upsertCheckoutSession(db, obj as Stripe.Checkout.Session, ts);
  // Child re-fetch is wired in Task 21 once dispatch can access env/stripe.
};

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

  'charge.dispute.created': disputeHandler,
  'charge.dispute.updated': disputeHandler,
  'charge.dispute.closed': disputeHandler,
  'charge.dispute.funds_reinstated': disputeHandler,
  'charge.dispute.funds_withdrawn': disputeHandler,

  'payout.created': payoutHandler,
  'payout.updated': payoutHandler,
  'payout.paid': payoutHandler,
  'payout.failed': payoutHandler,
  'payout.canceled': payoutHandler,
  'payout.reconciliation_completed': payoutHandler,

  'setup_intent.created': setupIntentHandler,
  'setup_intent.succeeded': setupIntentHandler,
  'setup_intent.setup_failed': setupIntentHandler,
  'setup_intent.canceled': setupIntentHandler,
  'setup_intent.requires_action': setupIntentHandler,

  'coupon.created': couponHandler,
  'coupon.updated': couponHandler,
  'coupon.deleted': couponHandler,

  'promotion_code.created': promotionCodeHandler,
  'promotion_code.updated': promotionCodeHandler,

  'subscription_schedule.created': subscriptionScheduleHandler,
  'subscription_schedule.updated': subscriptionScheduleHandler,
  'subscription_schedule.released': subscriptionScheduleHandler,
  'subscription_schedule.canceled': subscriptionScheduleHandler,
  'subscription_schedule.completed': subscriptionScheduleHandler,
  'subscription_schedule.expiring': subscriptionScheduleHandler,
  'subscription_schedule.aborted': subscriptionScheduleHandler,

  'review.opened': reviewHandler,
  'review.closed': reviewHandler,

  'radar.early_fraud_warning.created': earlyFraudWarningHandler,
  'radar.early_fraud_warning.updated': earlyFraudWarningHandler,

  'credit_note.created': creditNoteHandler,
  'credit_note.updated': creditNoteHandler,
  'credit_note.voided': creditNoteHandler,

  'checkout.session.completed': checkoutSessionHandler,
  'checkout.session.expired': checkoutSessionHandler,
  'checkout.session.async_payment_succeeded': checkoutSessionHandler,
  'checkout.session.async_payment_failed': checkoutSessionHandler,
};
