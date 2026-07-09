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

// Idempotent record-then-dispatch shared by the webhook route and the events poll.
// Returns 'skipped' for duplicate ids or unhandled types; 'handled' otherwise.
export async function processEvent(ctx: Ctx, event: StripeEventLike): Promise<'handled' | 'skipped'> {
  const insertResult = await ctx.db
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
    return 'skipped';
  }

  const handler = HANDLERS[event.type];
  if (!handler) {
    console.log(JSON.stringify({ level: 'info', msg: 'unhandled_event_type', type: event.type, id: event.id }));
    return 'skipped';
  }

  await handler(ctx, event.data.object, event.created);
  return 'handled';
}
