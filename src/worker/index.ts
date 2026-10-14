import { drainWorkerOutbox, handleWorker, type WorkerEnv } from "./http.js";

interface ScheduledControllerLike {}
interface ExecutionContextLike { waitUntil(promise: Promise<unknown>): void }

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorker(request, env);
  },
  scheduled(_controller: ScheduledControllerLike, env: WorkerEnv, ctx: ExecutionContextLike): void {
    ctx.waitUntil(drainWorkerOutbox(env));
  },
};
