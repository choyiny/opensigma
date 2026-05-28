import type { Env, BackloadJob } from '../env';

export const queueHandler: ExportedHandlerQueueHandler<Env, BackloadJob> = async (
  _batch,
  _env,
  _ctx,
) => {
  // Placeholder — queue consumer implementation TBD
};
