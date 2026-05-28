import type Stripe from 'stripe';
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { checkoutSessions, checkoutSessionLineItems } from '../db/schema';
import { upsertPrice } from './prices';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}

export async function upsertCheckoutSession(
  db: DB,
  s: Stripe.Checkout.Session,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: s.id,
    object: s.object,
    adaptivePricing: (s as any).adaptive_pricing ?? null,
    afterExpiration: s.after_expiration ?? null,
    allowPromotionCodes: s.allow_promotion_codes ?? null,
    amountSubtotal: s.amount_subtotal ?? null,
    amountTotal: s.amount_total ?? null,
    automaticTax: s.automatic_tax ?? null,
    billingAddressCollection: s.billing_address_collection ?? null,
    cancelUrl: s.cancel_url ?? null,
    clientReferenceId: s.client_reference_id ?? null,
    clientSecret: s.client_secret ?? null,
    collectedInformation: (s as any).collected_information ?? null,
    consent: s.consent ?? null,
    consentCollection: s.consent_collection ?? null,
    created: s.created,
    currency: s.currency ?? null,
    currencyConversion: s.currency_conversion ?? null,
    customFields: s.custom_fields ?? null,
    customText: s.custom_text ?? null,
    customer: strOrNull(s.customer),
    customerCreation: s.customer_creation ?? null,
    customerDetails: s.customer_details ?? null,
    customerEmail: s.customer_email ?? null,
    discounts: s.discounts ?? null,
    expiresAt: s.expires_at ?? null,
    invoice: strOrNull(s.invoice),
    invoiceCreation: s.invoice_creation ?? null,
    livemode: s.livemode,
    locale: s.locale ?? null,
    metadata: s.metadata ?? null,
    mode: s.mode,
    optionalItems: (s as any).optional_items ?? null,
    paymentIntent: strOrNull(s.payment_intent),
    paymentLink: strOrNull(s.payment_link),
    paymentMethodCollection: s.payment_method_collection ?? null,
    paymentMethodConfigurationDetails: s.payment_method_configuration_details ?? null,
    paymentMethodOptions: s.payment_method_options ?? null,
    paymentMethodTypes: s.payment_method_types ?? null,
    paymentStatus: s.payment_status ?? null,
    permissions: (s as any).permissions ?? null,
    phoneNumberCollection: s.phone_number_collection ?? null,
    presentmentDetails: (s as any).presentment_details ?? null,
    recoveredFrom: s.recovered_from ?? null,
    redirectOnCompletion: s.redirect_on_completion ?? null,
    returnUrl: s.return_url ?? null,
    savedPaymentMethodOptions: (s as any).saved_payment_method_options ?? null,
    setupIntent: strOrNull(s.setup_intent),
    shippingAddressCollection: s.shipping_address_collection ?? null,
    shippingCost: s.shipping_cost ?? null,
    shippingOptions: s.shipping_options ?? null,
    status: s.status,
    submitType: s.submit_type ?? null,
    subscription: strOrNull(s.subscription),
    successUrl: s.success_url ?? null,
    taxIdCollection: s.tax_id_collection ?? null,
    totalDetails: s.total_details ?? null,
    uiMode: s.ui_mode ?? null,
    url: s.url ?? null,
    wallet: (s as any).wallet ?? null,
    lastEventAt: eventCreated,
  };

  const set: Record<string, any> = {};
  for (const k of Object.keys(row)) {
    if (k === 'id') continue;
    set[k] = sql.raw(`excluded.${camelToSnake(k)}`);
  }

  await db.insert(checkoutSessions).values(row).onConflictDoUpdate({
    target: checkoutSessions.id,
    set,
    setWhere: sql`checkout_sessions.last_event_at < ${eventCreated}`,
  });
}

export interface UpsertCheckoutSessionLineOpts {
  stripe?: Stripe;
}

export async function upsertCheckoutSessionLine(
  db: DB,
  line: any,
  sessionId: string,
  eventCreated: number,
  opts: UpsertCheckoutSessionLineOpts = {},
): Promise<void> {
  // Stripe checkout line items return `price` as the full Price object.
  // Upsert it (which cascades into product backfill) before persisting the
  // line — closes gaps for ad-hoc products created via Payment Links.
  if (line.price && typeof line.price === 'object' && line.price.id) {
    await upsertPrice(db, line.price as Stripe.Price, eventCreated, { stripe: opts.stripe });
  }

  const row = {
    id: line.id,
    object: line.object,
    amountDiscount: line.amount_discount ?? null,
    amountSubtotal: line.amount_subtotal ?? null,
    amountTax: line.amount_tax ?? null,
    amountTotal: line.amount_total ?? null,
    checkoutSession: sessionId,
    currency: line.currency ?? null,
    description: line.description ?? null,
    discounts: line.discounts ?? null,
    price: line.price ?? null,
    quantity: line.quantity ?? null,
    taxes: line.taxes ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(checkoutSessionLineItems).values(row).onConflictDoUpdate({
    target: checkoutSessionLineItems.id,
    set: row,
    setWhere: sql`checkout_session_line_items.last_event_at < ${eventCreated}`,
  });
}

export async function upsertCheckoutSessionLines(
  stripe: Stripe,
  db: DB,
  sessionId: string,
  eventCreated: number,
): Promise<void> {
  let cursor: string | undefined = undefined;
  while (true) {
    const page: { data: any[]; has_more: boolean } = await (stripe as any).checkout.sessions.listLineItems(
      sessionId,
      { limit: 100, starting_after: cursor },
    );
    for (const line of page.data) {
      await upsertCheckoutSessionLine(db, line, sessionId, eventCreated, { stripe });
    }
    if (!page.has_more || page.data.length === 0) break;
    cursor = page.data[page.data.length - 1].id;
  }
}
