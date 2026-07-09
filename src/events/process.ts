import { eq } from 'drizzle-orm';
import type { Ctx } from '../webhooks/dispatch';
import { HANDLERS } from '../webhooks/dispatch';
import { stripeEvents } from '../db/schema';

export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  api_version?: string | null;
  request?: { id?: string | null } | null;
  data: { object: unknown };
}

// Idempotent dispatch-then-record shared by the webhook route and the events poll.
// Recording AFTER a successful handler means a handler that throws leaves no
// stripe_events row, so the retry re-dispatches instead of silently skipping the
// event. Double-dispatch across webhook+poll is safe: every upsert is guarded by
// lastEventAt. Returns 'skipped' for already-recorded ids or unhandled types.
export async function processEvent(ctx: Ctx, event: StripeEventLike): Promise<'handled' | 'skipped'> {
  const already = await ctx.db
    .select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(eq(stripeEvents.id, event.id))
    .get();
  if (already) {
    return 'skipped';
  }

  const record = () =>
    ctx.db
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
      .onConflictDoNothing();

  const handler = HANDLERS[event.type];
  if (!handler) {
    await record();
    console.log(JSON.stringify({ level: 'info', msg: 'unhandled_event_type', type: event.type, id: event.id }));
    return 'skipped';
  }

  await handler(ctx, event.data.object, event.created);
  await record();
  return 'handled';
}
