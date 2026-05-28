import { ne } from 'drizzle-orm';
import type { Env } from '../env';
import { getDb } from '../db/client';
import { backloadState } from '../db/schema';

export const scheduledHandler: ExportedHandlerScheduledHandler<Env> = async (_ctrl, env, _ctx) => {
  const db = getDb(env.DB);
  const rows = await db
    .select({ resource: backloadState.resource, cursor: backloadState.cursor })
    .from(backloadState)
    .where(ne(backloadState.status, 'done'));

  for (const row of rows) {
    await env.BACKLOAD_QUEUE.send({
      resource: row.resource as any,
      cursor: row.cursor ?? null,
    });
  }
};
