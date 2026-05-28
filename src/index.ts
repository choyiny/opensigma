import { app } from './app';
import './webhooks/handler';
import { scheduledHandler } from './backload/scheduled';
import { queueHandler } from './backload/consumer';
import type { Env, BackloadJob } from './env';

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
  queue: queueHandler,
} satisfies ExportedHandler<Env, BackloadJob>;
