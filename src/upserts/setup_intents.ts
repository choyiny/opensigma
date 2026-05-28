import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { setupIntents } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertSetupIntent(
  db: DB,
  si: Stripe.SetupIntent,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: si.id,
    object: si.object,
    application: strOrNull(si.application),
    attachToSelf: si.attach_to_self ?? null,
    automaticPaymentMethods: si.automatic_payment_methods ?? null,
    cancellationReason: si.cancellation_reason ?? null,
    clientSecret: si.client_secret ?? null,
    created: si.created,
    customer: strOrNull(si.customer),
    description: si.description ?? null,
    flowDirections: si.flow_directions ?? null,
    lastSetupError: si.last_setup_error ?? null,
    latestAttempt: strOrNull(si.latest_attempt),
    livemode: si.livemode,
    mandate: strOrNull(si.mandate),
    metadata: si.metadata ?? null,
    nextAction: si.next_action ?? null,
    onBehalfOf: strOrNull(si.on_behalf_of),
    paymentMethod: strOrNull(si.payment_method),
    paymentMethodConfigurationDetails: si.payment_method_configuration_details ?? null,
    paymentMethodOptions: si.payment_method_options ?? null,
    paymentMethodTypes: si.payment_method_types ?? null,
    singleUseMandate: strOrNull(si.single_use_mandate),
    status: si.status,
    usage: si.usage,
    lastEventAt: eventCreated,
  };
  await db.insert(setupIntents).values(row).onConflictDoUpdate({
    target: setupIntents.id,
    set: row,
    setWhere: lt(setupIntents.lastEventAt, eventCreated),
  });
}
