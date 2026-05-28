import { app } from '../app';
import { getDb } from '../db/client';
import { stripeEvents } from '../db/schema';
import { getStripe } from '../stripe';
import { HANDLERS } from './dispatch';

app.post('/webhooks/stripe', async (c) => {
  const sig = c.req.header('stripe-signature');
  if (!sig) return c.text('missing signature', 400);

  const body = await c.req.text();
  const stripe = getStripe(c.env.STRIPE_API_KEY);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(JSON.stringify({ level: 'warn', msg: 'invalid_signature', err: String(err) }));
    return c.text('invalid signature', 400);
  }

  const db = getDb(c.env.DB);

  // Idempotent insert. INSERT OR IGNORE => duplicate is silent no-op.
  const insertResult = await db
    .insert(stripeEvents)
    .values({
      id: event.id,
      type: event.type,
      apiVersion: event.api_version ?? null,
      requestId: event.request?.id ?? null,
      created: event.created,
      payload: event.data.object as unknown as Record<string, unknown>,
      receivedAt: Date.now(),
    })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });

  if (insertResult.length === 0) {
    // duplicate delivery
    return c.text('ok', 200);
  }

  const handler = HANDLERS[event.type];
  if (!handler) {
    console.log(JSON.stringify({ level: 'info', msg: 'unhandled_event_type', type: event.type, id: event.id }));
    return c.text('ok', 200);
  }

  try {
    await handler({ db, stripe, env: c.env }, event.data.object, event.created);
  } catch (err) {
    console.log(JSON.stringify({ level: 'error', msg: 'handler_failed', type: event.type, id: event.id, err: String(err) }));
    return c.text('handler error', 500);
  }

  return c.text('ok', 200);
});
