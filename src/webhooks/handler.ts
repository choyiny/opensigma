import { app } from '../app';
import { getDb } from '../db/client';
import { getStripe } from '../stripe';
import { processEvent } from '../events/process';

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

  try {
    await processEvent({ db, stripe, env: c.env }, event);
  } catch (err) {
    console.log(JSON.stringify({ level: 'error', msg: 'handler_failed', type: event.type, id: event.id, err: String(err) }));
    return c.text('handler error', 500);
  }

  return c.text('ok', 200);
});
