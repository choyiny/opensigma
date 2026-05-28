import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const stripeEvents = sqliteTable(
  'stripe_events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    apiVersion: text('api_version'),
    requestId: text('request_id'),
    created: integer('created').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => ({ typeCreatedIdx: index('idx_stripe_events_type_created').on(t.type, t.created) }),
);

export const backloadState = sqliteTable('backload_state', {
  resource: text('resource').primaryKey(),
  cursor: text('cursor'),
  status: text('status', { enum: ['idle', 'in_progress', 'done'] }).notNull().default('idle'),
  lastSyncedAt: integer('last_synced_at'),
  updatedAt: integer('updated_at').notNull(),
});
